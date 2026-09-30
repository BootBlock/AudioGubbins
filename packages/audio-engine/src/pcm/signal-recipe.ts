/**
 * Generated audio as a recipe: what each channel plays, segment by segment.
 *
 * A recipe describes audio of any length in a few hundred bytes, so an asset of
 * hours crosses a thread and is made on demand, never held (ADR-0045,
 * REQ-EXEC-216). A channel plays its segments in order, silence, an impulse or
 * a tone from the canonical oscillator, and either repeats them or falls silent
 * after the last. The recipe is validated by {@link signalRecipe}, which reads
 * a value of unknown shape: a value built in code and a value that crossed a
 * thread are held to the same rules, and a message cannot ask a worker for
 * unbounded work.
 */

import {
  FailureKind,
  fail,
  failure,
  sampleCount,
  succeed,
  type DomainFailure,
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

/** A recipe that could not be read, and which of its parts was wrong. */
class UnreadableRecipe extends Error {
  readonly part: string;

  constructor(part: string, expected: string) {
    super(`The signal recipe's ${part} is not ${expected}.`);
    this.name = 'UnreadableRecipe';
    this.part = part;
  }
}

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldsOf(value: unknown, part: string): Fields {
  if (!isFields(value)) throw new UnreadableRecipe(part, 'an object with named fields');
  return value;
}

function listOf(value: unknown, part: string, most: number): readonly unknown[] {
  if (!Array.isArray(value)) throw new UnreadableRecipe(part, 'a list');
  if (value.length > most) throw new UnreadableRecipe(part, `a list of at most ${String(most)}`);
  return value;
}

function framesOf(value: unknown, part: string): SampleCount {
  const frames = typeof value === 'number' ? sampleCount(value) : undefined;
  if (frames?.ok !== true) throw new UnreadableRecipe(part, 'a whole number of frames');
  return frames.value;
}

function amplitudeOf(value: unknown, part: string): number {
  if (typeof value !== 'number' || !(value >= -1 && value <= 1)) {
    throw new UnreadableRecipe(part, 'an amplitude from -1 to 1');
  }
  return value;
}

function frequencyOf(value: unknown, part: string): number {
  if (typeof value !== 'number' || !(value > 0) || !Number.isFinite(value)) {
    throw new UnreadableRecipe(part, 'a frequency above zero');
  }
  return value;
}

function segmentOf(value: unknown, part: string): SignalSegment {
  const fields = fieldsOf(value, part);
  const length = framesOf(fields['length'], `${part}.length`);
  if (length === 0) throw new UnreadableRecipe(`${part}.length`, 'at least one frame');
  switch (fields['kind']) {
    case 'silence':
      return { kind: 'silence', length };
    case 'impulse':
      return {
        kind: 'impulse',
        length,
        amplitude: amplitudeOf(fields['amplitude'], `${part}.amplitude`),
      };
    case 'tone':
      return {
        kind: 'tone',
        length,
        frequency: frequencyOf(fields['frequency'], `${part}.frequency`),
        // A tone's peak is its amplitude's size; its sign would only turn it over.
        amplitude: Math.abs(amplitudeOf(fields['amplitude'], `${part}.amplitude`)),
      };
    default:
      throw new UnreadableRecipe(`${part}.kind`, 'silence, an impulse or a tone');
  }
}

function programmeOf(value: unknown, part: string): ChannelProgramme {
  const fields = fieldsOf(value, part);
  const segments = listOf(fields['segments'], `${part}.segments`, MAXIMUM_SEGMENTS).map(
    (segment, index) => segmentOf(segment, `${part}.segments[${String(index)}]`),
  );
  const repeats = fields['repeats'];
  if (typeof repeats !== 'boolean') throw new UnreadableRecipe(`${part}.repeats`, 'true or false');
  if (repeats && segments.length === 0) {
    throw new UnreadableRecipe(`${part}.segments`, 'at least one segment to repeat');
  }
  const programme = { segments, repeats };
  if (!Number.isSafeInteger(programmeLength(programme))) {
    throw new UnreadableRecipe(`${part}.segments`, 'a programme shorter than 2^53 frames');
  }
  return programme;
}

function unreadable(error: UnreadableRecipe): DomainFailure {
  return failure('pcm.signal-recipe-unreadable', FailureKind.Rejected, error.message, {
    details: { part: error.part },
  });
}

/**
 * A recipe read from a value of any shape, or why it is not one: a list of at
 * most 256 channel programmes, each of at most {@link MAXIMUM_SEGMENTS}
 * segments of at least one frame, and a length in frames.
 */
export function signalRecipe(value: unknown): DomainResult<SignalRecipe> {
  try {
    const fields = fieldsOf(value, 'recipe');
    const channels = listOf(fields['channels'], 'channels', MAXIMUM_CHANNELS).map(
      (programme, index) => programmeOf(programme, `channels[${String(index)}]`),
    );
    if (channels.length === 0) throw new UnreadableRecipe('channels', 'a list of at least one');
    return succeed({ channels, length: framesOf(fields['length'], 'length') });
  } catch (error) {
    if (!(error instanceof UnreadableRecipe)) throw error;
    return fail(unreadable(error));
  }
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
