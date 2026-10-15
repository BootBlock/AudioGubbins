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
 *
 * An edited sound playing goes on into a plan that continues its own without
 * stopping (ADR-0104): the new plan is taken between two reads, at the first
 * frame the source has not yet read, and from there each reader whose state
 * the new plan leaves as it was goes on with it (`reader-continuation.ts`). The
 * continuation is held at that frame before it is taken, so whoever asked for
 * it can see where it would be heard, and drop it, before any read goes on.
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
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
  type EditPlan,
  type MediaShape,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import type { AudioFrameBlock } from './frame-block.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';
import { framesOf, type MediaEntry, type ReadableContent } from './plan-content.js';
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
 * A continuation an edited source holds ready (see
 * {@link EditedSource.continueWith}): the source's reads wait until it is
 * taken or dropped, so `frame` stays where the new plan would be heard from.
 */
export interface HeldContinuation {
  /** The first frame the source has not read: where the new plan is heard from once taken. */
  readonly frame: SampleCount;
  /** Whether the source has given its last frame, so whatever reads it has stopped. */
  readonly ended: boolean;
  /** Reads the new plan from `frame` on, and lets reads go on. */
  take(): void;
  /** Lets reads go on with the plan they had. */
  drop(): void;
}

/**
 * An edited sound as a source: its first stream read in turn, which goes on
 * into a plan that continues its own where it is asked to.
 */
export class EditedSource implements PcmSource {
  readonly layout: ChannelLayout;
  readonly sampleRate: SampleRate;
  readonly #readers: PlanReaders;
  readonly #turns = new ReadTurns();
  readonly #stopHearing: () => void;
  #length: SampleCount;
  /** The frame after the last one read, where a reader reading on reads next. */
  #next = 0;
  #released = false;

  constructor(
    readers: PlanReaders,
    shape: {
      readonly layout: ChannelLayout;
      readonly sampleRate: SampleRate;
      readonly length: SampleCount;
    },
    stopHearing: () => void,
  ) {
    this.#readers = readers;
    this.layout = shape.layout;
    this.sampleRate = shape.sampleRate;
    this.#length = shape.length;
    this.#stopHearing = stopHearing;
  }

  get length(): SampleCount {
    return this.#length;
  }

  read(start: SampleCount, into: AudioFrameBlock, signal?: CancellationSignal): Promise<number> {
    return this.#turns.take(async () => {
      assertReadableInto(this, into);
      const count = framesAvailable(this.#length, start, into.frames);
      await this.#readers.stream(0).read(start, count, into.channels, signal);
      this.#next = start + count;
      return count;
    }, signal);
  }

  /**
   * Holds the source between two reads to go on into `plan`, which continues
   * the one it reads and is read from the files `media` names, and answers
   * the continuation held, or why `plan` cannot be read in its place: it does
   * not read from those files, or makes another rate or other channels.
   */
  continueWith(
    plan: EditPlan,
    media: readonly MediaEntry[],
  ): Promise<DomainResult<HeldContinuation>> {
    const continuable = this.#continuable(plan, media);
    if (!continuable.ok) return Promise.resolve(continuable);
    const { valid, length } = continuable.value;
    return new Promise((resolve) => {
      // A turn of its own, so no read runs while it is held, and the frame it
      // answers is where the next read starts.
      void this.#turns.take(
        () =>
          new Promise<void>((letReadsGoOn) => {
            resolve(
              succeed(
                this.#held(() => {
                  this.#readers.continueWith(valid, media);
                  this.#length = length;
                }, letReadsGoOn),
              ),
            );
          }),
      );
    });
  }

  /** `plan` checked against `media`, and its length, or why it cannot be read in place of the plan playing. */
  #continuable(
    plan: EditPlan,
    media: readonly MediaEntry[],
  ): DomainResult<{ readonly valid: EditPlan; readonly length: SampleCount }> {
    const valid = checkedPlan(plan, media);
    if (!valid.ok) return valid;
    const [first] = valid.value.streams;
    if (
      first.sampleRate !== this.sampleRate ||
      channelCount(first.layout) !== channelCount(this.layout)
    ) {
      return fail(
        failure(
          'pcm.continuation-shape',
          FailureKind.Rejected,
          'A plan goes on from the one playing only at its rate and with its channels.',
        ),
      );
    }
    const length = sampleCount(streamLength(first));
    return length.ok ? succeed({ valid: valid.value, length: length.value }) : length;
  }

  /** The continuation held at the next frame to read, which `taking` takes, and `letReadsGoOn` ends. */
  #held(taking: () => void, letReadsGoOn: () => void): HeldContinuation {
    let settled = false;
    const settle = (taken: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        if (taken && !this.#released) taking();
      } finally {
        // Reads go on however the taking ends; its failure is the taker's to report.
        letReadsGoOn();
      }
    };
    return {
      frame: framesOf(this.#next),
      ended: this.#next >= this.#length,
      take: () => {
        settle(true);
      },
      drop: () => {
        settle(false);
      },
    };
  }

  release(): void {
    this.#released = true;
    this.#stopHearing();
    this.#readers.release();
  }
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
): DomainResult<EditedSource> {
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
  const length = sampleCount(streamLength(first));
  if (!length.ok) return length;
  const readers = new PlanReaders(plan, media, dsp, processing);
  const stopHearing = processing.parameters?.add(readers) ?? (() => undefined);
  return succeed(
    new EditedSource(
      readers,
      { layout, sampleRate: first.sampleRate, length: length.value },
      stopHearing,
    ),
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
