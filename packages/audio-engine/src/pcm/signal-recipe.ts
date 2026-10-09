/**
 * Generated audio as a recipe: what each channel plays, segment by segment.
 *
 * A recipe describes audio of any length in a few hundred bytes, so an asset of
 * hours crosses a thread and is made on demand, never held (ADR-0045,
 * REQ-EXEC-216). A channel plays its segments in order, silence, an impulse or
 * a tone from the canonical oscillator, and either repeats them or falls silent
 * after the last. The recipe is validated by {@link signalRecipe}, which reads
 * a value of unknown shape by the one reader of a message's fields: a value
 * built in code and a value that crossed a thread are held to the same rules,
 * and a message cannot ask a worker for unbounded work.
 */

import {
  Malformed,
  boundedItemsOf,
  fieldsOf,
  flagOf,
  readValue,
  sampleCountOf,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

/** One stretch of a channel's programme. */
export type SignalSegment =
  | { readonly kind: 'silence'; readonly length: SampleCount }
  | {
      /** One sample of `amplitude` at the segment's first frame, then silence. */
      readonly kind: 'impulse';
      readonly length: SampleCount;
      readonly amplitude: number;
    }
  | {
      /** A sine from phase zero at the segment's first frame. */
      readonly kind: 'tone';
      readonly length: SampleCount;
      readonly frequency: number;
      readonly amplitude: number;
    };

/** What one channel plays. */
export interface ChannelProgramme {
  readonly segments: readonly SignalSegment[];
  /** Whether the segments play again from the first once the last ends. */
  readonly repeats: boolean;
}

/** Generated audio: a programme for each channel, and how long it lasts. */
export interface SignalRecipe {
  readonly channels: readonly ChannelProgramme[];
  readonly length: SampleCount;
}

/** The most channels a recipe may describe: the domain's largest layout. */
const MAXIMUM_CHANNELS = 256;

/** The most segments a channel may have, so reading a recipe is bounded work. */
const MAXIMUM_SEGMENTS = 4096;

function amplitudeOf(value: unknown, field: string): number {
  if (typeof value !== 'number' || !(value >= -1 && value <= 1)) {
    throw new Malformed(field, 'an amplitude from -1 to 1');
  }
  return value;
}

function frequencyOf(value: unknown, field: string): number {
  if (typeof value !== 'number' || !(value > 0) || !Number.isFinite(value)) {
    throw new Malformed(field, 'a frequency above zero');
  }
  return value;
}

function segmentOf(value: unknown, field: string): SignalSegment {
  const fields = fieldsOf(value, field);
  const length = sampleCountOf(fields['length'], `${field}.length`);
  if (length === 0) throw new Malformed(`${field}.length`, 'at least one frame');
  switch (fields['kind']) {
    case 'silence':
      return { kind: 'silence', length };
    case 'impulse':
      return {
        kind: 'impulse',
        length,
        amplitude: amplitudeOf(fields['amplitude'], `${field}.amplitude`),
      };
    case 'tone':
      return {
        kind: 'tone',
        length,
        frequency: frequencyOf(fields['frequency'], `${field}.frequency`),
        // A tone's peak is its amplitude's size; its sign would only turn it over.
        amplitude: Math.abs(amplitudeOf(fields['amplitude'], `${field}.amplitude`)),
      };
    default:
      throw new Malformed(`${field}.kind`, 'silence, an impulse or a tone');
  }
}

function programmeOf(value: unknown, field: string): ChannelProgramme {
  const fields = fieldsOf(value, field);
  const segments = boundedItemsOf(
    fields['segments'],
    `${field}.segments`,
    MAXIMUM_SEGMENTS,
    segmentOf,
  );
  const repeats = flagOf(fields['repeats'], `${field}.repeats`);
  if (repeats && segments.length === 0) {
    throw new Malformed(`${field}.segments`, 'at least one segment to repeat');
  }
  const programme = { segments, repeats };
  if (!Number.isSafeInteger(programmeLength(programme))) {
    throw new Malformed(`${field}.segments`, 'a programme shorter than 2^53 frames');
  }
  return programme;
}

/**
 * The recipe `value` holds, named `field`: a list of at most 256 channel
 * programmes, each of at most {@link MAXIMUM_SEGMENTS} segments of at least
 * one frame, and a length in frames; a field reader for a message that
 * carries one.
 */
export function signalRecipeOf(value: unknown, field: string): SignalRecipe {
  const fields = fieldsOf(value, field);
  const channels = boundedItemsOf(
    fields['channels'],
    `${field}.channels`,
    MAXIMUM_CHANNELS,
    programmeOf,
  );
  if (channels.length === 0) throw new Malformed(`${field}.channels`, 'a list of at least one');
  return { channels, length: sampleCountOf(fields['length'], `${field}.length`) };
}

/** A recipe read from a value of any shape, as {@link signalRecipeOf} reads it, or why it is not one. */
export function signalRecipe(value: unknown): DomainResult<SignalRecipe> {
  return readValue(value, 'pcm.signal-recipe-unreadable', (one) => signalRecipeOf(one, 'recipe'));
}

/** Frames one pass of a programme's segments lasts. */
export function programmeLength(programme: ChannelProgramme): number {
  return programme.segments.reduce((total, segment) => total + segment.length, 0);
}

/**
 * A recipe of the same tone on each of `channels` channels for `length` frames:
 * the test signal's, and the tone a test plays.
 */
export function toneRecipe(
  channels: number,
  length: number,
  frequency: number,
  amplitude: number,
): DomainResult<SignalRecipe> {
  const programme = {
    repeats: false,
    segments: [{ kind: 'tone', length, frequency, amplitude }],
  };
  return signalRecipe({ length, channels: Array.from({ length: channels }, () => programme) });
}
