/**
 * What another package's tests may take from the game-audio test support:
 * random valid game-audio worlds from a seed (REQ-REPO-191), the project and
 * its game-audio state together, so the project format's round trip and the
 * history's differences hold every field of the state to a property; and the
 * catalogue the preview's tests plan with, which the application's tests hold
 * to the processors' own, since this package may not reach them.
 *
 * Apart from the package's own entry point, because none of it is production
 * code: an architecture rule refuses any production module that reaches test
 * support.
 */

export { type GameWorld, randomEmitterRules, randomGameWorld } from './random-game-state.js';
export { randomScenario } from './random-scenarios.js';
export { type Random, seededRandom } from './seeded-random.js';
export { PREVIEW_TEST_CATALOGUE } from './preview-vectors.js';
