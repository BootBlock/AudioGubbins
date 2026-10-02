/**
 * What another package's tests may take from the project format's test support:
 * project states built to satisfy the aggregate's invariants, random values and
 * states from a seed for property tests (REQ-REPO-191), and hosts that give
 * long work its turns.
 *
 * Apart from the package's own entry point, because none of it is production
 * code: an architecture rule refuses any production module that reaches test
 * support. Nothing here takes the fixtures package, which only a test may
 * take; a state built from its sample project is given the project.
 */

export {
  type SampleProject,
  contentIdOfDigit,
  referenceState,
  withSources,
} from './project-states.js';

export { type CountedTurns, countedTurns, immediateTurns } from './host-turns.js';

export { randomState } from './random-states.js';

export {
  type Random,
  randomAssetRecord,
  randomContentId,
  randomIdentity,
  randomMedia,
  randomName,
  seededRandom,
} from './random-values.js';
