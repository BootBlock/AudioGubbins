/**
 * The WebGPU backend's drawing (REQ-AUDIO-152, REQ-AUDIO-082).
 *
 * It draws what the WebGL2 backend draws, the same way: every rectangle and
 * segment one instance of a unit quad, one instanced draw per batch with the
 * batch's colour and shape in its own slot of a uniform buffer, inside its
 * layer's scissor, and every field batch in its place among them by its own
 * pipeline (`webgpu-fields.ts`). It draws with the resources of whichever
 * device it is given (`webgpu-device.ts`), and keeps none of a device it is
 * taken off, the field textures it held included (ADR-0044, ADR-0082).
 */

/// <reference types="@webgpu/types" />

import { FieldLookups } from './field-pixels.js';
import {
  backingSize,
  type Rectangle,
  type RectangleBatch,
  type RenderFrame,
  type RenderLayer,
  type SegmentBatch,
} from './render-frame.js';
import type { FieldDraw } from './webgpu-fields.js';
import { UNIFORM_STRIDE } from './webgpu-flags.js';
import { bindGroup, instanceBuffer, uniformBuffer, type Resources } from './webgpu-resources.js';
import {
  AWAY,
  DRAWN,
  RendererKind,
  drawFailed,
  type DrawOutcome,
  type RendererBackend,
} from './renderer-backend.js';

/** A batch of geometry and the layer it is drawn in. */
interface Drawn {
  readonly layer: RenderLayer;
  readonly batch: RectangleBatch | SegmentBatch;
}

/** Draws frames on a WebGPU canvas with the resources of the device it is given. */
export class WebGpuBackend implements RendererBackend {
  readonly kind = RendererKind.WebGpu;
  readonly #context: GPUCanvasContext;
  readonly #format: GPUTextureFormat;
  readonly #lookups = new FieldLookups();
  #resources: Resources | undefined;
  #instanceData = new Float32Array(4096 * 4);
  #uniformData = new Float32Array((UNIFORM_STRIDE / 4) * 16);
  #disposed = false;

