/**
 * The WebGL2 backend, the production baseline (REQ-AUDIO-152).
 *
 * Every rectangle and segment is one instance of a unit quad: a rectangle is
 * the quad scaled and placed, a segment the quad stretched along it and widened
 * across it. A frame's instances go up in one buffer and each batch is one
 * instanced draw with its colour, inside its layer's scissor, so a waveform of
 * thousands of columns is a handful of draws.
 *
 * A lost context is announced by `webglcontextlost`, whose default the backend
 * prevents so the browser may give it back; `webglcontextrestored` then
 * rebuilds the program and buffers, and the renderer draws the latest frame
 * again (ADR-0044). If it is not given back in time, the renderer steps down to
 * Canvas 2D.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import { backingSize, type Rectangle, type RenderFrame } from './render-frame.js';
import {
  RendererKind,
  type BackendFactory,
  type RendererBackend,
  type Schedule,
} from './renderer-backend.js';

/** How long a lost context is waited for before the renderer steps down. */
const RESTORE_WAIT_MS = 3000;

const VERTEX = `#version 300 es
in vec2 corner;
in vec4 instance;
uniform vec2 scale;
uniform float mode;
uniform float halfWidth;
void main() {
  vec2 point;
  if (mode < 0.5) {
    point = instance.xy + corner * instance.zw;
  } else {
    vec2 along = instance.zw - instance.xy;
    float length = max(length(along), 0.0001);
    vec2 normal = vec2(-along.y, along.x) / length * halfWidth;
    point = mix(instance.xy, instance.zw, corner.x) + normal * (corner.y * 2.0 - 1.0);
  }
  gl_Position = vec4(point * scale + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 colour;
out vec4 result;
void main() {
  result = colour;
}`;

/** The program and buffers, made again after a restore. */
interface Resources {
  readonly program: WebGLProgram;
  readonly vertices: WebGLVertexArrayObject;
  readonly instances: WebGLBuffer;
  readonly uniforms: {
    readonly scale: WebGLUniformLocation | null;
    readonly mode: WebGLUniformLocation | null;
    readonly halfWidth: WebGLUniformLocation | null;
    readonly colour: WebGLUniformLocation | null;
  };
}

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | string {
  const made = gl.createShader(type);
  if (made === null) return 'The context gave no shader.';
  gl.shaderSource(made, source);
  gl.compileShader(made);
  if (gl.getShaderParameter(made, gl.COMPILE_STATUS) !== true) {
    return gl.getShaderInfoLog(made) ?? 'A shader did not compile.';
  }
  return made;
}

function build(gl: WebGL2RenderingContext): Resources | string {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (typeof vertex === 'string') return vertex;
  if (typeof fragment === 'string') return fragment;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    return gl.getProgramInfoLog(program) ?? 'The program did not link.';
  }
  const vertices = gl.createVertexArray();
  gl.bindVertexArray(vertices);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  const instance = gl.getAttribLocation(program, 'instance');
  gl.enableVertexAttribArray(instance);
  gl.vertexAttribPointer(instance, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(instance, 1);
  gl.bindVertexArray(null);
  return {
    program,
    vertices,
    instances,
    uniforms: {
      scale: gl.getUniformLocation(program, 'scale'),
      mode: gl.getUniformLocation(program, 'mode'),
      halfWidth: gl.getUniformLocation(program, 'halfWidth'),
      colour: gl.getUniformLocation(program, 'colour'),
    },
  };
}

/** Every instance of a frame, in one array, grown as needed and kept (G4). */
class InstanceData {
  #values = new Float32Array(4096);

