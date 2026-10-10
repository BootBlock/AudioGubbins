/**
 * The WebGL2 backend's drawing, the production baseline (REQ-AUDIO-152).
 *
 * Every rectangle and segment is one instance of a unit quad: a rectangle is
 * the quad scaled and placed, a segment the quad stretched along it and widened
 * across it. A frame's instances go up in one buffer and each batch is one
 * instanced draw with its colour, inside its layer's scissor, so a waveform of
 * thousands of columns is a handful of draws. A field batch is drawn in its
 * place among them by its own program (`webgl2-fields.ts`). Everything it draws
 * with is made again whole on a context given back after a loss
 * (`webgl2-context.ts`), the field textures it held lost with the context
 * (ADR-0044, ADR-0082).
 */

import { FieldLookups, paints } from './field-pixels.js';
import {
  backingSize,
  type Rectangle,
  type RectangleBatch,
  type RenderFrame,
  type SegmentBatch,
} from './render-frame.js';
import {
  AWAY,
  DRAWN,
  RendererKind,
  drawFailed,
  type DrawOutcome,
  type RendererBackend,
} from './renderer-backend.js';
import { GlFields } from './webgl2-fields.js';

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

/** The programs, buffers and field textures, made again after a restore. */
export interface Resources {
  readonly program: WebGLProgram;
  readonly fields: GlFields;
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

/** Everything the backend draws with on `gl`, or why it cannot be made. */
export function build(gl: WebGL2RenderingContext, fieldBudget: number): Resources | string {
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
  const fields = GlFields.build(gl, (type, source) => shader(gl, type, source), fieldBudget);
  if (typeof fields === 'string') return fields;
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
    fields,
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

/** Draws frames on a WebGL2 context with what was built on it. */
export class WebGl2Backend implements RendererBackend {
  readonly kind = RendererKind.WebGl2;
  readonly #gl: WebGL2RenderingContext;
  readonly #fieldBudget: number;
  readonly #data = new InstanceData();
  readonly #lookups = new FieldLookups();
  #resources: Resources | undefined;
  /** Whether the next draw is the first with the resources last built. */
  #unproven = true;
  #disposed = false;

  constructor(gl: WebGL2RenderingContext, resources: Resources, fieldBudget: number) {
    this.#gl = gl;
    this.#resources = resources;
    this.#fieldBudget = fieldBudget;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Lets go of everything made on the lost context, its field textures with the rest. */
  lose(): void {
    this.#resources = undefined;
  }

  /** Rebuilds after a restore; answers why it could not, or nothing. */
  restore(): string | undefined {
    const rebuilt = build(this.#gl, this.#fieldBudget);
    if (typeof rebuilt === 'string') return rebuilt;
    this.#resources = rebuilt;
    this.#unproven = true;
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

  draw(frame: RenderFrame): DrawOutcome {
    const gl = this.#gl;
    if (gl.isContextLost()) return AWAY;
    const resources = this.#resources;
    if (resources === undefined) {
      return drawFailed('The WebGL2 context is back, and the backend has nothing to draw with.');
    }
    this.#encode(gl, resources, frame);
    return this.#unproven ? this.#prove(gl) : DRAWN;
  }

  /**
   * The first draw with newly built resources, checked for an error. Asking is
   * a round trip to the GPU process, so it is asked once for each build, which
   * is where a program or buffer that cannot draw shows itself; the loss the
   * context was restored from may still be reported, and is not a failure.
   */
  #prove(gl: WebGL2RenderingContext): DrawOutcome {
    this.#unproven = false;
    const error = gl.getError();
    if (error === gl.NO_ERROR || error === gl.CONTEXT_LOST_WEBGL) return DRAWN;
    if (gl.isContextLost()) return AWAY;
    return drawFailed(`The first WebGL2 draw raised error ${String(error)}.`);
  }

  /** Sizes the canvas to the frame, clears it, and sets the blending every batch is drawn with. */
  #begin(gl: WebGL2RenderingContext, frame: RenderFrame): { readonly height: number } {
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
    return size;
  }

  #encode(gl: WebGL2RenderingContext, resources: Resources, frame: RenderFrame): void {
    const size = this.#begin(gl, frame);
    const lookups = this.#lookups.pack(frame);
    resources.fields.prepare(lookups.values);
    gl.useProgram(resources.program);
    const { values, firsts } = this.#data.pack(frame);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.instances);
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
    gl.uniform2f(resources.uniforms.scale, 2 / frame.width, -2 / frame.height);
    let batchIndex = 0;
    let fieldIndex = 0;
    for (const layer of frame.layers) {
      // The geometry program, its vertices and the layer's scissor, bound
      // before the layer's first geometry and again after any field.
      let bound = false;
      for (const batch of layer.batches) {
        if (batch.kind === 'field') {
          const placement = lookups.placements[fieldIndex];
          fieldIndex += 1;
          if (placement === undefined || !paints(placement)) continue;
          resources.fields.draw(placement, size.height);
          bound = false;
          continue;
        }
        if (batch.kind !== 'rectangles' && batch.kind !== 'segments') continue;
        const first = firsts[batchIndex] ?? 0;
        batchIndex += 1;
        if (batch.count === 0) continue;
        if (!bound) {
          gl.useProgram(resources.program);
          gl.bindVertexArray(resources.vertices);
          this.#scissor(layer.clip, frame, size.height);
          bound = true;
        }
        this.#drawGeometry(gl, resources, batch, first);
      }
    }
    gl.bindVertexArray(null);
    resources.fields.trim();
  }

  /** Draws one batch of geometry, whose instances start at `first`, with the geometry program bound. */
  #drawGeometry(
    gl: WebGL2RenderingContext,
    resources: Resources,
    batch: RectangleBatch | SegmentBatch,
    first: number,
  ): void {
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

  dispose(): void {
    this.#disposed = true;
    this.#gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.#resources = undefined;
  }
}
