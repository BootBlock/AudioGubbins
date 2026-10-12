/**
 * Making tiles: the canonical STFT of `crates/analysis` run over the windows a
 * tile's columns take, through the engine's port, and each column's per-bin
 * maximum power quantised (ADR-0080). Nothing else analyses audio for the
 * spectrogram, so the reference and the WebAssembly DSP make the same bytes.
 *
 * The tiles of several channels at one place are made in one pass, one STFT of
 * those channels over one read of the sound. Where a level's windows overlap or
 * touch, the frames from its first window's start to its last window's end are
 * read and pushed a chunk at a time, the STFT stepping by the level's spacing;
 * where they lie apart, at the coarse levels of a short window, each window's
 * samples alone are read and pushed, the STFT stepping by its whole length, so
 * a three-hour sound's coarsest tile reads a few thousand windows, not three
 * hours. The work gives the worker's host a turn between chunks, and stops at
 * the first after its signal is cancelled.
 */

import {
  allocateBlock,
  blockView,
  type AudioFrameBlock,
  type CanonicalDsp,
  type CanonicalStft,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import { sampleCount, throwIfCancelled, type CancellationSignal } from '@audiogubbins/domain';

import { levelThresholds, quantisedLevel } from './level-quantisation.js';
import {
  tileSpan,
  windowStart,
  type LevelGeometry,
  type SpectrogramGeometry,
} from './tile-geometry.js';

/** Frames read at a time where a level's windows overlap. */
const CHUNK_FRAMES = 65_536;

/** The tiles of some channels at one place. */
export interface TileWork {
  readonly geometry: SpectrogramGeometry;
  readonly level: number;
  readonly index: number;
  /** Distinct channels of the sound, each made a tile of. */
  readonly channels: readonly number[];
}

/** What the work reads the sound with. */
export interface AnalysisContext {
  /** The edited sound, `geometry.frames` long. */
  readonly source: PcmSource;
  readonly dsp: CanonicalDsp;
  readonly yieldToHost: () => Promise<void>;
  readonly signal: CancellationSignal;
}

/**
 * Reads `into.frames` frames of `source` from `start`, which may lie before
 * the sound, as silence wherever they lie outside its `length` frames.
 */
async function readSpan(
  source: PcmSource,
  start: number,
  into: AudioFrameBlock,
  length: number,
  signal: CancellationSignal,
): Promise<void> {
  for (const channel of into.channels) channel.fill(0);
  const first = Math.max(0, start);
  const end = Math.min(length, start + into.frames);
  if (end <= first) return;
  const at = sampleCount(first);
  if (!at.ok) throw new RangeError(at.failures[0].summary);
  await source.read(at.value, blockView(into, first - start, end - first), signal);
}

/** The columns of a tile as the STFT's frames arrive: each column's maxima, then its bytes. */
class ColumnWriter {
  readonly tiles: readonly Uint8Array<ArrayBuffer>[];
  readonly #columns: number;
  readonly #bins: number;
  readonly #windows: number;
  readonly #thresholds: Float64Array;
  readonly #maxima: Float64Array;
  readonly #real: Float64Array;
  readonly #imaginary: Float64Array;
  #frames = 0;

  constructor(geometry: SpectrogramGeometry, level: LevelGeometry, columns: number, count: number) {
    this.#columns = columns;
    this.#bins = geometry.bins;
    this.#windows = level.windows;
    this.#thresholds = levelThresholds(geometry.config);
    this.#maxima = new Float64Array(count * geometry.bins);
    this.#real = new Float64Array(count * geometry.bins);
    this.#imaginary = new Float64Array(count * geometry.bins);
    this.tiles = Array.from({ length: count }, () => new Uint8Array(columns * geometry.bins));
  }

  /** Frames taken so far. */
  get frames(): number {
    return this.#frames;
  }

  /** Takes every frame the STFT has ready. */
  drain(stft: CanonicalStft): void {
    const maxima = this.#maxima;
    const real = this.#real;
    const imaginary = this.#imaginary;
    while (stft.pullComplex(real, imaginary)) {
      for (let cell = 0; cell < maxima.length; cell += 1) {
        const re = real[cell] ?? 0;
        const im = imaginary[cell] ?? 0;
        const power = re * re + im * im;
        if (power > (maxima[cell] ?? 0)) maxima[cell] = power;
      }
      this.#frames += 1;
      if (this.#frames % this.#windows === 0) this.#write(this.#frames / this.#windows - 1);
    }
  }

  #write(column: number): void {
    const bins = this.#bins;
    this.tiles.forEach((tile, channel) => {
      for (let bin = 0; bin < bins; bin += 1) {
        tile[bin * this.#columns + column] = quantisedLevel(
          this.#maxima[channel * bins + bin] ?? 0,
          this.#thresholds,
        );
      }
    });
    this.#maxima.fill(0);
  }
}

/** The tiles of `work`'s channels, in its order, each `bins` rows of its columns. */
export async function analyseTiles(
  work: TileWork,
  context: AnalysisContext,
): Promise<readonly Uint8Array<ArrayBuffer>[]> {
  const { geometry } = work;
  const level = geometry.levels[work.level];
  if (level === undefined)
    throw new RangeError(`The spectrogram has no level ${String(work.level)}.`);
  const span = tileSpan(level, work.index);
  const size = geometry.config.windowLength;
  const made = context.dsp.createStft({
    channels: work.channels.length,
    size,
    hop: Math.min(level.spacing, size),
    window: geometry.config.window,
  });
  if (!made.ok) throw new Error(made.failures[0].summary);
  const stft = made.value;
  try {
    const writer = new ColumnWriter(geometry, level, span.columns, work.channels.length);
    const first = (span.start / level.columnFrames) * level.windows;
    const count = span.columns * level.windows;
    if (level.spacing <= size) {
      await pushSpan(work, context, stft, writer, {
        from: windowStart(geometry.config, level, first),
        to: windowStart(geometry.config, level, first + count - 1) + size,
      });
    } else {
      await pushWindows(work, level, context, stft, writer, { first, count });
    }
    if (writer.frames !== count) {
      throw new Error(
        `A tile took ${String(writer.frames)} windows of the ${String(count)} it spans.`,
      );
    }
    return writer.tiles;
  } finally {
    stft.release();
  }
}

/** The selected channels of a block, as the STFT takes them. */
function selected(block: AudioFrameBlock, channels: readonly number[]): readonly Float32Array[] {
  return channels.map((channel) => {
    const samples = block.channels[channel];
    if (samples === undefined) throw new RangeError(`The sound has no channel ${String(channel)}.`);
    return samples;
  });
}

/** Pushes every frame from `from` to `to`, a chunk at a time, where the windows overlap. */
async function pushSpan(
  work: TileWork,
  context: AnalysisContext,
  stft: CanonicalStft,
  writer: ColumnWriter,
  span: { readonly from: number; readonly to: number },
): Promise<void> {
  const { source, signal } = context;
  const block = allocateBlock(
    source.layout,
    source.sampleRate,
    Math.min(CHUNK_FRAMES, span.to - span.from),
  );
  for (let at = span.from; at < span.to; at += CHUNK_FRAMES) {
    const chunk = blockView(block, 0, Math.min(CHUNK_FRAMES, span.to - at));
    await readSpan(source, at, chunk, work.geometry.frames, signal);
    stft.push(selected(chunk, work.channels));
    writer.drain(stft);
    await context.yieldToHost();
    throwIfCancelled(signal);
  }
}

/** Pushes each window's samples alone, where the windows lie apart. */
async function pushWindows(
  work: TileWork,
  level: LevelGeometry,
  context: AnalysisContext,
  stft: CanonicalStft,
  writer: ColumnWriter,
  { first, count }: { readonly first: number; readonly count: number },
): Promise<void> {
  const { source, signal } = context;
  const { config } = work.geometry;
  const block = allocateBlock(source.layout, source.sampleRate, config.windowLength);
  for (let window = first; window < first + count; window += 1) {
    await readSpan(source, windowStart(config, level, window), block, work.geometry.frames, signal);
    stft.push(selected(block, work.channels));
    writer.drain(stft);
    if ((window - first + 1) % level.windows === 0) {
      await context.yieldToHost();
      throwIfCancelled(signal);
    }
  }
}
