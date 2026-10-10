/**
 * The WebGPU backend's device, taken where the browser gives an adapter and a
 * device and the device passes a validation draw (REQ-AUDIO-152,
 * REQ-AUDIO-082). WebGPU is never a prerequisite: any refusal here is a reason
 * in the renderer's report, and the renderer takes WebGL2 instead.
 *
 * A lost device is announced by `device.lost`. The backend is asked for a new
 * device once, which must pass the validation draw before it is used, and has
 * the latest frame drawn again; if none is given it fails, and the renderer
 * steps down (ADR-0044).
 */

/// <reference types="@webgpu/types" />

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import { FIELD_TEXTURE_BUDGET } from './field-textures.js';
import type { RenderFrame } from './render-frame.js';
import { RendererKind, type BackendEvents, type BackendFactory } from './renderer-backend.js';
import { WebGpuBackend } from './webgpu-backend.js';
import { build, type Resources } from './webgpu-resources.js';

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

function unavailable(reason: string): DomainResult<never> {
  return fail(failure('renderer.webgpu-unavailable', FailureKind.Unrecoverable, reason));
}

/** A device from `adapter` with a pipeline that passed validation, or why there is none. */
async function validated(
  adapter: GPUAdapter,
  format: GPUTextureFormat,
  fieldBudget: number,
): Promise<Resources | string> {
  const device = await adapter.requestDevice();
  device.pushErrorScope('validation');
  const resources = build(device, format, fieldBudget);
  const problem = await device.popErrorScope();
  if (problem !== null) {
    device.destroy();
    return `The device refused the pipeline: ${problem.message}`;
  }
  return resources;
}

/**
 * The validation draw: a frame of one rectangle, drawn and submitted inside an
 * error scope, so a device that accepts a pipeline and then refuses to draw
 * with it, or a canvas not configured for it, is refused here and not on
 * screen. Answers why it was refused, or nothing.
 */
async function refusesToDraw(
  backend: WebGpuBackend,
  device: GPUDevice,
): Promise<string | undefined> {
  device.pushErrorScope('validation');
  const drawn = backend.draw(VALIDATION_FRAME);
  const refused = await device.popErrorScope();
  if (drawn.kind === 'failed') return drawn.reason;
  return refused === null ? undefined : refused.message;
}

/**
 * Watches `device` for as long as the backend draws with it: a loss asks the
 * adapter for another, which must pass the validation draw before it is used;
 * an error no scope caught means a draw was not made, and the backend fails.
 */
function watch(
  gpu: GPU,
  backend: WebGpuBackend,
  format: GPUTextureFormat,
  fieldBudget: number,
  device: GPUDevice,
  events: BackendEvents,
): void {
  device.addEventListener('uncapturederror', (event) => {
    if (backend.disposed) return;
    events.failed(`The GPU device refused a draw: ${event.error.message}`);
  });
  void device.lost.then(async (info) => {
    if (backend.disposed) return;
    backend.use(undefined);
    events.lost(`The GPU device was lost: ${info.message || info.reason}`);
    const adapter = await gpu.requestAdapter();
    const rebuilt =
      adapter === null
        ? 'The browser gave no adapter after the loss.'
        : await validated(adapter, format, fieldBudget);
    if (typeof rebuilt === 'string') {
      events.failed(rebuilt);
      return;
    }
    backend.use(rebuilt);
    const refused = await refusesToDraw(backend, rebuilt.device);
    if (refused !== undefined) {
      events.failed(`The new GPU device refused a validation draw: ${refused}`);
      return;
    }
    watch(gpu, backend, format, fieldBudget, rebuilt.device, events);
    events.restored();
  });
}

/**
 * The WebGPU backend's factory, over the browser's `navigator.gpu`, holding
 * field textures within `fieldBudget` bytes.
 */
export function webGpuBackend(
  gpu: GPU,
  fieldBudget: number = FIELD_TEXTURE_BUDGET,
): BackendFactory {
  return {
    kind: RendererKind.WebGpu,
    create: async (canvas, events) => {
      try {
        const adapter = await gpu.requestAdapter();
        if (adapter === null) return unavailable('The browser gave no WebGPU adapter.');
        const context = canvas.getContext('webgpu');
        if (context === null) return unavailable('The canvas gave no WebGPU context.');
        const format = gpu.getPreferredCanvasFormat();
        const resources = await validated(adapter, format, fieldBudget);
        if (typeof resources === 'string') return unavailable(resources);
        const backend = new WebGpuBackend(context, format, resources);
        const refused = await refusesToDraw(backend, resources.device);
        if (refused !== undefined) {
          backend.dispose();
          return unavailable(`The device refused a validation draw: ${refused}`);
        }
        watch(gpu, backend, format, fieldBudget, resources.device, events);
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
