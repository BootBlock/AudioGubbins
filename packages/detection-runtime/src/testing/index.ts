/**
 * What other packages' tests take from the detection worker's test support:
 * the real worker's core run in the test's own thread behind the port the
 * page talks to, and a signal holding a fault of each kind it acts on.
 */

export {
  type LocalDetectionOptions,
  LocalDetectionWorker,
  turn,
} from './local-detection-worker.js';
export {
  CLICKS,
  FAULTY_LENGTH,
  HUM_HERTZ,
  QUIET,
  faultyDescription,
  faultySignal,
} from './faulty-signal.js';
