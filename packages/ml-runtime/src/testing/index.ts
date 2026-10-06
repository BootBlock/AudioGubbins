/**
 * What the tests of a package that runs models take from this package's test
 * support: the inference port played by a model written in TypeScript, and
 * the port over the real runtime, for a pinned golden render.
 */

export { EVERY_CAPABILITY, FAKE_RUNTIME, type FakeModel, FakeInference } from './fake-inference.js';
export { realInference } from './real-inference.js';
