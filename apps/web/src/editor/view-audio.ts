/**
 * What a view knows of its asset's audio: a hold on the shared peaks, and,
 * where it is zoomed past the pyramid's finest level, a window of samples
 * around what it shows (ADR-0043).
 *
 * The pyramid is shared by every view of the source and revision, and lives as
 * long as one of them holds it; this view's hold is released when the view
 * goes. The worker is told which range the view shows, so what is on screen is
 * summarised first. A window of samples is asked for only when the view needs
 * one it has not got, a little wider than the view, and the one asked for
 * before it is abandoned, so a view that redraws in place asks the worker
 * nothing and nothing is made from raw samples per frame (the packet's
 * acceptance criterion).
 */

import type { SampleCount } from '@audiogubbins/domain';
import type { KnownAudio } from '@audiogubbins/editor-view';
import { visibleRange, type ViewportState } from '@audiogubbins/timeline';
import {
  BASE_BUCKET_FRAMES,
  windowFrames,
  type FrameRange,
  type PeakHandle,
  type PeakHost,
  type PeakStatus,
  type SampleWindow,
} from '@audiogubbins/waveform';

import type { EditorAsset } from '../assets/editor-asset.js';

/** The most frames a window may hold, which the worker answers in one reply. */
const LARGEST_WINDOW = 1_048_576;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a view at `viewport`, drawn at `ratio`, reads samples rather than the pyramid. */
function readsSamples(viewport: ViewportState, ratio: number): boolean {
  return (
    viewport.zoom.kind === 'pixels-per-sample' || viewport.zoom.samples / ratio < BASE_BUCKET_FRAMES
  );
}

/** The window to ask for around `shown`: half as wide again either side, within the asset. */
function windowAround(shown: FrameRange, length: number): FrameRange {
  const span = shown.end - shown.start;
  const margin = Math.max(0, Math.min(span / 2, (LARGEST_WINDOW - span) / 2));
  const start = Math.max(0, Math.floor(shown.start - margin));
  return { start, end: Math.min(length, start + Math.min(LARGEST_WINDOW, span + 2 * margin)) };
}

function covers(held: SampleWindow | undefined, range: FrameRange): boolean {
  return (
    held !== undefined && held.start <= range.start && held.start + windowFrames(held) >= range.end
  );
}

/** One view's hold on its asset's audio. */
export class ViewAudio {
  readonly #handle: PeakHandle;
  readonly #length: SampleCount;
  readonly #changed: () => void;
  readonly #failed: (reason: string) => void;
  readonly #stopListening: () => void;
  #samples: SampleWindow | undefined;
  #asking: { readonly range: FrameRange; readonly controller: AbortController } | undefined;
  #focus: FrameRange | undefined;

  constructor(options: {
    readonly peaks: Pick<PeakHost, 'open'>;
    readonly asset: EditorAsset;
    /** Told when more is known, to draw again. */
    readonly changed: () => void;
    /** Told why a window of samples could not be had. */
    readonly failed: (reason: string) => void;
  }) {
    const { asset } = options;
    this.#length = asset.length;
    this.#changed = options.changed;
    this.#failed = options.failed;
    this.#handle = options.peaks.open({
      identity: asset.id,
      revision: asset.revision,
      channels: asset.layout.roles.length,
      frames: asset.length,
      sampleRate: asset.sampleRate,
      describe: asset.describe,
    });
    this.#stopListening = this.#handle.subscribe(this.#changed);
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
   * the samples where the view reads them. Tells the worker what the view
   * shows, and asks for a window of samples where the view needs one it has
   * not got.
   */
  known(viewport: ViewportState, ratio: number): KnownAudio {
    const shown = visibleRange(viewport, this.#length);
    if (this.#focus?.start !== shown.start || this.#focus.end !== shown.end) {
      this.#focus = shown;
      this.#handle.focus(shown);
    }
    if (readsSamples(viewport, ratio) && !covers(this.#samples, shown)) this.#ask(shown);
    return { pyramid: this.#handle.pyramid, samples: this.#samples, length: this.#length };
  }

  /** Asks for a window around `shown`, unless the one being asked for holds it. */
  #ask(shown: FrameRange): void {
    const asking = this.#asking;
    if (
      asking !== undefined &&
      asking.range.start <= shown.start &&
      asking.range.end >= shown.end
    ) {
      return;
    }
    asking?.controller.abort();
    const range = windowAround(shown, this.#length);
    const controller = new AbortController();
    this.#asking = { range, controller };
    this.#handle.samples(range, controller.signal).then(
      (held) => {
        if (this.#asking?.controller !== controller) return;
        this.#asking = undefined;
        this.#samples = held;
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
