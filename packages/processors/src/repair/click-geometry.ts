/**
 * The frames a de-click works in at a rate and a longest click, the one
 * authority its descriptor's latency and its kernel's rings are read from, and
 * the rule of which flagged frames are one click and which clicks it repairs,
 * which the click detector reports by.
 *
 * The detector (`clicks.rs`, the analysis contract) works in blocks of `B`
 * frames, the power of two at or above 20 ms: long enough that a block's median
 * and median absolute deviation are the music's, short enough that its
 * predictor follows the music. Its events for a block arrive at the block's
 * last frame. A span whose last frame, its guard frames after its last flag
 * among them, is `l` is decided at the first block end at or after `l + C`,
 * when more than `MERGE_GAP` unflagged frames have shown it is over and its
 * context of `C` frames after it has arrived: at most `l + C + B − 1`. It
 * starts no earlier than `l − M + 1`, `M` the longest click, so a latency of
 * `D = M + C + B − 2` frames is the least by which every frame of every click
 * is repaired before it is given. The ring holds the latency and the context
 * before a span: `D + C + 1` frames.
 */

import type { SampleRate } from '@audiogubbins/domain';

import { framesOf } from '../dynamics/envelope.js';

/**
 * Frames between pushes to the detector: its smallest block, which divides
 * every block it is given, so each block ends on a push.
 */
export const CHUNK_FRAMES = 64;

/**
 * The most unflagged frames inside one click: the detector's predictor order,
 * as a click's residual spreads that far past its last corrupt sample.
 */
export const MERGE_GAP = 16;

/**
 * Frames repaired either side of a span's flagged frames: a click's first
 * or last sample can be too small to flag and still bias an interpolation
 * that takes it as known. They count towards the longest click.
 */
export const SPAN_GUARD = 2;

/**
 * The repair model's order: higher than the detector's, as an interpolation
 * must carry the music's resonances across the gap rather than just notice
 * where they fail.
 */
export const MODEL_ORDER = 32;

/** The fewest frames of each context segment: eight times the model's order. */
const SHORTEST_CONTEXT = 8 * MODEL_ORDER;

/** The block's least length, in milliseconds. */
const BLOCK_MILLISECONDS = 20;

/**
 * Whether a flag at `frame` is part of the click whose last flag is at `last`:
 * no more than `MERGE_GAP` unflagged frames lie between them.
 */
export function joinsClick(last: number, frame: number): boolean {
  return frame - last - 1 <= MERGE_GAP;
}

/** The frames a de-click replaces for a click flagged from `first` to `last`, its guards with it. */
export function repairedFrames(first: number, last: number): number {
  return last - first + 1 + 2 * SPAN_GUARD;
}

/** The frames a de-click works in. */
export interface ClickGeometry {
  /** `M`, the longest span that is repaired. */
  readonly longest: number;
  /** `C`, each context segment: the larger of `8P` and `2M`. */
  readonly context: number;
  /** `B`, the detector's block. */
  readonly block: number;
  /** `D = M + C + B − 2`. */
  readonly latency: number;
  readonly ringFrames: number;
}

/**
 * Whether a de-click of `geometry` repairs a click flagged from `first` to
 * `last`: one longer, its guards counted, it leaves as it is.
 */
export function repairsClick(geometry: ClickGeometry, first: number, last: number): boolean {
  return repairedFrames(first, last) <= geometry.longest;
}

/** The geometry at `rate` for a longest click of `milliseconds`. */
export function clickGeometry(rate: SampleRate, milliseconds: number): ClickGeometry {
  const longest = Math.max(1, framesOf(milliseconds, rate));
  const context = Math.max(SHORTEST_CONTEXT, 2 * longest);
  let block = CHUNK_FRAMES;
  while (block * 1_000 < BLOCK_MILLISECONDS * rate) block *= 2;
  const latency = longest + context + block - 2;
  return { longest, context, block, latency, ringFrames: latency + context + 1 };
}
