/**
 * Reading a region's audio for a loop analysis: in chunks of at most 32,768
 * frames, through the source it is given, with the cancellation checked and the
 * host given its turn between chunks (`CLAUDE.md` G4).
 *
 * A chunk that cannot be read, or holds a sample that is not finite, ends the
 * analysis with a refusal rather than a measurement of audio it did not have:
 * `LoopRefused` carries the refusal from wherever the reading was to the one
 * place that turns it into the analysis's result.
 */

import {
  FailureKind,
  failure,
  sampleCount,
  throwIfCancelled,
  type CancellationSignal,
  type DomainFailure,
} from '@audiogubbins/domain';
import {
  allocateBlock,
  blockView,
  type AudioFrameBlock,
  type PcmSource,
} from '@audiogubbins/audio-engine';

/** The frames read at a time: under a second, so a cancellation waits on no more. */
export const CHUNK_FRAMES = 32_768;

/** What an analysis reads with, apart from the audio. */
export interface ReadingTools {
  readonly signal: CancellationSignal;
  /** Resolves once the host has read the messages that arrived meanwhile. */
  readonly yieldToHost: () => Promise<void>;
}

/** An analysis ended by its audio: a read that failed, or a sample that is not finite. */
export class LoopRefused extends Error {
  readonly refusal: DomainFailure;

  constructor(refusal: DomainFailure) {
    super(refusal.summary);
    this.refusal = refusal;
    this.name = 'LoopRefused';
  }
}

/** The refusal of audio holding a sample that is not finite. */
function nonFiniteAudio(frame: number, channel: number): LoopRefused {
  return new LoopRefused(
    failure(
      'loop.non-finite-audio',
      FailureKind.Rejected,
      'The audio holds a sample that is not a finite number, so no seam can be measured.',
      { details: { frame, channel } },
    ),
  );
}

/** Throws the refusal where a sample of the first `frames` of `chunk` is not finite. */
function assertFinite(chunk: AudioFrameBlock, frames: number, firstFrame: number): void {
  chunk.channels.forEach((samples, channel) => {
    for (let index = 0; index < frames; index += 1) {
      if (!Number.isFinite(samples[index] ?? 0)) throw nonFiniteAudio(firstFrame + index, channel);
    }
  });
}

/** Reads `frames` frames from `start` of `source` into the start of `into`, all or a refusal. */
async function readExactly(
  source: PcmSource,
  start: number,
  into: AudioFrameBlock,
  signal: CancellationSignal,
): Promise<void> {
  const from = sampleCount(start);
  if (!from.ok) throw new RangeError(`Frame ${String(start)} is not a frame to read from.`);
  let read: number;
  try {
    read = await source.read(from.value, into, signal);
  } catch (error: unknown) {
    // A cancellation is the caller's, and leaves as it came; any other error is
    // the source's, and becomes the analysis's refusal with its reason.
    throwIfCancelled(signal);
    throw new LoopRefused(
      failure('loop.read-failed', FailureKind.Retryable, 'The region could not be read.', {
        details: { start, reason: error instanceof Error ? error.message : String(error) },
      }),
    );
  }
  if (read !== into.frames) {
    throw new LoopRefused(
      failure(
        'loop.read-failed',
        FailureKind.Retryable,
        'The region ended before the frames its length promised.',
        { details: { start, wanted: into.frames, read } },
      ),
    );
  }
}

/** Reads `into.frames` frames from `start` of `source` into `into`, every sample checked finite. */
export async function readChunk(
  source: PcmSource,
  start: number,
  into: AudioFrameBlock,
  signal: CancellationSignal,
): Promise<void> {
  throwIfCancelled(signal);
  await readExactly(source, start, into, signal);
  assertFinite(into, into.frames, start);
}

/**
 * Reads frames `[from, to)` of `source` a chunk at a time, every sample checked
 * finite, handing each chunk and its first frame to `hear`.
 */
export async function streamFrames(
  source: PcmSource,
  from: number,
  to: number,
  tools: ReadingTools,
  hear: (chunk: AudioFrameBlock, firstFrame: number) => void,
  chunkFrames = CHUNK_FRAMES,
): Promise<void> {
  const block = allocateBlock(
    source.layout,
    source.sampleRate,
    Math.max(1, Math.min(chunkFrames, to - from)),
  );
  for (let position = from; position < to;) {
    const frames = Math.min(block.frames, to - position);
    const chunk = frames === block.frames ? block : blockView(block, 0, frames);
    await readChunk(source, position, chunk, tools.signal);
    hear(chunk, position);
    position += frames;
    await tools.yieldToHost();
  }
  throwIfCancelled(tools.signal);
}
