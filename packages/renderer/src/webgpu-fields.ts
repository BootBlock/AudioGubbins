/**
 * Field batches on WebGPU (ADR-0082), drawn as the WebGL2 backend draws them.
 *
 * A field goes up once, as `r8unorm` textures of slices no larger than the
 * device's `maxTextureDimension2D`, and a ramp as a 256 by 1 `rgba8unorm`
 * texture, each held by its key in a cache within a budget, with the bind
 * group that reads it. A frame's column and row maps go up together, in a
 * storage buffer. Each slice is drawn as one triangle over the whole target,
 * scissored to the device pixels the field paints, and each pixel looks up its
 * cell through the maps and its colour through the ramp (`field-pixels.ts`).
 * Everything here belongs to one device, and is made again whole on the next.
 */

/// <reference types="@webgpu/types" />

import { paints, type FieldPlacement, type FrameLookups } from './field-pixels.js';
import {
  RAMP_TEXTURE_BUDGET,
  TextureCache,
  fieldSlices,
  type FieldSlice,
} from './field-textures.js';
import type { ColourRamp, ScalarField } from './render-frame.js';
import {
  BufferUsage,
  STRAIGHT_ALPHA,
  ShaderStage,
  TextureUsage,
  UNIFORM_STRIDE,
} from './webgpu-flags.js';

const SHADER = /* wgsl */ `
struct FieldDraw { origin: vec2i, maps: vec2i, slice: vec4i };
@group(0) @binding(0) var<uniform> draw: FieldDraw;
@group(0) @binding(1) var<storage, read> lookups: array<f32>;
@group(1) @binding(0) var field: texture_2d<f32>;
@group(2) @binding(0) var ramp: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = vec2i(floor(position.xy)) - draw.origin;
  let cell = vec2i(
    i32(lookups[u32(draw.maps.x + pixel.x)]),
    i32(lookups[u32(draw.maps.y + pixel.y)]),
  ) - draw.slice.xy;
  if (any(cell < vec2i(0)) || any(cell >= draw.slice.zw)) {
    discard;
  }
  let value = i32(round(textureLoad(field, cell, 0).r * 255.0));
  return textureLoad(ramp, vec2i(value, 0), 0);
}
`;

interface Slice extends FieldSlice {
  readonly texture: GPUTexture;
  readonly group: GPUBindGroup;
}

interface Ramp {
  readonly texture: GPUTexture;
  readonly group: GPUBindGroup;
}

/** One slice of a placed field, drawn with the uniforms in its slot. */
export interface FieldDraw {
  readonly placement: FieldPlacement;
  readonly slice: Slice;
  readonly ramp: Ramp;
  readonly slot: number;
}

/** What draws a device's field batches, made with the rest of its resources. */
export class GpuFields {
  readonly #device: GPUDevice;
  readonly pipeline: GPURenderPipeline;
  readonly #frameLayout: GPUBindGroupLayout;
  readonly #textureLayout: GPUBindGroupLayout;
  readonly #largest: number;
  readonly #fields: TextureCache<readonly Slice[]>;
  readonly #ramps: TextureCache<Ramp>;
  #uniforms: GPUBuffer;
  #lookups: GPUBuffer;
  #group: GPUBindGroup;
  #uniformData = new Int32Array((UNIFORM_STRIDE / 4) * 16);

