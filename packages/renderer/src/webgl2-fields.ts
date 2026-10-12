/**
 * Field batches on WebGL2 (ADR-0082).
 *
 * A field goes up once, as one-byte textures of slices no larger than the
 * context's `MAX_TEXTURE_SIZE`, and a ramp as a 256 by 1 texture, each held by
 * its key in a cache within a budget. A frame's column and row maps go up
 * together, as one float texture. A field is drawn as one triangle over the
 * whole canvas for each slice, scissored to the device pixels the field
 * paints, and each pixel looks up its cell through the maps and its colour
 * through the ramp, so every value it draws was decided on the processor
 * (`field-pixels.ts`). The textures belong to the context: a lost context
 * takes them, and these resources are built again whole after a restore.
 */

import type { FieldPlacement } from './field-pixels.js';
import {
  RAMP_TEXTURE_BUDGET,
  TextureCache,
  fieldSlices,
  type FieldSlice,
} from './field-textures.js';
import type { ColourRamp, ScalarField } from './render-frame.js';

/** The width of the texture a frame's maps are laid across, row after row: one every context takes. */
const LOOKUP_WIDTH = 2048;

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D lookups;
uniform highp sampler2D field;
uniform highp sampler2D ramp;
uniform ivec2 origin;
uniform int height;
uniform ivec2 maps;
uniform ivec4 slice;
out vec4 result;
float lookup(int index) {
  return texelFetch(lookups, ivec2(index % ${String(LOOKUP_WIDTH)}, index / ${String(LOOKUP_WIDTH)}), 0).r;
}
void main() {
  ivec2 pixel = ivec2(int(gl_FragCoord.x), height - 1 - int(gl_FragCoord.y)) - origin;
  ivec2 cell = ivec2(int(lookup(maps.x + pixel.x)), int(lookup(maps.y + pixel.y))) - slice.xy;
  if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, slice.zw))) discard;
  int value = int(round(texelFetch(field, cell, 0).r * 255.0));
  result = texelFetch(ramp, ivec2(value, 0), 0);
}`;

/** The texture units the field program reads. */
const Unit = { Lookups: 0, Field: 1, Ramp: 2 } as const;

interface Slice extends FieldSlice {
  readonly texture: WebGLTexture;
}

/** Compiles one shader of the field program, or answers why it did not. */
type Compile = (type: number, source: string) => WebGLShader | string;

/** What draws a context's field batches, made with the rest of its resources. */
export class GlFields {
  readonly #gl: WebGL2RenderingContext;
  readonly #program: WebGLProgram;
  /** No attributes: the field's triangle is made from the vertex index. */
  readonly #vertices: WebGLVertexArrayObject;
  readonly #lookups: WebGLTexture;
  #lookupRows = 0;
  readonly #largest: number;
  readonly #fields: TextureCache<readonly Slice[]>;
  readonly #ramps: TextureCache<WebGLTexture>;
  readonly #uniforms: {
    readonly origin: WebGLUniformLocation | null;
    readonly height: WebGLUniformLocation | null;
    readonly maps: WebGLUniformLocation | null;
    readonly slice: WebGLUniformLocation | null;
  };

  private constructor(gl: WebGL2RenderingContext, program: WebGLProgram, budget: number) {
    this.#gl = gl;
    this.#program = program;
    this.#vertices = gl.createVertexArray();
    this.#lookups = gl.createTexture();
    this.#largest = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.#fields = new TextureCache(budget, (slices) => {
      for (const slice of slices) gl.deleteTexture(slice.texture);
    });
    this.#ramps = new TextureCache(RAMP_TEXTURE_BUDGET, (texture) => {
      gl.deleteTexture(texture);
    });
    this.#uniforms = {
      origin: gl.getUniformLocation(program, 'origin'),
      height: gl.getUniformLocation(program, 'height'),
      maps: gl.getUniformLocation(program, 'maps'),
      slice: gl.getUniformLocation(program, 'slice'),
    };
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'lookups'), Unit.Lookups);
    gl.uniform1i(gl.getUniformLocation(program, 'field'), Unit.Field);
    gl.uniform1i(gl.getUniformLocation(program, 'ramp'), Unit.Ramp);
  }

  /** The field program on `gl`, holding field textures within `budget` bytes, or why it cannot be made. */
  static build(gl: WebGL2RenderingContext, compile: Compile, budget: number): GlFields | string {
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (typeof vertex === 'string') return vertex;
    if (typeof fragment === 'string') return fragment;
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      return gl.getProgramInfoLog(program) ?? 'The field program did not link.';
    }
    return new GlFields(gl, program, budget);
  }

  #texture(unit: number, texture: WebGLTexture): void {
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  /** A new texture on `unit`, read texel by texel, with storage for one level. */
  #allocate(unit: number, format: number, width: number, height: number): WebGLTexture {
    const gl = this.#gl;
    const texture = gl.createTexture();
    this.#texture(unit, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    return texture;
  }

  /** Uploads a frame's column and row maps, before any of its fields is drawn. */
  prepare(values: Float32Array): void {
    const gl = this.#gl;
    if (values.length === 0) return;
    this.#texture(Unit.Lookups, this.#lookups);
    this.#holdLookups(Math.ceil(values.length / LOOKUP_WIDTH));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    // The whole rows, then what is left, as a last row only partly written.
    const whole = Math.floor(values.length / LOOKUP_WIDTH);
    if (whole > 0) {
      const head = values.subarray(0, whole * LOOKUP_WIDTH);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LOOKUP_WIDTH, whole, gl.RED, gl.FLOAT, head);
    }
    const rest = values.subarray(whole * LOOKUP_WIDTH);
    if (rest.length > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, whole, rest.length, 1, gl.RED, gl.FLOAT, rest);
    }
  }

  /** Gives the bound lookup texture room for `rows` rows of maps. */
  #holdLookups(rows: number): void {
    if (rows <= this.#lookupRows) return;
    const gl = this.#gl;
    // Grown to twice what this frame needs, so a frame a little larger does
    // not grow it again, and never past what the context takes: at least
    // 2048 rows of 2048 entries, far more than the canvases of a frame's
    // fields map.
    this.#lookupRows = Math.max(rows, Math.min(rows * 2, this.#largest));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const [width, height] = [LOOKUP_WIDTH, this.#lookupRows];
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
  }

  /** The field's slices, uploaded where the cache holds none. */
  #slices(field: ScalarField): readonly Slice[] {
    const held = this.#fields.take(field.key);
    if (held !== undefined) return held;
    const gl = this.#gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, field.width);
    const slices = fieldSlices(field.width, field.height, this.#largest).map((slice) => {
      const texture = this.#allocate(Unit.Field, gl.R8, slice.width, slice.height);
      // Read straight out of the field's own bytes, row length and skips placing the slice.
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, slice.x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, slice.y);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        slice.width,
        slice.height,
        gl.RED,
        gl.UNSIGNED_BYTE,
        field.values,
      );
      return { ...slice, texture };
    });
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    this.#fields.hold(field.key, slices, field.width * field.height);
    return slices;
  }

  /** The ramp's texture, uploaded where the cache holds none. */
  #ramp(ramp: ColourRamp): WebGLTexture {
    const held = this.#ramps.take(ramp.key);
    if (held !== undefined) return held;
    const gl = this.#gl;
    const texture = this.#allocate(Unit.Ramp, gl.RGBA8, 256, 1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, ramp.colours);
    this.#ramps.hold(ramp.key, texture, ramp.colours.length);
    return texture;
  }

  /**
   * Draws one placed field, a slice at a time, on a canvas `height` device
   * pixels tall. It leaves its own program, vertex array and scissor bound.
   */
  draw(placement: FieldPlacement, height: number): void {
    const gl = this.#gl;
    const { batch, span } = placement;
    const slices = this.#slices(batch.field);
    this.#texture(Unit.Ramp, this.#ramp(batch.ramp));
    this.#texture(Unit.Lookups, this.#lookups);
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vertices);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(span.left, height - span.top - span.height, span.width, span.height);
    gl.uniform2i(this.#uniforms.origin, span.left, span.top);
    gl.uniform1i(this.#uniforms.height, height);
    gl.uniform2i(this.#uniforms.maps, placement.columnsAt, placement.rowsAt);
    for (const slice of slices) {
      this.#texture(Unit.Field, slice.texture);
      gl.uniform4i(this.#uniforms.slice, slice.x, slice.y, slice.width, slice.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  /** Releases what is past the budgets, once the frame is drawn. */
  trim(): void {
    this.#fields.trim();
    this.#ramps.trim();
  }
}
