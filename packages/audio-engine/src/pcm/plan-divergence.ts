/**
 * Where a plan that continues another may first sound different, stream by
 * stream (ADR-0104's continued programme).
 *
 * A reading of a plan keeps state between reads: a chain's run, a resampler's
 * filter. When playback goes on with a new plan, a reader may keep its state
 * only where everything that state was made from reads the same in the new
 * plan, and is made afresh otherwise (`reader-continuation.ts`). This module
 * works out the part that depends on the two plans: for each stream, the first
 * frame of its segments, and the first frame of what it makes, that the new
 * plan may give differently; infinite where it gives the same throughout, its
 * end included.
 *
 * Streams are matched by place, as a plan that continues another keeps its
 * streams at their places. A stream whose rate, layout or processing changed,
 * every processor's identifier and value among it, differs from its first
 * frame; a chain's automation is not part of that, since a game preview's
 * motion is extended as it plays (ADR-0104): it differs just past the last
 * point its two lanes share, and from the first frame where its lanes are not
 * of the same parameters. Otherwise its segments are walked from the start, in
 * step: the first pair that reads another source, from another frame, the other
 * way or through other stages differs where it begins; a pair that differs only
 * in length differs where the shorter ends, unless it is reversed, which moves
 * every frame it reads; and a pair that is the same differs where what it reads
 * differs, which, since a segment reads only later streams, is known from the
 * streams after it. What a stream makes differs where its segments do, less its
 * chain's latency, since a chain's output runs ahead of its input by it; from
 * the start where a pass over the input made something every frame carries, and
 * where a stretch or a spectral edit, which read around every frame, is given
 * anything different. A stream read converted, or played at a ratio by a
 * varispeed, differs from the first output frame whose filter reaches a frame
 * that differs.
 *
 * Every answer errs early, never late: a frame answered too early only makes
 * a reader afresh that could have been kept.
 */

import type {
  AssetId,
  EditPlan,
  EffectChain,
  ParameterAutomation,
  PlanSegment,
  PlanSource,
  PlanStream,
  SampleRate,
} from '@audiogubbins/domain';

import { canonicalText } from '../preview/canonical-text.js';
import type { RunReach } from './processed-content.js';

/** A frame no difference is ever found at. */
const NEVER = Number.POSITIVE_INFINITY;

/** What the readers of the old plan say about the state they hold. */
export interface ReadingState {
  /** The chain the stream at `place` runs, as values changed while it plays have left it. */
  readonly chain: (place: number) => EffectChain | undefined;
  /** How far the run of the chain of the stream at `place` reaches, where it has one running. */
  readonly run: (place: number) => RunReach | undefined;
  /** The lookahead of the conversion of the stream at `place` to `rate`, where one is made. */
  readonly conversion: (place: number, rate: SampleRate) => number | undefined;
  /** The lookahead of the varispeed of the stream at `place`, where one is made. */
  readonly varispeed: (place: number) => number | undefined;
  /** Whether the new plan's file for `asset` holds what the old plan's did. */
  readonly sameFile: (asset: AssetId) => boolean;
}

/** Where the new plan may first differ from the old, stream by stream. */
export interface PlanDivergence {
  /** Whether the stream at `place` keeps its rate, layout and processing; false where either plan has none. */
  sameDefinition(place: number): boolean;
  /**
   * The first frame of what the stream's processing is given that may differ:
   * its segments, and its chain's automation, in the stream's frames.
   */
  input(place: number): number;
  /** The first frame of what the stream makes, its processing run over its segments, that may differ. */
  output(place: number): number;
}

/**
 * A stream's rate, layout and processing as one text, its chain the one given
 * where it runs one, and without its chain's automation, which
 * {@link automationDivergence} compares frame by frame.
 */
function definitionText(stream: PlanStream, running: EffectChain | undefined): string {
  const { processing } = stream;
  let defined: unknown = processing;
  if (processing?.kind === 'chain') {
    const { automation: _automation, ...chain } = processing;
    defined = running === undefined ? chain : { ...chain, chain: running };
  }
  return canonicalText({
    sampleRate: stream.sampleRate,
    layout: stream.layout,
    processing: defined,
  });
}

/**
 * The first frame of a stream at which the automation `before` and `after`
 * may give a parameter another value: from the start where they move other
 * parameters, and otherwise just past the last point each pair of lanes
 * shares, since a lane is linear between its points and held after its last.
 */
function automationDivergence(
  before: readonly ParameterAutomation[] | undefined,
  after: readonly ParameterAutomation[] | undefined,
): number {
  const was = before ?? [];
  const now = after ?? [];
  if (was.length !== now.length) return 0;
  let differs = NEVER;
  for (const [index, lane] of was.entries()) {
    const other = now[index];
    if (other?.processor !== lane.processor || other.parameter !== lane.parameter) return 0;
    let shared = 0;
    for (const point of lane.points) {
      const same = other.points[shared];
      if (same?.frame !== point.frame || !Object.is(same.value, point.value)) break;
      shared += 1;
    }
    if (shared === lane.points.length && shared === other.points.length) continue;
    const last = lane.points[shared - 1];
    differs = Math.min(differs, last === undefined ? 0 : last.frame + 1);
  }
  return differs;
}