  constructor(device: GPUDevice, format: GPUTextureFormat, budget: number) {
    this.#device = device;
    this.#largest = device.limits.maxTextureDimension2D;
    this.#frameLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.Fragment,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 },
        },
        { binding: 1, visibility: ShaderStage.Fragment, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.#textureLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: ShaderStage.Fragment, texture: { sampleType: 'float' } }],
    });
    this.pipeline = pipelineFor(device, format, [
      this.#frameLayout,
      this.#textureLayout,
      this.#textureLayout,
    ]);
    this.#fields = new TextureCache(budget, (slices) => {
      for (const slice of slices) slice.texture.destroy();
    });
    this.#ramps = new TextureCache(RAMP_TEXTURE_BUDGET, (ramp) => {
      ramp.texture.destroy();
    });
    this.#uniforms = this.#uniformBuffer(16);
    this.#lookups = this.#lookupBuffer(4096);
    this.#group = this.#frameGroup();
  }

  #uniformBuffer(draws: number): GPUBuffer {
    return this.#device.createBuffer({
      size: UNIFORM_STRIDE * draws,
      usage: BufferUsage.Uniform | BufferUsage.CopyDst,
    });
  }

  #lookupBuffer(entries: number): GPUBuffer {
    return this.#device.createBuffer({
      size: 4 * entries,
      usage: BufferUsage.Storage | BufferUsage.CopyDst,
    });
  }

  #frameGroup(): GPUBindGroup {
    return this.#device.createBindGroup({
      layout: this.#frameLayout,
      entries: [
        { binding: 0, resource: { buffer: this.#uniforms, size: 32 } },
        { binding: 1, resource: { buffer: this.#lookups } },
      ],
    });
  }

  /** A texture read texel by texel, written by the queue, with its bind group. */
  #texture(
    format: GPUTextureFormat,
    width: number,
    height: number,
  ): { readonly texture: GPUTexture; readonly group: GPUBindGroup } {
    const texture = this.#device.createTexture({
      size: { width, height },
      format,
      usage: TextureUsage.TextureBinding | TextureUsage.CopyDst,
    });
    const group = this.#device.createBindGroup({
      layout: this.#textureLayout,
      entries: [{ binding: 0, resource: texture.createView() }],
    });
    return { texture, group };
  }

  /** The field's slices, uploaded where the cache holds none. */
  #slices(field: ScalarField): readonly Slice[] {
    const held = this.#fields.take(field.key);
    if (held !== undefined) return held;
    const slices = fieldSlices(field.width, field.height, this.#largest).map((slice) => {
      const made = this.#texture('r8unorm', slice.width, slice.height);
      // Read straight out of the field's own bytes, the offset and row length placing the slice.
      this.#device.queue.writeTexture(
        { texture: made.texture },
        field.values,
        {
          offset: slice.y * field.width + slice.x,
          bytesPerRow: field.width,
          rowsPerImage: slice.height,
        },
        { width: slice.width, height: slice.height },
      );
      return { ...slice, ...made };
    });
    this.#fields.hold(field.key, slices, field.width * field.height);
    return slices;
  }

  /** The ramp's texture, uploaded where the cache holds none. */
  #ramp(ramp: ColourRamp): Ramp {
    const held = this.#ramps.take(ramp.key);
    if (held !== undefined) return held;
    const made = this.#texture('rgba8unorm', 256, 1);
    this.#device.queue.writeTexture(
      { texture: made.texture },
      ramp.colours,
      { bytesPerRow: 1024 },
      { width: 256, height: 1 },
    );
    this.#ramps.hold(ramp.key, made, ramp.colours.length);
    return made;
  }

  /**
   * Uploads a frame's maps, each field and ramp it draws that the caches do
   * not hold, and the uniforms of each slice's draw; answers the draws of each
   * field batch, in the frame's order.
   */
  prepare(lookups: FrameLookups): readonly (readonly FieldDraw[])[] {
    const fieldDraws: FieldDraw[][] = [];
    let slots = 0;
    for (const placement of lookups.placements) {
      const draws: FieldDraw[] = [];
      fieldDraws.push(draws);
      if (!paints(placement)) continue;
      const ramp = this.#ramp(placement.batch.ramp);
      for (const slice of this.#slices(placement.batch.field)) {
        draws.push({ placement, slice, ramp, slot: slots });
        slots += 1;
      }
    }
    if (slots === 0) return fieldDraws;
    this.#ensureCapacity(slots, lookups.values.length);
    const queue = this.#device.queue;
    queue.writeBuffer(this.#lookups, 0, lookups.values);
    for (const draws of fieldDraws) {
      for (const { placement, slice, slot } of draws) {
        this.#uniformData.set(
          [
            placement.span.left,
            placement.span.top,
            placement.columnsAt,
            placement.rowsAt,
            slice.x,
            slice.y,
            slice.width,
            slice.height,
          ],
          (slot * UNIFORM_STRIDE) / 4,
        );
      }
    }
    queue.writeBuffer(this.#uniforms, 0, this.#uniformData, 0, (slots * UNIFORM_STRIDE) / 4);
    return fieldDraws;
  }

  #ensureCapacity(slots: number, entries: number): void {
    let regroup = false;
    if (this.#uniforms.size < slots * UNIFORM_STRIDE) {
      this.#uniforms.destroy();
      this.#uniforms = this.#uniformBuffer(slots * 2);
      regroup = true;
    }
    if (this.#lookups.size < entries * 4) {
      this.#lookups.destroy();
      this.#lookups = this.#lookupBuffer(entries * 2);
      regroup = true;
    }
    if (regroup) this.#group = this.#frameGroup();
    if (this.#uniformData.length < (slots * UNIFORM_STRIDE) / 4) {
      this.#uniformData = new Int32Array((slots * 2 * UNIFORM_STRIDE) / 4);
    }
  }

  /** Records one field batch's draws, scissored to what it paints; its pipeline is left set. */
  record(pass: GPURenderPassEncoder, draws: readonly FieldDraw[]): void {
    for (const { placement, slice, ramp, slot } of draws) {
      const { span } = placement;
      pass.setPipeline(this.pipeline);
      pass.setScissorRect(span.left, span.top, span.width, span.height);
      pass.setBindGroup(0, this.#group, [slot * UNIFORM_STRIDE]);
      pass.setBindGroup(1, slice.group);
      pass.setBindGroup(2, ramp.group);
      pass.draw(3);
    }
  }

  /** Releases what is past the budgets, once the frame is submitted. */
  trim(): void {
    this.#fields.trim();
    this.#ramps.trim();
  }
}

/** The pipeline that draws a field slice, blended over what is there as every batch is. */
function pipelineFor(
  device: GPUDevice,
  format: GPUTextureFormat,
  layouts: readonly GPUBindGroupLayout[],
): GPURenderPipeline {
  const module = device.createShaderModule({ code: SHADER });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [{ format, blend: STRAIGHT_ALPHA }],
    },
    primitive: { topology: 'triangle-list' },
  });
}
