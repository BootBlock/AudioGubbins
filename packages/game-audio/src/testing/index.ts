/**
 * What another package's tests may take from the game-audio test support:
 * random valid game-audio worlds from a seed (REQ-REPO-191), the project and
 * its game-audio state together, so the project format's round trip and the
 * history's differences hold every field of the state to a property.
 *
 * Apart from the package's own entry point, because none of it is production
 * code: an architecture rule refuses any production module that reaches test
 * support.
 */

export { type GameWorld, type Random, randomGameWorld, seededRandom } from './random-game-state.js';
