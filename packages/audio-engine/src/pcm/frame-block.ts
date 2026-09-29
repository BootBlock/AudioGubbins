/**
 * The block of audio the engine moves: frames of every channel of a layout.
 *
 * Planar, one array per channel, because every processor works on a channel
 * at a time and interleaving is a storage or device decision (REQ-ARCH-157).
 * Float32 is the working precision (REQ-ARCH-011); the offline paths that
 * gain from more carry it inside a primitive, as the resampler sums in f64.
 *
 * A block is a set of views: a smaller block is made by viewing part of a
 * larger one, never by copying it (`CLAUDE.md` G4).
 */

import {
  channelCount,
  failure,
  FailureKind,
  fail,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';

/** Frames of every channel of a layout, at a rate. */
export interface AudioFrameBlock {
  readonly layout: ChannelLayout;
  readonly sampleRate: SampleRate;
  /** How many frames each channel holds. */
  readonly frames: number;
  /** One array per channel of the layout, in its order, each `frames` long. */
  readonly channels: readonly Float32Array[];
}

/** A block over the given arrays, or why they do not fit the layout. */
export function frameBlock(
  layout: ChannelLayout,
  sampleRate: SampleRate,
  channels: readonly Float32Array[],
): DomainResult<AudioFrameBlock> {
  if (channels.length !== channelCount(layout)) {
    // A block with fewer arrays than channels would drop some silently, which
    // REQ-ARCH-157 forbids.
    return fail(
      failure(
        'pcm.block-channel-count-mismatch',
        FailureKind.Rejected,
        'A block needs exactly one array for each channel of its layout.',
        { details: { layout: channelCount(layout), arrays: channels.length } },
      ),
    );
  }
  const frames = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== frames)) {
    return fail(
      failure(
        'pcm.block-channel-lengths-differ',
        FailureKind.Rejected,
        'Every channel of a block must hold the same number of frames.',
      ),
    );
  }
  return succeed({ layout, sampleRate, frames, channels });
}

/** A silent block of `frames` frames, allocated once for its owner to reuse. */
export function allocateBlock(
  layout: ChannelLayout,
  sampleRate: SampleRate,
  frames: number,
): AudioFrameBlock {
  const channels = layout.roles.map(() => new Float32Array(frames));
  return { layout, sampleRate, frames, channels };
}

/** The frames `[start, start + frames)` of a block, as views of it. */
export function blockView(block: AudioFrameBlock, start: number, frames: number): AudioFrameBlock {
  const first = Math.max(0, Math.min(start, block.frames));
  const count = Math.max(0, Math.min(frames, block.frames - first));
  return {
    layout: block.layout,
    sampleRate: block.sampleRate,
    frames: count,
    channels: block.channels.map((channel) => channel.subarray(first, first + count)),
  };
}

/** Sets every sample of a block to zero. */
export function silence(block: AudioFrameBlock): void {
  for (const channel of block.channels) channel.fill(0);
}
