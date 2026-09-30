/**
 * Drawing one channel's waveform into a lane, from what is known of it.
 *
 * Where a device column holds many samples it is drawn as the column's peak
 * envelope, with its root mean square inside, read from the pyramid and, below
 * a level-zero bucket, over it from a window of detail buckets or of samples
 * (REQ-ARCH-037); a column whose peaks are not yet known is drawn as pending,
 * so a view of a long file fills in as the worker reaches it. Where a sample is
 * wider than a pixel, the samples are drawn as points joined by lines, so each
 * one can be seen, placed and selected (REQ-EDIT-012). Nothing is drawn per
 * sample or per peak as an element of the page (the packet's forbidden
 * shortcut): all of it is rectangles and segments for the renderer.
 */

import type { RenderBatch } from '@audiogubbins/renderer';
import { pixelOf, sampleAt, type ViewportState } from '@audiogubbins/timeline';
import {
  DetailKind,
  columnPeaks,
  detailFor,
  readBucketColumns,
  readPyramidColumns,
  readSampleColumns,
  windowFrames,
  type BucketWindow,
  type ColumnPeaks,
  type ColumnSpan,
  type SampleWindow,
  type WaveformPeakPyramid,
} from '@audiogubbins/waveform';
import type { SampleCount } from '@audiogubbins/domain';

import type { BuilderPool } from './batch-buffers.js';
import type { EditorPalette } from './editor-palette.js';
import type { Lane } from './lane-layout.js';

/**
 * What is known of a view's audio: the shared pyramid, and the window of detail
 * buckets or of samples around the view that its zoom reads.
 */
export interface KnownAudio {
  readonly pyramid: WaveformPeakPyramid | undefined;
  readonly buckets: BucketWindow | undefined;
  readonly samples: SampleWindow | undefined;
  readonly length: SampleCount;
}

/** How a lane is drawn: the view, the magnification and which extras are on. */
export interface WaveformStyle {
  readonly viewport: ViewportState;
  readonly pixelRatio: number;
  readonly amplitude: number;
  readonly rms: boolean;
  readonly clipping: boolean;
  readonly palette: EditorPalette;
}

/** The size, in CSS pixels, of a sample's point where samples are drawn one by one. */
const POINT = 3;

/** Draws waveforms, keeping its column arrays from frame to frame. */
export class WaveformPainter {
  #columns: ColumnPeaks = columnPeaks(2048);
  #waiting = false;

  /**
   * Whether a lane drawn since `begin` has a column whose peaks are not yet
   * known: until one does, peaks made elsewhere change nothing drawn.
   */
  get waiting(): boolean {
    return this.#waiting;
  }

  /** Starts a frame's lanes. */
  begin(): void {
    this.#waiting = false;
  }

  #columnsFor(count: number): ColumnPeaks {
    if (this.#columns.minimum.length < count) this.#columns = columnPeaks(count * 2);
    return this.#columns;
  }

  /** Draws channel `lane.channel` into `lane`, adding its batches to `out`. */
  draw(
    pool: BuilderPool,
    lane: Lane,
    audio: KnownAudio,
    style: WaveformStyle,
    out: RenderBatch[],
  ): void {
    const { area } = lane;
    const middle = area.y + area.height / 2;
    const scale = (area.height / 2) * style.amplitude;
    const centre = pool.rectangles(style.palette.centreLine);
    centre.add(
      area.x,
      Math.round(middle * style.pixelRatio) / style.pixelRatio,
      area.width,
      1 / style.pixelRatio,
    );
    out.push(centre.batch());
    if (style.viewport.zoom.kind === 'pixels-per-sample') {
      this.#drawSamples(pool, lane, audio, style, middle, scale, out);
    } else {
      this.#drawColumns(pool, lane, audio, style, middle, scale, out);
    }
  }

