/**
 * What a view knows of its asset's audio: a hold on the shared peaks, and,
 * where it is zoomed past the pyramid's finest level, a window of detail
 * buckets or of samples around what it shows (ADR-0043).
 *
 * The pyramid is shared by every view of the source and revision; this view's
 * hold is released when the view goes. The worker is told which range the view
 * shows, so what is on screen is summarised first. A window is a span of the
 * view either side of it, asked for before the view reaches its edge, so a view
 * that scrolls keeps drawing from the window it has while the next comes, and
 * one asked for before and not yet answered is cancelled. A window is never
 * asked for again once held, so a view wider than the largest window draws what
 * it reaches and asks nothing more; a view that redraws in place asks the
 * worker nothing, and no column reads more than sixteen buckets or samples a
 * frame (the packet's acceptance criterion).
 */

import { finalRenderSettings, type QualityMode, type SampleCount } from '@audiogubbins/domain';
import type { KnownAudio } from '@audiogubbins/editor-view';
import { visibleRange, type ViewportState } from '@audiogubbins/timeline';
import {
  DetailKind,
  WINDOW_SPANS,
  detailFor,
  largestWindow,
  windowFrames,
  type BucketWindow,
  type FrameRange,
  type PeakHandle,
  type PeakHost,
  type PeakStatus,
  type PeakSubject,
  type SampleWindow,
} from '@audiogubbins/waveform';

import type { EditorAsset } from '../assets/editor-asset.js';

/**
 * The revision of the peaks of `asset` processed at `quality`: the asset's
 * own, and the values a final render runs at, since a change of either
 * changes what is drawn and peaks kept for the other must not be.
 */
function peakRevisionOf(asset: EditorAsset, quality: QualityMode): string {
  const { resampling, oversampling, spectralOverlap, inference } = finalRenderSettings(quality);
  return `${asset.revision}.${resampling}-${String(oversampling)}-${String(spectralOverlap)}-${inference}`;
}

/**
 * The source whose peaks show `asset` as a final render at `quality` makes it,
 * named by its identity and revision.
 */
export function peakSubjectOf(asset: EditorAsset, quality: QualityMode): PeakSubject {
  return {
    identity: asset.id,
    revision: peakRevisionOf(asset, quality),
    channels: asset.layout.roles.length,
    frames: asset.length,
    sampleRate: asset.sampleRate,
    describe: asset.describe,
    quality,
  };
}

/** The kinds of window a view reads below the pyramid. */
type WindowKind = typeof DetailKind.Samples | typeof DetailKind.Buckets;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The window a view at `viewport`, drawn at `ratio`, reads, or `undefined` where it reads the pyramid. */
function windowKindOf(viewport: ViewportState, ratio: number): WindowKind | undefined {
  if (viewport.zoom.kind === 'pixels-per-sample') return DetailKind.Samples;
  const detail = detailFor(viewport.zoom.samples / ratio);
  return detail === DetailKind.Pyramid ? undefined : detail;
}

/** The window of `kind` to ask for around `shown`: a span either side, within the asset. */
function windowAround(shown: FrameRange, length: number, kind: WindowKind): FrameRange {
  const span = shown.end - shown.start;
  const frames = Math.min(largestWindow(kind), WINDOW_SPANS * span);
  const margin = Math.max(0, Math.floor((frames - span) / 2));
  const start = Math.max(0, shown.start - margin);
  return { start, end: Math.min(length, start + Math.max(frames, span)) };
}

/** What a view must hold to go on drawing as it scrolls: half a span either side, within `wanted`. */
function aheadOf(shown: FrameRange, wanted: FrameRange): FrameRange {
  const half = Math.floor((shown.end - shown.start) / 2);
  return {
    start: Math.max(wanted.start, shown.start - half),
    end: Math.min(wanted.end, shown.end + half),
  };
}

function holds(held: FrameRange, range: FrameRange): boolean {
  return held.start <= range.start && held.end >= range.end;
}

function sameRange(one: FrameRange, other: FrameRange): boolean {
  return one.start === other.start && one.end === other.end;
}

function extentOf(held: SampleWindow | BucketWindow): FrameRange {
  const frames = 'frames' in held ? held.frames : windowFrames(held);
  return { start: held.start, end: held.start + frames };
}

