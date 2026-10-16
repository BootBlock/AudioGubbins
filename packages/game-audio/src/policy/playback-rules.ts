/**
 * The authored playback rules (ADR-0101, ADR-0104), split by who holds them.
 *
 * A game engine's player holds one set of rules for everything it plays, which
 * `EmitterRules` states: how it selects among a group's members, how many
 * voices it sounds and which it steals, how long it waits between triggers, and
 * how it attenuates and filters with distance. Each sound it plays may vary on
 * its own, which `VoiceVariation` states. So a member may override its
 * variation but never its group's emitter rules.
 *
 * The defaults are what the preview plays where a field resolves unset, and the
 * interface says so beside them; they are never written into a group.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

export type SelectionRule =
  | { readonly kind: 'uniform' }
  /** Never the last `depth` chosen (1 to 16), where the pool leaves another. */
  | { readonly kind: 'avoid-recent'; readonly depth: number };

export type VoiceStealing = 'oldest' | 'quietest' | 'reject';

export type Attenuation =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'inverse' | 'inverse-square' | 'logarithmic';
      /** The distance of no attenuation, 0.01 to 1,000,000: metres in 3D, pixels in 2D. */
      readonly unitSize: number;
      /**
       * The distance from which the emitter is silent, above `unitSize` and at
       * most 1,000,000, or 0 for no limit, as Godot's players read it.
       */
      readonly maxDistance: number;
      /** The most gain attenuation gives, −80 to 24 dB. */
      readonly ceilingDecibels: number;
    }
  | {
      readonly kind: 'exponent';
      /** The distance from which the emitter is silent, at most 1,000,000, or 0 for no limit. */
      readonly maxDistance: number;
      /** 0.01 to 16. */
      readonly exponent: number;
    };

/** Godot 4's attenuation filter: a high shelf that deepens with distance. */
export interface DistanceFilter {
  /** 20 to 20,000 Hz, and at most 0.45 of the rate where it is realised. */
  readonly cutoffHertz: number;
  /** The shelf's gain at full attenuation, −80 to 0 dB. */
  readonly decibels: number;
}

export interface EmitterRules {
  readonly selection: SelectionRule;
  /** At most `limit` (1 to 64) voices sound at once; past it, `stealing` decides. */
  readonly voices: { readonly limit: number; readonly stealing: VoiceStealing };
  /** 0 to 60,000 ms from one started trigger to the next that may start. */
  readonly cooldownMilliseconds: number;
  readonly attenuation: Attenuation;
  readonly filter?: DistanceFilter;
}

export interface VoiceVariation {
  /** Whole cents, −2,400 to 2,400, `min` at most `max`. */
  readonly pitchCents: { readonly min: number; readonly max: number };
  /** −60 to 12 dB, `min` at most `max`. */
  readonly gainDecibels: { readonly min: number; readonly max: number };
  /** How far into the member a voice may start, 0 to 10,000 ms. */
  readonly startOffsetMilliseconds: { readonly max: number };
}

/** Uniform selection, 8 voices stealing the oldest, no cooldown, no attenuation, no filter. */
export const DEFAULT_EMITTER_RULES: EmitterRules = {
  selection: { kind: 'uniform' },
  voices: { limit: 8, stealing: 'oldest' },
  cooldownMilliseconds: 0,
  attenuation: { kind: 'none' },
};

/** No variation: every voice at the member's own pitch, gain and start. */
export const DEFAULT_VOICE_VARIATION: VoiceVariation = {
  pitchCents: { min: 0, max: 0 },
  gainDecibels: { min: 0, max: 0 },
  startOffsetMilliseconds: { max: 0 },
};

interface Range {
  readonly lowest: number;
  readonly highest: number;
}

/**
 * The spatial panner's ranges of a distance (`spatial-panner.ts` of the
 * processors, which this package may not reach): a validated rule is one the
 * preview's panner takes, so the preview never refuses a scenario the project
 * holds.
 */
const UNIT_SIZE: Range = { lowest: 0.01, highest: 1_000_000 };
const FARTHEST_DISTANCE = 1_000_000;
/** Godot's, and the panner's, maximum distance of no limit. */
const NO_DISTANCE_LIMIT = 0;
const AVOID_RECENT_DEPTH: Range = { lowest: 1, highest: 16 };
const VOICE_LIMIT: Range = { lowest: 1, highest: 64 };
const COOLDOWN_MILLISECONDS: Range = { lowest: 0, highest: 60_000 };
const CEILING_DECIBELS: Range = { lowest: -80, highest: 24 };
const EXPONENT: Range = { lowest: 0.01, highest: 16 };
const CUTOFF_HERTZ: Range = { lowest: 20, highest: 20_000 };
const FILTER_DECIBELS: Range = { lowest: -80, highest: 0 };
const PITCH_CENTS: Range = { lowest: -2_400, highest: 2_400 };
const GAIN_DECIBELS: Range = { lowest: -60, highest: 12 };
const START_OFFSET_MILLISECONDS: Range = { lowest: 0, highest: 10_000 };

function within(value: number, range: Range): boolean {
  return Number.isFinite(value) && value >= range.lowest && value <= range.highest;
}

function wholeWithin(value: number, range: Range): boolean {
  return Number.isInteger(value) && within(value, range);
}

function words(range: Range): string {
  return `${String(range.lowest)} to ${String(range.highest)}`;
}

/** Whether `distance` is no limit, or one above `floor` and at most the farthest. */
function maximumDistance(distance: number, floor: number): boolean {
  return (
    distance === NO_DISTANCE_LIMIT ||
    (Number.isFinite(distance) && distance > floor && distance <= FARTHEST_DISTANCE)
  );
}

