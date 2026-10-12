/**
 * The backends a browser renderer tries, in order: WebGPU where the browser
 * offers it, WebGL2, then Canvas 2D (ADR-0044). A browser without WebGPU still
 * has it in the list, as a refusal with the reason, so the report says it was
 * considered and why it was not taken.
 */

import { FailureKind, fail, failure } from '@audiogubbins/domain';

import { canvas2dBackend } from './canvas2d-backend.js';
import { RendererKind, type BackendFactory, type Schedule } from './renderer-backend.js';
import { webGl2Backend } from './webgl2-context.js';
import { isGpu, webGpuBackend } from './webgpu-device.js';

const NO_WEBGPU: BackendFactory = {
  kind: RendererKind.WebGpu,
  create: () =>
    Promise.resolve(
      fail(
        failure(
          'renderer.webgpu-absent',
          FailureKind.Unrecoverable,
          'This browser does not offer WebGPU.',
        ),
      ),
    ),
};

/**
 * The backends to try, given what the browser offers as `navigator.gpu`, the
 * page's timers as `schedule`, and `offscreen`, which makes a canvas that is
 * never shown, for the Canvas 2D backend to compose a field's image on.
 */
export function browserBackends(
  gpu: unknown,
  schedule: Schedule,
  offscreen: () => HTMLCanvasElement,
): readonly BackendFactory[] {
  return [
    isGpu(gpu) ? webGpuBackend(gpu) : NO_WEBGPU,
    webGl2Backend(schedule),
    canvas2dBackend(offscreen),
  ];
}
