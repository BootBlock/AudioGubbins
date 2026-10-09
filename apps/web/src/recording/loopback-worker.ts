/**
 * The loopback calibration's worker: a module the page starts as a dedicated
 * worker for one measurement (`loopback-measure.ts`), which runs the recording
 * package's analysis on what it is sent and answers its result.
 */

import { sampleRate } from '@audiogubbins/domain';
import { measureRoundTrip } from '@audiogubbins/recording';

import { unmeasured } from './loopback-measure.js';

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const question: unknown = event.data;
  const captured: unknown =
    typeof question === 'object' && question !== null
      ? Reflect.get(question, 'captured')
      : undefined;
  const rate: unknown =
    typeof question === 'object' && question !== null ? Reflect.get(question, 'rate') : undefined;
  if (!(captured instanceof Float32Array) || typeof rate !== 'number') {
    self.postMessage(unmeasured('the capture did not reach the worker whole.'));
    return;
  }
  const checked = sampleRate(rate);
  self.postMessage(checked.ok ? measureRoundTrip(captured, checked.value) : checked);
});
