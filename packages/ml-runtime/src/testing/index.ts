/**
 * What the tests of a package that runs models take from this package's test
 * support: the inference port played by a model written in TypeScript, the
 * port over the real runtime, for a pinned golden render, and the inference
 * workers played in the test's own thread, as the page's host starts them.
 */

export { EVERY_CAPABILITY, FAKE_RUNTIME, type FakeModel, FakeInference } from './fake-inference.js';
export { realInference } from './real-inference.js';
export {
  InProcessThread,
  TEST_ORIGIN,
  inProcessChannel,
  inProcessInference,
  testSetup,
} from './in-process-worker.js';
