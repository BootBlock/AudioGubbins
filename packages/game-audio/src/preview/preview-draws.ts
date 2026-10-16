/**
 * Every random choice a game preview makes, as a draw of the domain's one
 * counter-based generator (ADR-0104), so a choice is a function of the
 * scenario's seed, the emitter, the decision and the trigger, never of what was
 * drawn before: a suppressed trigger changes no later choice, and an engine's
 * runtime given the same seed makes the same choices.
 *
 * Each step is stated in integers or in IEEE double arithmetic in the order
 * written, so another runtime reproduces it bit for bit:
 *
 * - An emitter's key is `lowbias32(seed ^ crc32(utf8(id)))`. A well-formed
 *   identifier is ASCII, so its UTF-8 is its code units.
 * - A draw is the 32-bit word `h` the domain's `uniformDraw(key, stream,
 *   trigger)` is `h / 2³²` of. A whole choice among `n` is `⌊h·n / 2³²⌋`,
 *   computed exactly ((h·n) >> 32 in 64-bit integers), which is ⌊u·n⌋ for
 *   `u = h / 2³²`: each of the `n` is chosen by ⌊2³²/n⌋ or ⌈2³²/n⌉ of the 2³²
 *   words, so no choice is more likely than another by more than 2⁻³².
 * - A gain is `min + u·(max − min)` decibels, `u` the double `h / 2³²`.
 * - A time in milliseconds is `⌊ms·rate / 1000 + 0.5⌋` frames.
 * - A pitch of `c` cents plays at `n / 4,096` of the speed, `n` the whole
 *   number nearest `4,096 · 2^(c/1200)`, exactly: no `c` from −2,400 to 2,400
 *   lies on a half, so no rounding rule is needed.
 */

import { VARISPEED_DENOMINATOR, crc32, lowbias32, uniformDraw } from '@audiogubbins/domain';

import type { PreviewEmitterId } from './preview-scenario.js';

/** The stream each decision draws from; the index is the trigger's ordinal. */
export const DrawStream = {
  Selection: 1,
  Pitch: 2,
  Gain: 3,
  Offset: 4,
  Jitter: 5,
} as const;
export type DrawStream = (typeof DrawStream)[keyof typeof DrawStream];

const TWO_TO_16 = 2 ** 16;
const TWO_TO_32 = 2 ** 32;

/** The key every draw of `emitter` under `seed` is made with. */
export function emitterKey(seed: number, emitter: PreviewEmitterId): number {
  const bytes = new Uint8Array(emitter.length);
  for (let index = 0; index < emitter.length; index += 1) bytes[index] = emitter.charCodeAt(index);
  return lowbias32((seed ^ crc32(bytes)) >>> 0);
}

/** The 32-bit word drawn for `trigger` from `stream` under `key`. */
export function drawWord(key: number, stream: DrawStream, trigger: number): number {
  return uniformDraw(key, stream, trigger) * TWO_TO_32;
}

/**
 * `⌊word·n / 2³²⌋` exactly, for a whole `n` below 2²⁴: the product is split at
 * 16 bits so no step passes 2⁵³.
 */
export function choiceOf(word: number, n: number): number {
  const high = Math.floor(word / TWO_TO_16);
  const low = word - high * TWO_TO_16;
  return Math.floor((high * n + Math.floor((low * n) / TWO_TO_16)) / TWO_TO_16);
}

/** `u`, the word as a fraction of 2³², in `[0, 1)`. */
export function fractionOf(word: number): number {
  return word / TWO_TO_32;
}

/** `ms` milliseconds as whole frames at `rate`, rounded half up. */
export function framesOf(ms: number, rate: number): number {
  return Math.floor((ms * rate) / 1_000 + 0.5);
}

/**
 * Whether `(2m + 1)/8,192` lies below `2^(cents/1200)`, decided in integers:
 * `(2m + 1)^1200` against `8,192^1200 · 2^cents`, either side multiplied by
 * the power of two that keeps both whole.
 */
function halfBelow(m: number, cents: number): boolean {
  const odd = BigInt(2 * m + 1) ** 1_200n;
  const unit = 8_192n ** 1_200n;
  return cents >= 0 ? odd < unit << BigInt(cents) : odd << BigInt(-cents) < unit;
}

/**
 * The numerator of the varispeed ratio a pitch of `cents` (a whole number,
 * −2,400 to 2,400) plays at, over 4,096: the whole number nearest
 * `4,096 · 2^(cents/1200)`, from 1,024 to 16,384.
 */
export function pitchNumerator(cents: number): number {
  const estimate = VARISPEED_DENOMINATOR * 2 ** (cents / 1_200);
  const below = Math.floor(estimate);
  // The double is within far less than 10⁻⁹ of the true value, so only an
  // estimate this near a half needs the exact comparison.
  if (Math.abs(estimate - below - 0.5) > 1e-9) return Math.round(estimate);
  return halfBelow(below, cents) ? below + 1 : below;
}
