/**
 * A stream of a plan changed by a spectral edit (ADR-0081): its segments
 * plus the overlap-added change of each frame the edit's mask reaches
 * (`spectral/spectral-frames.ts`, `spectral/spectral-change.ts`).
 *
 * The output is made a chunk at a time. For a chunk from `p`, every frame that
 * begins before the chunk's end is added, in order, into running sums that
 * reach a frame past it, so a sample is given only once every frame that holds
 * it has been added; each sample is its input plus its sum, and a sample no
 * changed frame reaches is its input, bit for bit. Frames are placed from the
 * stream's start, never from where a read began, and each sample's sum is added
 * frame by frame in the frames' order, so the output is the same however it is
 * read: from the start, part way, or in chunks of any size.
 *
 * Reads are made one at a time, in order, as every reader of a plan makes
 * them: a read behind the last starts again where it asks. The stream's
 * segments are read once, forwards, through a window that the frames and a
 * `process` edit's chain share (`spectral/forward-window.ts`). A heal first
 * walks every frame its borders need, once for the content's life.
 */

import {
  HEAL_BORDER_FRAMES,
  throwIfCancelled,
  type CancellationSignal,
  type ChannelLayout,
  type PlannedSpectralEdit,
  type QualitySettings,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { ForwardWindow, type WindowSource } from '../spectral/forward-window.js';
import { HealBorders, type Spectrum } from '../spectral/heal-borders.js';
import { SpectralChange } from '../spectral/spectral-change.js';
import { FrameGeometry, FrameTransform } from '../spectral/spectral-frames.js';
import { MediaReadFailure, type ContentReader } from './plan-content.js';

/** What a spectral stream is realised with. */
export interface SpectralSettings {
  readonly quality: QualitySettings;
  readonly dsp: CanonicalDsp;
}

/**
 * How a `process` edit's chain is run over the stream: given the stream's
 * segments as the chain hears them, the content of the chain's output.
 */
export type WetRun = (input: WindowSource & { readonly length: number }) => ContentReader;

/** A spectrum per channel, each with its scratch. */
function spectra(channels: number, bins: number): Spectrum[] {
  return Array.from({ length: channels }, () => ({
    real: new Float64Array(bins),
    imaginary: new Float64Array(bins),
  }));
}

/** A stream changed by a spectral edit, read in order. */
export class SpectralContent implements ContentReader {
  readonly channels: number;
  readonly length: number;
  readonly #geometry: FrameGeometry;
  readonly #transform: FrameTransform;
  readonly #change: SpectralChange;
  readonly #dry: ForwardWindow;
  readonly #wet: ForwardWindow | undefined;
  readonly #wetContent: ContentReader | undefined;
  /** Frames made at a time: the chunk's length. */
  readonly #chunk: number;
  /** Per channel, the sums of the changes from the chunk's start, a chunk and a frame long. */
  readonly #sums: readonly Float64Array[];
  readonly #spectra: Spectrum[];
  readonly #wetSpectra: Spectrum[];
  readonly #out: Spectrum;
  /** The chunk made last: its start, and per channel its samples. */
  readonly #made: readonly Float32Array[];
  #madeStart = Number.NEGATIVE_INFINITY;
  /** The start of the chunk the sums begin at. */
  #chunkStart = 0;
  /** The next frame to add. */
  #next = 0;
  /** The next sample a reader is given. */
  #position = Number.NEGATIVE_INFINITY;
  /** The first sample the chunk being made reads, which the chain's reads keep held. */
  #needed = 0;
  #borders: HealBorders | undefined;

  constructor(
    input: WindowSource,
    stream: { readonly sampleRate: SampleRate; readonly layout: ChannelLayout },
    length: number,
    edit: PlannedSpectralEdit,
    settings: SpectralSettings,
    wet?: WetRun,
  ) {
    this.channels = stream.layout.roles.length;
    this.length = length;
    const size = edit.resolution;
    this.#geometry = new FrameGeometry(size, settings.quality.spectralOverlap, length);
    const fft = settings.dsp.createFft(size);
    // A validated edit's resolution is one the canonical FFT takes, so this is
    // a fault of the DSP, which the read reports as it reports a file's.
    if (!fft.ok) throw new MediaReadFailure(fft.failures[0]);
    this.#transform = new FrameTransform(this.#geometry, fft.value);
    this.#change = new SpectralChange(edit, this.#geometry, stream.sampleRate);
    this.#dry = new ForwardWindow(input, this.channels, length);
    if (wet !== undefined) {
      const dry = this.#dry;
      // The chain hears the stream through the same window, so the segments
      // are read once for the frames and the chain alike; what the chain has
      // read past, and the frames do not need, is let go as it goes.
      this.#wetContent = wet({
        length,
        read: async (start, frames, into, signal) => {
          await dry.hold(start, start + frames, signal);
          dry.copy(start, frames, into);
          dry.release(Math.min(start, this.#needed));
        },
      });
      this.#wet = new ForwardWindow(this.#wetContent, this.channels, length);
    }
    this.#chunk = Math.max(size, 4_096);
    const bins = this.#geometry.bins;
    this.#sums = Array.from({ length: this.channels }, () => new Float64Array(this.#chunk + size));
    this.#spectra = spectra(this.channels, bins);
    this.#wetSpectra = spectra(this.channels, bins);
    this.#out = { real: new Float64Array(bins), imaginary: new Float64Array(bins) };
    this.#made = Array.from({ length: this.channels }, () => new Float32Array(this.#chunk));
  }

  async read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    if (this.#change.edit.operation.kind === 'heal' && this.#borders === undefined) {
      this.#borders = await this.#healBorders(signal);
    }
    if (start !== this.#position) this.#begin(start);
    let given = 0;
    while (given < frames) {
      const madeEnd = this.#madeStart + this.#chunk;
      if (this.#position >= madeEnd || this.#position < this.#madeStart) {
        await this.#makeChunk(signal);
        continue;
      }
      const count = Math.min(frames - given, madeEnd - this.#position);
      const at = this.#position - this.#madeStart;
      for (let channel = 0; channel < into.length; channel += 1) {
        into[channel]?.set(this.#made[channel]?.subarray(at, at + count) ?? [], given);
      }
      given += count;
      this.#position += count;
    }
  }

  release(): void {
    this.#transform.release();
    this.#wetContent?.release();
  }

  /** Begins again so the next sample made is `start`. */
  #begin(start: number): void {
    this.#position = start;
    this.#chunkStart = start;
    this.#madeStart = Number.NEGATIVE_INFINITY;
    this.#next = this.#geometry.firstReaching(start);
    for (const sums of this.#sums) sums.fill(0);
  }

  /** Makes the chunk from `#chunkStart`: adds the frames that begin before its end, then gives it. */
  async #makeChunk(signal: CancellationSignal | undefined): Promise<void> {
    throwIfCancelled(signal);
    const geometry = this.#geometry;
    const start = this.#chunkStart;
    const end = start + this.#chunk;
    const first = geometry.first(this.#next);
    const last = Math.min(geometry.lastBefore(end), geometry.lastFrame);
    const reach = geometry.first(last) + geometry.size;
    this.#needed = Math.min(first, start);
    // The chain first, which reads the stream through the frames' window and
    // leaves it holding what the frames need.
    await this.#wet?.hold(this.#needed, Math.max(reach, end), signal);
    await this.#dry.hold(this.#needed, Math.max(reach, end), signal);
    for (let k = this.#next; k <= last; k += 1) this.#addFrame(k, start);
    this.#next = Math.max(this.#next, last + 1);
    this.#give(start);
    this.#madeStart = start;
    this.#chunkStart = end;
    for (const sums of this.#sums) {
      sums.copyWithin(0, this.#chunk);
      sums.fill(0, sums.length - this.#chunk);
    }
    // Every frame still to add begins at or after the next chunk's start less
    // a frame, so nothing before that is read again.
    this.#dry.release(end - geometry.size);
    this.#wet?.release(end - geometry.size);
  }

  /** Adds the change of frame `k` into the sums, which begin at `sumsStart`. */
  #addFrame(k: number, sumsStart: number): void {
    const change = this.#change;
    const weights = change.weights(k);
    if (weights === undefined) return;
    const frameStart = this.#geometry.first(k);
    const dryOffset = frameStart - this.#dry.start;
    const offset = frameStart - sumsStart;
    for (let channel = 0; channel < this.channels; channel += 1) {
      if (!change.acts(channel)) continue;
      const x = this.#spectra[channel];
      const sums = this.#sums[channel];
      if (x === undefined || sums === undefined) continue;
      this.#transform.analyse(this.#dry.samples(channel), dryOffset, x.real, x.imaginary);
      let wet: Spectrum | undefined;
      if (this.#wet !== undefined) {
        wet = this.#wetSpectra[channel];
        if (wet !== undefined) {
          this.#transform.analyse(
            this.#wet.samples(channel),
            frameStart - this.#wet.start,
            wet.real,
            wet.imaginary,
          );
        }
      }
      change.change(k, channel, weights, x, this.#out, wet, this.#borders);
      // Samples of the frame before the sums' start were given already.
      const from = Math.max(0, -offset);
      this.#transform.synthesise(this.#out.real, this.#out.imaginary, sums, offset, from);
    }
  }

  /** Writes the chunk from `start`: each sample its input plus its sum, a sum of nothing its input. */
  #give(start: number): void {
    const count = Math.max(0, Math.min(this.#chunk, this.length - start));
    const at = start - this.#dry.start;
    for (let channel = 0; channel < this.channels; channel += 1) {
      const made = this.#made[channel];
      const sums = this.#sums[channel];
      if (made === undefined || sums === undefined) continue;
      const dry = this.#dry.samples(channel);
      for (let n = 0; n < count; n += 1) {
        const input = dry[at + n] ?? 0;
        const sum = sums[n] ?? 0;
        made[n] = sum === 0 ? input : Math.fround(input + sum);
      }
    }
  }

  /**
   * The heal's borders: every frame from four before the first the mask may
   * reach to four after the last, walked once, in order, through a window of
   * its own, since the frames' window is then read again from the start. A
   * frame that holds samples past the stream's ends is not analysed, since it
   * is no border.
   */
  async #healBorders(signal: CancellationSignal | undefined): Promise<HealBorders> {
    const geometry = this.#geometry;
    const change = this.#change;
    const borders = new HealBorders(geometry.bins, this.channels);
    const first = Math.max(geometry.firstFrame, change.first - HEAL_BORDER_FRAMES);
    const last = Math.min(geometry.lastFrame, change.last + HEAL_BORDER_FRAMES);
    const dry = this.#dry;
    for (let k = first; k <= last; k += 1) {
      throwIfCancelled(signal);
      const frameStart = geometry.first(k);
      await dry.hold(frameStart, frameStart + geometry.size, signal);
      const weights = change.weights(k);
      const whole = frameStart >= 0 && frameStart + geometry.size <= this.length;
      if (whole) {
        for (let channel = 0; channel < this.channels; channel += 1) {
          const x = this.#spectra[channel];
          if (x === undefined) continue;
          this.#transform.analyse(
            dry.samples(channel),
            frameStart - dry.start,
            x.real,
            x.imaginary,
          );
        }
      }
      borders.take(k, weights, whole ? this.#spectra : undefined);
      dry.release(frameStart + geometry.hop);
    }
    borders.finish();
    return borders;
  }
}