  /** Packs the frame's geometry and answers each batch's first instance, in draw order. */
  pack(frame: RenderFrame): { readonly values: Float32Array; readonly firsts: number[] } {
    let total = 0;
    for (const layer of frame.layers) {
      for (const batch of layer.batches) {
        if (batch.kind === 'rectangles' || batch.kind === 'segments') total += batch.count;
      }
    }
    if (this.#values.length < total * 4) this.#values = new Float32Array(total * 8);
    const firsts: number[] = [];
    let at = 0;
    for (const layer of frame.layers) {
      for (const batch of layer.batches) {
        if (batch.kind !== 'rectangles' && batch.kind !== 'segments') continue;
        firsts.push(at);
        this.#values.set(batch.values.subarray(0, batch.count * 4), at * 4);
        at += batch.count;
      }
    }
    return { values: this.#values.subarray(0, total * 4), firsts };
  }
}

class WebGl2Backend implements RendererBackend {
  readonly kind = RendererKind.WebGl2;
  readonly #gl: WebGL2RenderingContext;
  readonly #data = new InstanceData();
  #resources: Resources | undefined;

  constructor(gl: WebGL2RenderingContext, resources: Resources) {
    this.#gl = gl;
    this.#resources = resources;
  }

  lose(): void {
    this.#resources = undefined;
  }

  /** Rebuilds after a restore; answers why it could not, or nothing. */
  restore(): string | undefined {
    const rebuilt = build(this.#gl);
    if (typeof rebuilt === 'string') return rebuilt;
    this.#resources = rebuilt;
    return undefined;
  }

  #scissor(clip: Rectangle | undefined, frame: RenderFrame, height: number): void {
    const gl = this.#gl;
    if (clip === undefined) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const ratio = frame.pixelRatio;
    gl.enable(gl.SCISSOR_TEST);
    const x = Math.round(clip.x * ratio);
    const y = Math.round((clip.y + clip.height) * ratio);
    gl.scissor(
      x,
      height - y,
      Math.max(0, Math.round(clip.width * ratio)),
      Math.max(0, Math.round(clip.height * ratio)),
    );
  }

  draw(frame: RenderFrame): boolean {
    const gl = this.#gl;
    const resources = this.#resources;
    if (resources === undefined || gl.isContextLost()) return false;
    const size = backingSize(frame);
    const canvas = gl.canvas;
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    gl.viewport(0, 0, size.width, size.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(frame.clear[0], frame.clear[1], frame.clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(resources.program);
    gl.bindVertexArray(resources.vertices);
    const { values, firsts } = this.#data.pack(frame);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.instances);
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
    gl.uniform2f(resources.uniforms.scale, 2 / frame.width, -2 / frame.height);
    let batchIndex = 0;
    for (const layer of frame.layers) {
      this.#scissor(layer.clip, frame, size.height);
      for (const batch of layer.batches) {
        if (batch.kind !== 'rectangles' && batch.kind !== 'segments') continue;
        const first = firsts[batchIndex] ?? 0;
        batchIndex += 1;
        if (batch.count === 0) continue;
        gl.uniform1f(resources.uniforms.mode, batch.kind === 'rectangles' ? 0 : 1);
        gl.uniform1f(resources.uniforms.halfWidth, batch.kind === 'segments' ? batch.width / 2 : 0);
        gl.uniform4f(resources.uniforms.colour, ...batch.colour);
        gl.vertexAttribPointer(
          gl.getAttribLocation(resources.program, 'instance'),
          4,
          gl.FLOAT,
          false,
          0,
          first * 16,
        );
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
      }
    }
    gl.bindVertexArray(null);
    return true;
  }

  dispose(): void {
    this.#gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.#resources = undefined;
  }
}

function unavailable(reason: string): DomainResult<never> {
  return fail(failure('renderer.webgl2-unavailable', FailureKind.Unrecoverable, reason));
}

/** The WebGL2 backend's factory, which waits for a lost context by `schedule`. */
export function webGl2Backend(schedule: Schedule): BackendFactory {
  return {
    kind: RendererKind.WebGl2,
    create: (canvas, events) => {
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
      });
      if (gl === null) return Promise.resolve(unavailable('The browser gave no WebGL2 context.'));
      const resources = build(gl);
      if (typeof resources === 'string') return Promise.resolve(unavailable(resources));
      const backend = new WebGl2Backend(gl, resources);
      let giveUp: (() => void) | undefined;
      canvas.addEventListener('webglcontextlost', (event) => {
        // Prevented, or the browser never gives the context back.
        event.preventDefault();
        backend.lose();
        events.lost('The browser took the WebGL2 context away.');
        giveUp = schedule(() => {
          events.failed(
            `The WebGL2 context was not given back within ${String(RESTORE_WAIT_MS / 1000)} seconds.`,
          );
        }, RESTORE_WAIT_MS);
      });
      canvas.addEventListener('webglcontextrestored', () => {
        giveUp?.();
        giveUp = undefined;
        const problem = backend.restore();
        if (problem === undefined) events.restored();
        else events.failed(`The WebGL2 context came back and could not be rebuilt: ${problem}`);
      });
      return Promise.resolve(succeed(backend));
    },
  };
}
