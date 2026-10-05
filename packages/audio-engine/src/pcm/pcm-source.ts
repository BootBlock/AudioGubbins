/**
 * The stream contract: where the engine reads audio from.
 *
 * A source is read in chunks into a block its reader owns, so nothing has to
 * hold a whole file (REQ-PROD-009, and the packet's "no full-file copies as
 * the normal long-file processing model"). A source may be unbounded, like a
 * generator. Reading is asynchronous, because a later phase's sources read
 * from storage and decoders, and cancellable (`CLAUDE.md` G4).
 */

import {
  FailureKind,
  addSamples,
  channelCount,
  fail,
  failure,
  layoutsMatch,
  subtractSamples,
  succeed,
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import type { AudioFrameBlock } from './frame-block.js';

/** Audio the engine can read, a chunk at a time. */
export interface PcmSource {
  readonly layout: ChannelLayout;
  readonly sampleRate: SampleRate;

  /** Frames it holds, or `undefined` for a source without an end. */
  readonly length: SampleCount | undefined;

  /**
   * Reads frames from `start` into the start of `into`, as many as it holds,
   * and answers how many it read: fewer than `into.frames` only at its end.
   * `into` has the source's layout and rate.
   */
  read(start: SampleCount, into: AudioFrameBlock, signal?: CancellationSignal): Promise<number>;

  /**
   * Releases what the source made, such as a resampler's memory in the DSP
   * module. A source it wraps is its caller's to release.
   */
  release(): void;
}

/** Why a block cannot be read into from a source, or `undefined` when it can. */
function problemReadingInto(
  source: Pick<PcmSource, 'layout' | 'sampleRate'>,
  into: AudioFrameBlock,
): DomainResult<never> | undefined {
  if (!layoutsMatch(source.layout, into.layout) || source.sampleRate !== into.sampleRate) {
    // Reading into another layout would drop or invent channels, and into
    // another rate would change the pitch; both need an explicit conversion.
    return fail(
      failure(
        'pcm.read-shape-mismatch',
        FailureKind.Rejected,
        'A source is read into a block of its own layout and rate; convert either explicitly first.',
        {
          details: {
            sourceChannels: channelCount(source.layout),
            blockChannels: channelCount(into.layout),
            sourceRate: source.sampleRate,
            blockRate: into.sampleRate,
          },
        },
      ),
    );
  }
  return undefined;
}

/** The frames a read from `start` of up to `wanted` finds in a source of `length`. */
export function framesAvailable(
  length: SampleCount | undefined,
  start: number,
  wanted: number,
): number {
  if (length === undefined) return wanted;
  return Math.max(0, Math.min(wanted, length - start));
}

/**
 * Refuses a read into a block of another shape, before a source reads.
 *
 * The engine owns every read, so a mismatch is a fault in the engine rather
 * than in the audio, and it throws with the failure's explanation.
 */
export function assertReadableInto(
  source: Pick<PcmSource, 'layout' | 'sampleRate'>,
  into: AudioFrameBlock,
): void {
  const problem = problemReadingInto(source, into);
  if (problem !== undefined && !problem.ok) throw new Error(problem.failures[0].summary);
}

/**
 * The part of a source from `offset` on, as a source that starts there.
 *
 * What playback reads after a seek: the audio from the new position, whose
 * conversion to another rate starts at it rather than at the source's start.
 */
export function offsetSource(source: PcmSource, offset: SampleCount): DomainResult<PcmSource> {
  const length =
    source.length === undefined
      ? undefined
      : subtractSamples(source.length, offset < source.length ? offset : source.length);
  if (length !== undefined && !length.ok) return length;
  return succeed({
    layout: source.layout,
    sampleRate: source.sampleRate,
    length: length?.value,
    read: (start, into, signal) => {
      const from = addSamples(start, offset);
      if (!from.ok) return Promise.reject(new Error(from.failures[0].summary));
      return source.read(from.value, into, signal);
    },
    // It made nothing; the source it reads is its caller's.
    release: () => undefined,
  });
}