/** Whether two segments read one source from one frame, one way, through one set of stages. */
function sameReading(before: PlanSegment, after: PlanSegment): boolean {
  return (
    before.start === after.start &&
    before.reversed === after.reversed &&
    canonicalText(before.source) === canonicalText(after.source) &&
    canonicalText(before.stages) === canonicalText(after.stages)
  );
}

/**
 * The first frame of a stream that `before` and `after` read differently,
 * given the first frame of each source's own frames that may differ.
 */
function segmentsDivergence(
  before: readonly PlanSegment[],
  after: readonly PlanSegment[],
  reach: (source: PlanSource) => number,
): number {
  let position = 0;
  for (let index = 0; ; index += 1) {
    const was = before[index];
    const now = after[index];
    if (was === undefined || now === undefined) {
      return was === undefined && now === undefined ? NEVER : position;
    }
    if (!sameReading(was, now)) return position;
    const differs = reach(was.source);
    const shared = Math.min(was.length, now.length);
    if (was.reversed) {
      // The last frame of its content is read first.
      if (was.length !== now.length || differs < was.start + was.length) return position;
    } else if (differs - was.start < shared) {
      return position + Math.max(0, differs - was.start);
    } else if (was.length !== now.length) {
      return position + shared;
    }
    position += was.length;
  }
}

/**
 * The first output frame of a resampler making `output` frames of each `input`
 * whose filter, centred on its input position and reaching `lookahead` frames
 * ahead, may reach the input frame `differs`; one frame earlier still for
 * rounding.
 */
function resampledDivergence(
  differs: number,
  lookahead: number,
  input: number,
  output: number,
): number {
  return Math.max(0, Math.floor(((differs - lookahead - 2) * output) / input));
}

/** Where what a stream makes may first differ, given where its input may. */
function outputDivergence(
  stream: PlanStream,
  input: number,
  run: RunReach | undefined,
  varispeed: number | undefined,
): number {
  const { processing } = stream;
  if (processing === undefined || input === NEVER) return input;
  if (processing.kind === 'varispeed') {
    return varispeed === undefined
      ? 0
      : resampledDivergence(input, varispeed, processing.numerator, processing.denominator);
  }
  if (processing.kind !== 'chain' || run === undefined) return 0;
  // A pass that read past the change measured it, and every frame carries what it measured.
  if (run.measuredTo > input) return 0;
  return Math.max(0, input - run.latency);
}

/**
 * Where the old plan `before` and the new plan `after` may first differ, stream
 * by stream, as the readers of `before` report their state in `reading`.
 */
export function planDivergence(
  before: EditPlan,
  after: EditPlan,
  reading: ReadingState,
): PlanDivergence {
  const places = Math.min(before.streams.length, after.streams.length);
  const same: boolean[] = [];
  const inputs: number[] = [];
  const outputs: number[] = [];
  const outputAt = (place: number): number => outputs[place] ?? 0;

  /** The first frame of `source`, in the frames a segment of a stream at `rate` counts, that may differ. */
  const reach = (source: PlanSource, rate: SampleRate): number => {
    switch (source.kind) {
      case 'media':
        return reading.sameFile(source.asset) ? NEVER : 0;
      case 'silence':
        return NEVER;
      case 'mix':
        return Math.min(...source.streams.map(outputAt));
      case 'stream': {
        const read = after.streams[source.stream];
        const differs = outputAt(source.stream);
        if (read === undefined || read.sampleRate === rate || differs === NEVER) return differs;
        const lookahead = reading.conversion(source.stream, rate);
        return lookahead === undefined
          ? 0
          : resampledDivergence(differs, lookahead, read.sampleRate, rate);
      }
    }
  };

  // A segment reads only later streams, so each stream's sources are known before it.
  for (let place = places - 1; place >= 0; place -= 1) {
    const was = before.streams[place];
    const now = after.streams[place];
    if (was === undefined || now === undefined) continue;
    same[place] = definitionText(was, reading.chain(place)) === definitionText(now, undefined);
    if (same[place] !== true) continue;
    const read = segmentsDivergence(was.segments, now.segments, (source) =>
      reach(source, now.sampleRate),
    );
    const differs =
      was.processing?.kind === 'chain' && now.processing?.kind === 'chain'
        ? Math.min(read, automationDivergence(was.processing.automation, now.processing.automation))
        : read;
    inputs[place] = differs;
    outputs[place] = outputDivergence(now, differs, reading.run(place), reading.varispeed(place));
  }

  return {
    sameDefinition: (place) => same[place] ?? false,
    input: (place) => inputs[place] ?? 0,
    output: outputAt,
  };
}