function emitterInvalid(part: string, sentence: string): DomainFailure {
  return failure('game.emitter-invalid', FailureKind.Rejected, sentence, { details: { part } });
}

function attenuationProblems(attenuation: Attenuation): readonly DomainFailure[] {
  if (attenuation.kind === 'none') return [];
  const problems: DomainFailure[] = [];
  if (attenuation.kind === 'exponent') {
    if (!maximumDistance(attenuation.maxDistance, 0)) {
      problems.push(
        emitterInvalid(
          'attenuation.maxDistance',
          `Attenuation is silent from a distance above 0 and at most ${String(FARTHEST_DISTANCE)}, or 0 for no limit.`,
        ),
      );
    }
    if (!within(attenuation.exponent, EXPONENT)) {
      problems.push(
        emitterInvalid(
          'attenuation.exponent',
          `An attenuation's exponent is from ${words(EXPONENT)}.`,
        ),
      );
    }
    return problems;
  }
  if (!within(attenuation.unitSize, UNIT_SIZE)) {
    problems.push(
      emitterInvalid(
        'attenuation.unitSize',
        `An attenuation's unit size is from ${words(UNIT_SIZE)}.`,
      ),
    );
  }
  if (!maximumDistance(attenuation.maxDistance, attenuation.unitSize)) {
    problems.push(
      emitterInvalid(
        'attenuation.maxDistance',
        `Attenuation is silent from a distance above its unit size and at most ${String(FARTHEST_DISTANCE)}, or 0 for no limit.`,
      ),
    );
  }
  if (!within(attenuation.ceilingDecibels, CEILING_DECIBELS)) {
    problems.push(
      emitterInvalid(
        'attenuation.ceilingDecibels',
        `An attenuation's ceiling is from ${words(CEILING_DECIBELS)} dB.`,
      ),
    );
  }
  return problems;
}

function filterProblems(filter: DistanceFilter | undefined): readonly DomainFailure[] {
  if (filter === undefined) return [];
  const problems: DomainFailure[] = [];
  if (!within(filter.cutoffHertz, CUTOFF_HERTZ)) {
    problems.push(
      emitterInvalid(
        'filter.cutoffHertz',
        `A distance filter's cutoff is from ${words(CUTOFF_HERTZ)} Hz.`,
      ),
    );
  }
  if (!within(filter.decibels, FILTER_DECIBELS)) {
    problems.push(
      emitterInvalid(
        'filter.decibels',
        `A distance filter's gain is from ${words(FILTER_DECIBELS)} dB.`,
      ),
    );
  }
  return problems;
}

/** Every value of `rules` out of its range. */
export function emitterRulesProblems(rules: EmitterRules): readonly DomainFailure[] {
  const problems: DomainFailure[] = [];
  if (
    rules.selection.kind === 'avoid-recent' &&
    !wholeWithin(rules.selection.depth, AVOID_RECENT_DEPTH)
  ) {
    problems.push(
      emitterInvalid(
        'selection.depth',
        `Selection avoids the last ${words(AVOID_RECENT_DEPTH)} chosen, a whole number.`,
      ),
    );
  }
  if (!wholeWithin(rules.voices.limit, VOICE_LIMIT)) {
    problems.push(
      emitterInvalid(
        'voices.limit',
        `An emitter sounds ${words(VOICE_LIMIT)} voices, a whole number.`,
      ),
    );
  }
  if (!within(rules.cooldownMilliseconds, COOLDOWN_MILLISECONDS)) {
    problems.push(
      emitterInvalid(
        'cooldownMilliseconds',
        `An emitter's cooldown is from ${words(COOLDOWN_MILLISECONDS)} ms.`,
      ),
    );
  }
  return [...problems, ...attenuationProblems(rules.attenuation), ...filterProblems(rules.filter)];
}

function variationInvalid(part: string, sentence: string): DomainFailure {
  return failure('game.variation-invalid', FailureKind.Rejected, sentence, { details: { part } });
}

/** Every value of `variation` out of its range, and every range whose `min` passes its `max`. */
export function voiceVariationProblems(variation: VoiceVariation): readonly DomainFailure[] {
  const problems: DomainFailure[] = [];
  const { pitchCents, gainDecibels, startOffsetMilliseconds } = variation;
  if (
    !wholeWithin(pitchCents.min, PITCH_CENTS) ||
    !wholeWithin(pitchCents.max, PITCH_CENTS) ||
    pitchCents.min > pitchCents.max
  ) {
    problems.push(
      variationInvalid(
        'pitchCents',
        `A voice's pitch varies by whole cents from ${words(PITCH_CENTS)}, the least first.`,
      ),
    );
  }
  if (
    !within(gainDecibels.min, GAIN_DECIBELS) ||
    !within(gainDecibels.max, GAIN_DECIBELS) ||
    gainDecibels.min > gainDecibels.max
  ) {
    problems.push(
      variationInvalid(
        'gainDecibels',
        `A voice's gain varies from ${words(GAIN_DECIBELS)} dB, the least first.`,
      ),
    );
  }
  if (!within(startOffsetMilliseconds.max, START_OFFSET_MILLISECONDS)) {
    problems.push(
      variationInvalid(
        'startOffsetMilliseconds',
        `The furthest a voice starts into its member is from ${words(START_OFFSET_MILLISECONDS)} ms.`,
      ),
    );
  }
  return problems;
}
