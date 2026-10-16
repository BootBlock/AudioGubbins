/**
 * Reading a range of a source for the worker's whole passes, a detection's and
 * a loudness measurement's alike: the range checked against the source once,
 * then read in order a chunk at a time into one block, the worker yielding to
 * its scope after each chunk so a cancellation sent meanwhile is read before
 * the next (G4).
 */

import { blockView, type AudioFrameBlock, type PcmSource } from '@audiogubbins/audio-engine';
import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  throwIfCancelled,
  type CancellationSignal,
  type DomainResult,
  type EditRange,
} from '@audiogubbins/domain';

/** The frames read at a time: under a second, so a cancellation waits on no more. */
export const CHUNK_FRAMES = 32_768;

/** What reading a range needs of the worker. */
export interface RangeReadingTools {
  readonly signal: CancellationSignal;
  /** Resolves once the scope has read the messages that arrived meanwhile. */
  readonly yieldToHost: () => Promise<void>;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** Why `range` of `source` cannot be read, or `undefined` where it can. */
export function rangeProblem(
  source: Pick<PcmSource, 'length'>,
  range: EditRange,
): DomainResult<never> | undefined {
  if (range.end <= range.start) {
    return refused('detection.range-empty', 'The range to analyse holds no audio.');
  }
  if (source.length !== undefined && range.end > source.length) {
    return refused(
      'detection.range-outside',
      'The range to analyse runs past the end of the audio.',
    );
  }
  return undefined;
}

/**
 * Reads `range` of `source` into `block` a chunk at a time, handing each chunk
 * to `hear` with the frames read into it, and answers the frames read: fewer
 * than the range holds only where the source ends first. A cancellation is
 * thrown, as the signal's reason.
 */
export async function readRange(
  source: PcmSource,
  range: EditRange,
  block: AudioFrameBlock,
  tools: RangeReadingTools,
  hear: (chunk: AudioFrameBlock, frames: number) => Promise<void>,
): Promise<number> {
  let position: number = range.start;
  while (position < range.end) {
    const wanted = Math.min(block.frames, range.end - position);
    const into = wanted === block.frames ? block : blockView(block, 0, wanted);
    const read = await source.read(derivedSampleCount(position), into, tools.signal);
    if (read === 0) break;
    await hear(into, read);
    position += read;
    await tools.yieldToHost();
    throwIfCancelled(tools.signal);
  }
  return position - range.start;
}
