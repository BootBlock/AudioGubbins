/**
 * The WebGL2 backend's context (REQ-AUDIO-152): asked of the canvas, built on,
 * and watched for loss. A lost context is announced by `webglcontextlost`,
 * whose default is prevented so the browser may give it back;
 * `webglcontextrestored` then has everything built again, and the renderer
 * draws the latest frame again (ADR-0044). If it is not given back in time,
 * the renderer steps down to Canvas 2D.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import { FIELD_TEXTURE_BUDGET } from './field-textures.js';
import { RendererKind, type BackendFactory, type Schedule } from './renderer-backend.js';
import { WebGl2Backend, build } from './webgl2-backend.js';

/** How long a lost context is waited for before the renderer steps down. */
const RESTORE_WAIT_MS = 3000;

function unavailable(reason: string): DomainResult<never> {
  return fail(failure('renderer.webgl2-unavailable', FailureKind.Unrecoverable, reason));
}

/**
 * The WebGL2 backend's factory, which waits for a lost context by `schedule`
 * and holds field textures within `fieldBudget` bytes.
 */
export function webGl2Backend(
  schedule: Schedule,
  fieldBudget: number = FIELD_TEXTURE_BUDGET,
): BackendFactory {
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
      const resources = build(gl, fieldBudget);
      if (typeof resources === 'string') return Promise.resolve(unavailable(resources));
      const backend = new WebGl2Backend(gl, resources, fieldBudget);
      let giveUp: (() => void) | undefined;
      canvas.addEventListener('webglcontextlost', (event) => {
        // A disposed backend takes its own context away, and says nothing of it.
        if (backend.disposed) return;
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
        if (backend.disposed) return;
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
