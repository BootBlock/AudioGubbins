/**
 * An edited sound as a source: its edit plan read on demand from the files of
 * the assets it names (ADR-0051, ADR-0052).
 *
 * Each read asks only for the frames it needs: every segment it covers reads
 * its range of content, from an asset's file through the read contract or
 * from a later stream of the plan through the canonical resampler, turns it
 * round where the segment is reversed, and passes it through the segment's
 * stages by the domain's own arithmetic (`applyStages`), so the feeder, the
 * render worker and the peak worker hear and draw one sound, bit for bit. No
 * file is held whole, and no rate changes except where a stream says so. The
 * reader of each kind of content is in `plan-content.ts`, and the readers a
 * source makes of its plan in `plan-readers.ts`.
 *
 * Those readers keep state between reads, a processed stream's run among
 * them, and are reached only through the source made here, so its reads take
 * turns (`read-turns.ts`): two readers of one source, as the peak worker's
 * build and a view's request are, each hear what a reader alone would.
 *
 * A processed stream is read from its render where the reading has a cache
 * of renders and the stream is one it would otherwise run from its start, or
 * one a preview cannot run as it is heard (`cached-streams.ts`); the cached
 * preview producer reads the stream it renders through this module too, with
 * no cache, from the stream's start (`processedStreamSource`).
 */

import {
  FailureKind,
  channelCount,
  discreteLayout,
  failure,
  fail,
  sampleCount,
  streamLength,
  succeed,
  validatePlan,
  type AssetId,
  type ChannelLayout,
  type DomainResult,
  type EditPlan,
  type MediaShape,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';
import type { MediaEntry, ReadableContent } from './plan-content.js';
import { PlanReaders } from './plan-readers.js';
import type { PlanProcessing } from './processed-content.js';
import { ReadTurns } from './read-turns.js';

/** What a plan may read of each file, as its asset recorded it. */
function mediaShapes(media: readonly MediaEntry[]): DomainResult<ReadonlyMap<AssetId, MediaShape>> {
  const shapes = new Map<AssetId, MediaShape>();
  for (const entry of media) {
    const layout = discreteLayout(entry.channels);
    if (!layout.ok) return layout;
    shapes.set(entry.asset, {
      sampleRate: entry.sampleRate,
      channelLayout: layout.value,
      length: entry.length,
    });
  }
  return succeed(shapes);
}

/** `plan` checked against the files `media` names, or why it cannot be read from them. */
function checkedPlan(plan: EditPlan, media: readonly MediaEntry[]): DomainResult<EditPlan> {
  const shapes = mediaShapes(media);
  return shapes.ok ? validatePlan(plan, shapes.value) : shapes;
}

/**
 * `content` as a source of `length` frames in `layout` at `rate`, its reads
 * taken in turn, since every reader a plan makes keeps state between reads
 * (`read-turns.ts`), and `readers` released with it.
 */
function turnTaking(
  content: ReadableContent,
  shape: {
    readonly layout: ChannelLayout;
    readonly sampleRate: SampleRate;
    readonly length: number;
  },
  readers: PlanReaders,
  release: () => void,
): DomainResult<PcmSource> {
  const length = sampleCount(shape.length);
  if (!length.ok) return length;
  const turns = new ReadTurns();
  const { layout, sampleRate } = shape;
  return succeed({
    layout,
    sampleRate,
    length: length.value,
    read: (start, into, signal) =>
      turns.take(async () => {
        assertReadableInto({ layout, sampleRate }, into);
        const count = framesAvailable(length.value, start, into.frames);
        await content.read(start, count, into.channels, signal);
        return count;
      }, signal),
    release: () => {
      release();
      readers.release();
    },
  });
}

/**
 * The plan's sound as a source read in `layout`, which must have its first
 * stream's channels, from the files `media` names, converting with `dsp`. A
 * parameter changed while it plays reaches its chains through the reading's
 * running parameters, where it has them.
 */
export function editedSource(
  plan: EditPlan,
  media: readonly MediaEntry[],
  layout: ChannelLayout,
  dsp: CanonicalDsp,
  processing: PlanProcessing,
): DomainResult<PcmSource> {
  const valid = checkedPlan(plan, media);
  if (!valid.ok) return valid;
  const [first] = plan.streams;
  if (channelCount(layout) !== channelCount(first.layout)) {
    return fail(
      failure(
        'pcm.edited-layout-mismatch',
        FailureKind.Rejected,
        'An edited sound is read in a layout of its own channels.',
      ),
    );
  }
  const readers = new PlanReaders(plan, media, dsp, processing);
  const stopHearing = processing.parameters?.add(readers) ?? (() => undefined);
  return turnTaking(
    readers.stream(0),
    { layout, sampleRate: first.sampleRate, length: streamLength(first) },
    readers,
    stopHearing,
  );
}

/**
 * What the plan's stream at `place` makes, its processing run over it, as a
 * source in the stream's own layout and rate: what the cached preview
 * producer renders (`preview-producer.ts`).
 */
export function processedStreamSource(
  plan: EditPlan,
  media: readonly MediaEntry[],
  place: number,
  dsp: CanonicalDsp,
  processing: PlanProcessing,
): DomainResult<PcmSource> {
  const valid = checkedPlan(plan, media);
  if (!valid.ok) return valid;
  const stream = plan.streams[place];
  if (stream === undefined) {
    return fail(
      failure(
        'pcm.stream-absent',
        FailureKind.Rejected,
        `The plan has no stream at place ${String(place)}.`,
      ),
    );
  }
  const readers = new PlanReaders(plan, media, dsp, processing);
  return turnTaking(
    readers.output(place),
    { layout: stream.layout, sampleRate: stream.sampleRate, length: streamLength(stream) },
    readers,
    () => undefined,
  );
}
