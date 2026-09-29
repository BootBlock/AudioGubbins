/**
 * The backends a browser renderer tries, in order: WebGPU where the browser
 * offers it, WebGL2, then Canvas 2D (ADR-0044). A browser without WebGPU still
 * has it in the list, as a refusal with the reason, so the report says it was
 * considered and why it was not taken.
 */

import { FailureKind, fail, failure } from '@audiogubbins/domain';

import { CANVAS_2D_BACKEND } from './canvas2d-backend.js';
import { RendererKind, type BackendFactory } from './renderer-backend.js';
import { WEBGL2_BACKEND } from './webgl2-backend.js';
import { isGpu, webGpuBackend } from './webgpu-backend.js';

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

/** The backends to try, given what the browser offers as `navigator.gpu`. */
export function browserBackends(gpu: unknown): readonly BackendFactory[] {
  return [isGpu(gpu) ? webGpuBackend(gpu) : NO_WEBGPU, WEBGL2_BACKEND, CANVAS_2D_BACKEND];
}