/** One view's hold on its asset's audio. */
export class ViewAudio {
  readonly #handle: PeakHandle;
  readonly #length: SampleCount;
  readonly #changed: () => void;
  readonly #progressed: () => void;
  readonly #failed: (reason: string) => void;
  readonly #stopListening: () => void;
  #samples: SampleWindow | undefined;
  #buckets: BucketWindow | undefined;
  #asking:
    | {
        readonly kind: WindowKind;
        readonly range: FrameRange;
        readonly controller: AbortController;
      }
    | undefined;
  #focus: FrameRange | undefined;

  constructor(options: {
    readonly peaks: Pick<PeakHost, 'open'>;
    readonly asset: EditorAsset;
    /** The render quality, whose sound the peaks draw. */
    readonly quality: QualityMode;
    /** Told when a window the view asked for has come, to draw again. */
    readonly changed: () => void;
    /** Told when more of the pyramid is known, or where it is has changed. */
    readonly progressed: () => void;
    /** Told why a window of samples could not be had. */
    readonly failed: (reason: string) => void;
  }) {
    const { asset } = options;
    this.#length = asset.length;
    this.#changed = options.changed;
    this.#progressed = options.progressed;
    this.#failed = options.failed;
    this.#handle = options.peaks.open(peakSubjectOf(asset, options.quality));
    this.#stopListening = this.#handle.subscribe(() => {
      this.#progressed();
    });
  }

  /** Where the asset's peaks are. */
  get status(): PeakStatus {
    return this.#handle.status;
  }

  /** The zero-crossing search over the asset, for snapping. */
  get zeroCrossings(): PeakHandle['zeroCrossings'] {
    return this.#handle.zeroCrossings;
  }

  /**
   * What is known for a view at `viewport` drawn at `ratio`: the pyramid, and
   * the windows the view reads. Tells the worker what the view shows, and asks
   * for a window where the view will soon need one it has not got.
   */
  known(viewport: ViewportState, ratio: number): KnownAudio {
    const shown = visibleRange(viewport, this.#length);
    if (this.#focus?.start !== shown.start || this.#focus.end !== shown.end) {
      this.#focus = shown;
      this.#handle.focus(shown);
    }
    const kind = windowKindOf(viewport, ratio);
    if (kind !== undefined) this.#want(kind, shown);
    return {
      pyramid: this.#handle.pyramid,
      buckets: this.#buckets,
      samples: this.#samples,
      length: this.#length,
    };
  }

  /** Asks for the window of `kind` around `shown`, unless one held or asked for will do. */
  #want(kind: WindowKind, shown: FrameRange): void {
    const wanted = windowAround(shown, this.#length, kind);
    const ahead = aheadOf(shown, wanted);
    const held = kind === DetailKind.Samples ? this.#samples : this.#buckets;
    const extent = held === undefined ? undefined : extentOf(held);
    if (extent !== undefined && (holds(extent, ahead) || sameRange(extent, wanted))) return;
    const asking = this.#asking;
    if (asking?.kind === kind && (holds(asking.range, ahead) || sameRange(asking.range, wanted))) {
      return;
    }
    asking?.controller.abort();
    const controller = new AbortController();
    this.#asking = { kind, range: wanted, controller };
    const answered =
      kind === DetailKind.Samples
        ? this.#handle.samples(wanted, controller.signal).then((window) => {
            this.#samples = window;
          })
        : this.#handle.buckets(wanted, controller.signal).then((window) => {
            this.#buckets = window;
          });
    answered.then(
      () => {
        if (this.#asking?.controller === controller) this.#asking = undefined;
        this.#changed();
      },
      (error: unknown) => {
        // Abandoned for a window the view needs more, which is on its way.
        if (controller.signal.aborted) return;
        if (this.#asking?.controller === controller) this.#asking = undefined;
        this.#failed(messageOf(error));
      },
    );
  }

  /** Lets go of the peaks, and of the window being asked for. */
  release(): void {
    this.#asking?.controller.abort();
    this.#asking = undefined;
    this.#stopListening();
    this.#handle.release();
  }
}
