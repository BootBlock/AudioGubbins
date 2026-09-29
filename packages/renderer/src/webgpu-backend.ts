/**
 * The WebGPU backend, taken where the browser gives an adapter and a device and
 * the device passes a validation draw (REQ-AUDIO-152, REQ-AUDIO-082).
 *
 * It draws what the WebGL2 backend draws, the same way: every rectangle and
 * segment one instance of a unit quad, one instanced draw per batch with the
 * batch's colour and shape in its own slot of a uniform buffer, inside its
 * layer's scissor. WebGPU is never a prerequisite: any refusal here is a reason
 * in the renderer's report, and the renderer takes WebGL2 instead.
 *
 * A lost device is announced by `device.lost`. The backend asks the adapter for
 * a new device once, rebuilds on it and has the latest frame drawn again; if
 * none is given it fails, and the renderer steps down (ADR-0044).
 */

/// <reference types="@webgpu/types" />

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import {
  backingSize,
  type Rectangle,
  type RectangleBatch,
  type RenderFrame,
  type RenderLayer,
  type SegmentBatch,
} from './render-frame.js';
import {
  UNIFORM_STRIDE,
  bindGroup,
  build,
  instanceBuffer,
  uniformBuffer,
  type Resources,
} from './webgpu-resources.js';
import {
  RendererKind,
  type BackendEvents,
  type BackendFactory,
  type RendererBackend,
} from './renderer-backend.js';

/** One rectangle on one pixel: the frame a new device must draw before it is used. */
const VALIDATION_FRAME: RenderFrame = {
  width: 1,
  height: 1,
  pixelRatio: 1,
  clear: [0, 0, 0, 1],
  layers: [
    {
      batches: [
        {
          kind: 'rectangles',
          colour: [1, 1, 1, 1],
          values: new Float32Array([0, 0, 1, 1]),
          count: 1,
        },
      ],
    },
  ],
};

/** Whether a value is the browser's `navigator.gpu`, by its shape. */
export function isGpu(value: unknown): value is GPU {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'requestAdapter') === 'function' &&
    typeof Reflect.get(value, 'getPreferredCanvasFormat') === 'function'
  );
}

/** A batch of geometry and the layer it is drawn in. */
interface Drawn {
  readonly layer: RenderLayer;
  readonly batch: RectangleBatch | SegmentBatch;
}

class WebGpuBackend implements RendererBackend {
  readonly kind = RendererKind.WebGpu;
  readonly #context: GPUCanvasContext;
  readonly #format: GPUTextureFormat;
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

  /** Draws from now on with `resources`, on their device. */
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

  draw(frame: RenderFrame): boolean {
    const resources = this.#resources;
    if (resources === undefined || this.#disposed) return false;
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
    this.#encode(resources, frame, drawn, firsts);
    return true;
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

  /** Records and submits the pass that clears and draws every batch in its layer's scissor. */
  #encode(
    resources: Resources,
    frame: RenderFrame,
    drawn: readonly Drawn[],
    firsts: readonly number[],
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
    pass.setPipeline(resources.pipeline);
    pass.setVertexBuffer(0, resources.corners);
    drawn.forEach(({ layer, batch }, index) => {
      if (batch.count === 0) return;
      this.#scissor(pass, layer.clip, frame);
      pass.setBindGroup(0, resources.group, [index * UNIFORM_STRIDE]);
      pass.setVertexBuffer(1, resources.instances, (firsts[index] ?? 0) * 16);
      pass.draw(4, batch.count);
    });
    pass.end();
    resources.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.#disposed = true;
    this.#resources?.device.destroy();
    this.#resources = undefined;
  }
}

function unavailable(reason: string): DomainResult<never> {
  return fail(failure('renderer.webgpu-unavailable', FailureKind.Unrecoverable, reason));
}

/** A device from `adapter` with a pipeline that passed validation, or why there is none. */
async function validated(
  adapter: GPUAdapter,
  format: GPUTextureFormat,
): Promise<Resources | string> {
  const device = await adapter.requestDevice();
  device.pushErrorScope('validation');
  const resources = build(device, format);
  const problem = await device.popErrorScope();
  if (problem !== null) {
    device.destroy();
    return `The device refused the pipeline: ${problem.message}`;
  }
  return resources;
}

function watchLoss(
  gpu: GPU,
  backend: WebGpuBackend,
  format: GPUTextureFormat,
  device: GPUDevice,
  events: BackendEvents,
): void {
  void device.lost.then(async (info) => {
    if (backend.disposed) return;
    backend.use(undefined);
    events.lost(`The GPU device was lost: ${info.message || info.reason}`);
    const adapter = await gpu.requestAdapter();
    const rebuilt =
      adapter === null
        ? 'The browser gave no adapter after the loss.'
        : await validated(adapter, format);
    if (typeof rebuilt === 'string') {
      events.failed(rebuilt);
      return;
    }
    backend.use(rebuilt);
    watchLoss(gpu, backend, format, rebuilt.device, events);
    events.restored();
  });
}

/** The WebGPU backend's factory, over the browser's `navigator.gpu`. */
export function webGpuBackend(gpu: GPU): BackendFactory {
  return {
    kind: RendererKind.WebGpu,
    create: async (canvas, events) => {
      try {
        const adapter = await gpu.requestAdapter();
        if (adapter === null) return unavailable('The browser gave no WebGPU adapter.');
        const context = canvas.getContext('webgpu');
        if (context === null) return unavailable('The canvas gave no WebGPU context.');
        const format = gpu.getPreferredCanvasFormat();
        const resources = await validated(adapter, format);
        if (typeof resources === 'string') return unavailable(resources);
        const backend = new WebGpuBackend(context, format, resources);
        // The validation draw: a frame of one rectangle, drawn and submitted
        // inside an error scope, so a device that accepts a pipeline and then
        // refuses to draw with it is refused here and not on screen.
        resources.device.pushErrorScope('validation');
        backend.draw(VALIDATION_FRAME);
        const refused = await resources.device.popErrorScope();
        if (refused !== null) {
          backend.dispose();
          return unavailable(`The device refused a validation draw: ${refused.message}`);
        }
        watchLoss(gpu, backend, format, resources.device, events);
        return succeed(backend);
      } catch (error) {
        // A browser's WebGPU refuses by throwing as well as by answering null:
        // a device request can reject, and a context can throw on configure.
        return unavailable(
          `WebGPU refused: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