  constructor(context: GPUCanvasContext, format: GPUTextureFormat, resources: Resources) {
    this.#context = context;
    this.#format = format;
    this.use(resources);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Draws from now on with `resources`, on their device, and with none of what it held on the last. */
  use(resources: Resources | undefined): void {
    this.#resources = resources;
    if (resources !== undefined) {
      this.#context.configure({
        device: resources.device,
        format: this.#format,
        alphaMode: 'opaque',
      });
    }
  }

  #ensureCapacity(resources: Resources, instances: number, batches: number): void {
    if (resources.instances.size < instances * 16) {
      resources.instances.destroy();
      resources.instances = instanceBuffer(resources.device, instances * 2);
    }
    if (resources.uniforms.size < batches * UNIFORM_STRIDE) {
      resources.uniforms.destroy();
      resources.uniforms = uniformBuffer(resources.device, batches * 2);
      resources.group = bindGroup(resources.device, resources.layout, resources.uniforms);
    }
    if (this.#instanceData.length < instances * 4)
      this.#instanceData = new Float32Array(instances * 8);
    if (this.#uniformData.length < (batches * UNIFORM_STRIDE) / 4) {
      this.#uniformData = new Float32Array((batches * 2 * UNIFORM_STRIDE) / 4);
    }
  }

  #scissor(pass: GPURenderPassEncoder, clip: Rectangle | undefined, frame: RenderFrame): void {
    const size = backingSize(frame);
    const ratio = frame.pixelRatio;
    const x = Math.min(size.width, Math.max(0, Math.round((clip?.x ?? 0) * ratio)));
    const y = Math.min(size.height, Math.max(0, Math.round((clip?.y ?? 0) * ratio)));
    const width = clip === undefined ? size.width : Math.round(clip.width * ratio);
    const height = clip === undefined ? size.height : Math.round(clip.height * ratio);
    pass.setScissorRect(
      x,
      y,
      Math.max(0, Math.min(width, size.width - x)),
      Math.max(0, Math.min(height, size.height - y)),
    );
  }

  draw(frame: RenderFrame): DrawOutcome {
    if (this.#disposed) return drawFailed('The WebGPU backend was disposed.');
    const resources = this.#resources;
    // Between a lost device and the next, which its loss watch asks for.
    if (resources === undefined) return AWAY;
    const size = backingSize(frame);
    const canvas = this.#context.canvas;
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
    const drawn = frame.layers.flatMap((layer) =>
      layer.batches.flatMap((batch) =>
        batch.kind === 'rectangles' || batch.kind === 'segments' ? [{ layer, batch }] : [],
      ),
    );
    const firsts = this.#upload(resources, frame, drawn);
    const fieldDraws = resources.fields.prepare(this.#lookups.pack(frame));
    try {
      this.#encode(resources, frame, firsts, fieldDraws);
    } catch (error) {
      // A context that is not configured for a live device throws on
      // `getCurrentTexture`, which is a backend that cannot draw.
      return drawFailed(
        `The WebGPU draw was refused: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    resources.fields.trim();
    return DRAWN;
  }

  /** Writes every batch's instances and uniforms, and answers each batch's first instance. */
  #upload(resources: Resources, frame: RenderFrame, drawn: readonly Drawn[]): readonly number[] {
    const instances = drawn.reduce((sum, { batch }) => sum + batch.count, 0);
    this.#ensureCapacity(resources, Math.max(1, instances), Math.max(1, drawn.length));
    let at = 0;
    const firsts: number[] = [];
    drawn.forEach(({ batch }, index) => {
      firsts.push(at);
      this.#instanceData.set(batch.values.subarray(0, batch.count * 4), at * 4);
      at += batch.count;
      const segment = batch.kind === 'segments';
      this.#uniformData.set(
        [
          2 / frame.width,
          -2 / frame.height,
          segment ? 1 : 0,
          segment ? batch.width / 2 : 0,
          ...batch.colour,
        ],
        (index * UNIFORM_STRIDE) / 4,
      );
    });
    const queue = resources.device.queue;
    queue.writeBuffer(resources.instances, 0, this.#instanceData, 0, Math.max(4, instances * 4));
    queue.writeBuffer(
      resources.uniforms,
      0,
      this.#uniformData,
      0,
      (Math.max(1, drawn.length) * UNIFORM_STRIDE) / 4,
    );
    return firsts;
  }

  /**
   * Records and submits the pass that clears and draws every batch in its
   * layer's order: geometry in its layer's scissor, and each field in the
   * pixels it paints.
   */
  #encode(
    resources: Resources,
    frame: RenderFrame,
    firsts: readonly number[],
    fieldDraws: readonly (readonly FieldDraw[])[],
  ): void {
    const encoder = resources.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#context.getCurrentTexture().createView(),
          clearValue: { r: frame.clear[0], g: frame.clear[1], b: frame.clear[2], a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    let geometryIndex = 0;
    let fieldIndex = 0;
    // Whether the geometry pipeline and its corners are set, which a field unsets.
    let bound = false;
    for (const layer of frame.layers) {
      for (const batch of layer.batches) {
        if (batch.kind === 'field') {
          const draws = fieldDraws[fieldIndex] ?? [];
          fieldIndex += 1;
          if (draws.length === 0) continue;
          resources.fields.record(pass, draws);
          bound = false;
          continue;
        }
        if (batch.kind !== 'rectangles' && batch.kind !== 'segments') continue;
        const index = geometryIndex;
        geometryIndex += 1;
        if (batch.count === 0) continue;
        if (!bound) {
          pass.setPipeline(resources.pipeline);
          pass.setVertexBuffer(0, resources.corners);
          bound = true;
        }
        this.#scissor(pass, layer.clip, frame);
        pass.setBindGroup(0, resources.group, [index * UNIFORM_STRIDE]);
        pass.setVertexBuffer(1, resources.instances, (firsts[index] ?? 0) * 16);
        pass.draw(4, batch.count);
      }
    }
    pass.end();
    resources.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.#disposed = true;
    this.#resources?.device.destroy();
    this.#resources = undefined;
  }
}
