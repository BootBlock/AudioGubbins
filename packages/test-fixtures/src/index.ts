/**
 * The public contract of the AudioGubbins test fixtures.
 *
 * REQ-REPO-191 requires a deliberately small, legally clean set of reference
 * material that contributors, agents and automated tests can use without any
 * external setup. Every fixture here is generated from its parameters, so there
 * is nothing to license, nothing to store, and nothing that can differ between
 * two machines.
 *
 * Beside them are two measures, which generate nothing, so a test of cost
 * holds code to what does not depend on one machine's speed:
 * {@link relativeCost} reads what one workload costs against another, as a
 * ratio, within {@link LONGEST_COST_TEST_MS}, the timeout of each test of it;
 * and {@link comparisonsIn} counts the comparisons of names a piece of work
 * makes, up to a ceiling, which {@link N_LOG_N_FOURFOLD} sets for four times
 * the names.
 *
 * The architecture rules forbid importing this package from production code. A
 * fixture that reached a shipped build would be exactly the fabricated
 * production data REQ-EXEC-181 treats as a gate failure.
 *
 * Provenance and the stability rule are recorded in PROVENANCE.md beside this.
 */

export {
  FIXTURE_LENGTH,
  FIXTURE_SAMPLE_RATE,
  type SignalFixture,
  type SignalOptions,
  chirp,
  clickInSine,
  directCurrent,
  impulse,
  loopableSine,
  noise,
  noisySine,
  peakOf,
  rmsOf,
  silence,
  sine,
  stereo,
  surround5_1,
  transient,
} from './signals.js';

export { type ProjectFixture, emptyProject, sampleProject } from './projects.js';

export { wavFile } from './wav-files.js';

export { N_LOG_N_FOURFOLD, comparisonsIn } from './comparisons.js';

export { LONGEST_COST_TEST_MS, relativeCost } from './processor-cost.js';
