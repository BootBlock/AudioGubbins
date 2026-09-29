/**
 * How much audio playback keeps queued, in what chunks, and how often it
 * looks: the performance profile's feed-ahead time turned into frames.
 *
 * The profile says only how far ahead the feed keeps (REQ-ARCH-083). The rest
 * follows from it here, so a profile changes buffering and nothing else:
 *
 * - A chunk is an eighth of the time ahead, rounded up to whole render quanta.
 *   Eight chunks cover the time ahead, so a posted feed never needs more than
 *   nine blocks queued, well inside what the processor holds, and a read is
 *   large enough that a posted feed sends a message every few quanta rather
 *   than every one.
 * - The pumps are ticked once per chunk's duration, which is how often a chunk
 *   of room opens, so the queue never falls more than two chunks below the time
 *   ahead before it is topped up.
 * - A ring holds the time ahead plus one chunk. The pump's bound, not the ring,
 *   limits what is queued, and the chunk more is room for the next run's first
 *   chunk while the old run's audio still waits behind its discard mark for the
 *   processor's reset.
 */

import { failure, FailureKind, fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { PerformanceSettings } from '@audiogubbins/audio-engine';

import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';

/** How many chunks cover the time ahead. */
const CHUNKS_AHEAD = 8;

/** The sizes playback feeds at, at one context rate. */
export interface FeedPlan {
  /** The profile's feed-ahead time, which each pump keeps queued at most. */
  readonly feedAheadMilliseconds: number;
  /** The frames the feed keeps ahead of the play position, at most. */
  readonly aheadFrames: number;
  /** The frames of one read. */
  readonly chunkFrames: number;
  /** The frames each shared ring holds. */
  readonly ringFrames: number;
  /** How often the pumps are told what the processor has consumed. */
  readonly tickMilliseconds: number;
}

/** The feed sizes for a profile's settings at a context rate, or why it keeps no frame ahead. */
export function feedPlanFor(settings: PerformanceSettings, rate: number): DomainResult<FeedPlan> {
  // The pump's own arithmetic, so the ring is sized for exactly what it keeps.
  const aheadFrames = Math.floor((settings.feedAheadMilliseconds * rate) / 1000);
  if (!Number.isSafeInteger(aheadFrames) || aheadFrames < 1) {
    return fail(
      failure(
        'playback.feed-ahead-too-short',
        FailureKind.Rejected,
        `A feed-ahead time of ${String(settings.feedAheadMilliseconds)} ms keeps less than one frame ` +
          'queued, so every quantum would run short; choose a longer one.',
      ),
    );
  }
  const quanta = Math.ceil(aheadFrames / CHUNKS_AHEAD / RENDER_QUANTUM_FRAMES);
  const chunkFrames = Math.min(quanta * RENDER_QUANTUM_FRAMES, aheadFrames);
  return succeed({
    feedAheadMilliseconds: settings.feedAheadMilliseconds,
    aheadFrames,
    chunkFrames,
    ringFrames: aheadFrames + chunkFrames,
    tickMilliseconds: (chunkFrames * 1000) / rate,
  });
}