  #drawColumns(
    pool: BuilderPool,
    lane: Lane,
    audio: KnownAudio,
    style: WaveformStyle,
    middle: number,
    scale: number,
    out: RenderBatch[],
  ): void {
    const { area } = lane;
    const ratio = style.pixelRatio;
    const zoom = style.viewport.zoom;
    const samplesPerPixel = zoom.kind === 'samples-per-pixel' ? zoom.samples : 1;
    const span: ColumnSpan = {
      start: style.viewport.start,
      framesPerColumn: samplesPerPixel / ratio,
      columns: Math.ceil(area.width * ratio),
    };
    const columns = this.#columnsFor(span.columns);
    if (audio.pyramid === undefined) {
      columns.columns = span.columns;
      columns.known.fill(0, 0, span.columns);
    } else {
      readPyramidColumns(audio.pyramid, lane.channel, span, columns);
    }
    const detail = detailFor(span.framesPerColumn);
    if (detail === DetailKind.Buckets && audio.buckets !== undefined) {
      readBucketColumns(audio.buckets, lane.channel, span, columns);
    } else if (detail === DetailKind.Samples && audio.samples !== undefined) {
      readSampleColumns(audio.samples, lane.channel, span, columns);
    }
    this.#drawKnown(pool, lane, columns, span, audio.length, style, middle, scale, out);
  }

  /** Draws the columns read: each known one's envelope, and each unknown one as pending. */
  #drawKnown(
    pool: BuilderPool,
    lane: Lane,
    columns: ColumnPeaks,
    span: ColumnSpan,
    length: number,
    style: WaveformStyle,
    middle: number,
    scale: number,
    out: RenderBatch[],
  ): void {
    const { area } = lane;
    const ratio = style.pixelRatio;
    const peaks = pool.rectangles(style.palette.peak);
    const rms = pool.rectangles(style.palette.rms);
    const clipped = pool.rectangles(style.palette.clipped);
    const pending = pool.rectangles(style.palette.pending);
    const width = 1 / ratio;
    const bottom = area.y + area.height;
    const clamp = (y: number): number => Math.min(bottom, Math.max(area.y, y));
    for (let column = 0; column < columns.columns; column += 1) {
      const x = area.x + column / ratio;
      if (span.start + column * span.framesPerColumn >= length) break;
      if (columns.known[column] !== 1) {
        pending.add(x, area.y, width, area.height);
        this.#waiting = true;
        continue;
      }
      const high = clamp(middle - (columns.maximum[column] ?? 0) * scale);
      const low = clamp(middle - (columns.minimum[column] ?? 0) * scale);
      peaks.add(x, high, width, Math.max(width, low - high));
      if (style.rms) {
        const reach = (columns.rms[column] ?? 0) * scale;
        const rmsTop = clamp(middle - reach);
        rms.add(x, rmsTop, width, Math.max(0, clamp(middle + reach) - rmsTop));
      }
      if (style.clipping && columns.clipped[column] === 1) {
        clipped.add(x, area.y, width, 2 * width);
        clipped.add(x, bottom - 2 * width, width, 2 * width);
      }
    }
    out.push(pending.batch(), peaks.batch(), rms.batch(), clipped.batch());
  }

  #drawSamples(
    pool: BuilderPool,
    lane: Lane,
    audio: KnownAudio,
    style: WaveformStyle,
    middle: number,
    scale: number,
    out: RenderBatch[],
  ): void {
    const { area } = lane;
    const held = audio.samples;
    const first = sampleAt(style.viewport, 0, audio.length);
    const last = sampleAt(style.viewport, area.width, audio.length);
    if (first === undefined || last === undefined) return;
    const samples = held?.channels[lane.channel];
    if (
      held === undefined ||
      samples === undefined ||
      first < held.start ||
      last >= held.start + windowFrames(held)
    ) {
      const pending = pool.rectangles(style.palette.pending);
      pending.add(area.x, area.y, area.width, area.height);
      out.push(pending.batch());
      this.#waiting = true;
      return;
    }
    const zoom = style.viewport.zoom;
    const half = zoom.kind === 'pixels-per-sample' ? zoom.pixels / 2 : 0;
    const lines = pool.segments(style.palette.peak, 1.5);
    const points = pool.rectangles(style.palette.peak);
    const clipped = pool.rectangles(style.palette.clipped);
    const top = area.y;
    const bottom = area.y + area.height;
    let previous: readonly [number, number] | undefined;
    for (let sample: number = first; sample <= last; sample += 1) {
      const value = samples[sample - held.start] ?? 0;
      const x = area.x + pixelOf(style.viewport, sample) + half;
      const y = Math.min(bottom, Math.max(top, middle - value * scale));
      if (previous !== undefined) lines.add(previous[0], previous[1], x, y);
      if (half * 2 >= 8) points.add(x - POINT / 2, y - POINT / 2, POINT, POINT);
      if (style.clipping && (value >= 1 || value <= -1)) clipped.add(x - POINT / 2, top, POINT, 2);
      previous = [x, y];
    }
    out.push(lines.batch(), points.batch(), clipped.batch());
  }
}
