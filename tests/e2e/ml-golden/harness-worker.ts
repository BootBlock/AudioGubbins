/**
 * The golden harness's thread, which stands where the application's render
 * worker does: it is given its model channel by the page, as every thread
 * that runs chains is, and runs a golden's pass with the processor types made
 * over that channel, so each model runs in the real inference worker and its
 * files are read through the page. It answers each render with the number of
 * samples made and the SHA-256 of their bytes, or why it failed.
 */

import { ModelChannel } from '@audiogubbins/ml-runtime';

import { goldenSamples, mlGolden } from '../../../packages/processors/src/testing/ml-goldens.js';
import type { FromHarnessThread } from './harness-messages.js';
import { isRenderRequest } from './harness-messages.js';

const models = new ModelChannel(() => new MessageChannel());

/** Lower-case hexadecimal of `bytes`. */
function hexadecimal(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function render(name: string): Promise<FromHarnessThread> {
  try {
    const samples = await goldenSamples(mlGolden(name), { inference: models, models });
    // A copy, whose buffer is its own: the samples' bytes in order.
    const digest = await crypto.subtle.digest('SHA-256', samples.slice().buffer);
    return { kind: 'rendered', name, samples: samples.length, sha256: hexadecimal(digest) };
  } catch (error) {
    // Every failure is the answer: the spec prints it as the reason.
    return { kind: 'failed', name, reason: error instanceof Error ? error.message : String(error) };
  }
}

self.addEventListener('message', (event: MessageEvent) => {
  if (models.receive(event.data)) return;
  if (!isRenderRequest(event.data)) return;
  void render(event.data.name).then((answer) => {
    self.postMessage(answer);
  });
});
