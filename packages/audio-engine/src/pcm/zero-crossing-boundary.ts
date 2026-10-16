/**
 * What a zero crossing is, stated once for every reader (REQ-EDIT-013,
 * ADR-0103): snapping a position to one, and measuring how far a loop's
 * boundaries lie from one.
 *
 * A boundary is the point between two frames, boundary `b` lying between
 * frames `b − 1` and `b`. It is a zero crossing where every channel asked for
 * changes sign across it or has a sample of exactly zero on either side, so a
 * cut there starts and ends every channel at silence; a crossing on some
 * channels and not others is not one, since a cut there would click on the
 * others.
 *
 * The two ends of a source have a frame on one side only. Snapping counts the
 * audio beyond them as silence, so the start and end of a source are
 * crossings; loop analysis counts them as interior boundaries with nothing
 * known beyond, so a loop at the start or end of its region is measured
 * against the audio it has rather than passed by definition.
 */

/** What lies beyond a source's first and last frames when a boundary there is judged. */
export const ZeroCrossingEdges = {
  /** Silence: the source's start and end are crossings. */
  Silence: 'silence',
  /** Nothing known: a boundary without a frame on both sides is never a crossing. */
  Interior: 'interior',
} as const;

/** What lies beyond a source's first and last frames when a boundary there is judged. */
export type ZeroCrossingEdges = (typeof ZeroCrossingEdges)[keyof typeof ZeroCrossingEdges];

/** Frames of a source a boundary is judged on: from frame `from`, one array per channel. */
export interface BoundarySamples {
  readonly channels: readonly Float32Array[];
  readonly from: number;
  /** The source's length in frames, which places its end. */
  readonly length: number;
}

/** Sample `frame` of `channel`, which the caller's window must hold. */
function sampleAt(samples: BoundarySamples, channel: Float32Array, frame: number): number {
  const value = channel[frame - samples.from];
  if (value === undefined) {
    // The caller reads the window it judges in; a boundary outside it is a
    // fault in the caller, not a fact about the audio.
    throw new RangeError(
      `Frame ${String(frame)} is outside the samples read from ${String(samples.from)}.`,
    );
  }
  return value;
}

/**
 * Whether boundary `at` is a zero crossing on every one of `channels`
 * (indices into `samples.channels`), with `edges` deciding the source's ends.
 */
export function isZeroCrossingBoundary(
  samples: BoundarySamples,
  at: number,
  channels: readonly number[],
  edges: ZeroCrossingEdges,
): boolean {
  if (at < 0 || at > samples.length) return false;
  const atEdge = at === 0 || at === samples.length;
  if (atEdge && edges === ZeroCrossingEdges.Interior) return false;
  return channels.every((index) => {
    const channel = samples.channels[index];
    if (channel === undefined) {
      throw new RangeError(`Channel ${String(index)} is not among the samples read.`);
    }
    const before = at === 0 ? 0 : sampleAt(samples, channel, at - 1);
    const after = at === samples.length ? 0 : sampleAt(samples, channel, at);
    return before * after <= 0;
  });
}
