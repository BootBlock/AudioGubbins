/**
 * The loopback measurement as the browser runs it: in a worker of its own,
 * started for the one measurement and ended once it answers
 * (`loopback-measure.ts`).
 */

import { moduleWorkerClass } from '../module-worker.js';
import loopbackWorkerUrl from './loopback-worker.ts?worker&url';
import {
  measurementOf,
  unmeasured,
  type LoopbackQuestion,
  type MeasureRoundTrip,
} from './loopback-measure.js';

/** Measures in a worker started for each measurement. */
export const measureInWorker: MeasureRoundTrip = (captured, rate) => {
  const LoopbackWorker = moduleWorkerClass();
  const worker = new LoopbackWorker(loopbackWorkerUrl, 'loopback calibration');
  return new Promise((answer) => {
    const done = (result: Awaited<ReturnType<MeasureRoundTrip>>): void => {
      worker.terminate();
      answer(result);
    };
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      done(measurementOf(event.data));
    });
    worker.addEventListener('messageerror', () => {
      done(unmeasured('its answer could not be received.'));
    });
    worker.addEventListener('error', (event) => {
      // Handled here, where the calibration says why it failed, rather than
      // reported again as an error of the page.
      event.preventDefault();
      done(unmeasured(event.message === '' ? 'its worker could not run.' : event.message));
    });
    const question: LoopbackQuestion = { captured, rate };
    worker.postMessage(question, [captured.buffer]);
  });
};
