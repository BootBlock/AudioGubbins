/**
 * A stream of a plan made a stated length without a change of pitch
 * (ADR-0060), by the engine's phase vocoder (`dsp/phase-vocoder.ts`).
 *
 * Output frame `m` is centred at `m · H` of the output, `H` the synthesis
 * hop, and reads the input centred at the same place scaled by the ratio of
 * the lengths, rounded to a whole frame, so the hop the analysis takes is
 * whatever the ratio makes it while the synthesis hop stays fixed. This
 * module schedules the frames: it reads the stream once, in order, keeps the
 * window of input the next frame needs and the overlap-add of the output not
 * yet given, and hands each frame to the vocoder.
 *
 * Reads are made one at a time, in order, as with a processed stream
 * (`processed-content.ts`): a read behind the last starts again from the
 * stream's start, unless a preview may start part way, in which case it starts
 * a few frames before the frame asked for with its phases taken afresh, and
 * says it is a preview. A frame half added when a read fails or is cancelled
 * leaves the windows and the overlap-add between two frames, so the read after
 * it starts afresh too.
 */

import {
  throwIfCancelled,
  type CancellationSignal,
  type PlanStream,
  type QualitySettings,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { PhaseVocoder } from '../dsp/phase-vocoder.js';
import { MediaReadFailure, type ContentReader } from './plan-content.js';
import { ProcessedStart } from './processed-content.js';

/** What a stretched stream is run with. */
export interface StretchSettings {
  readonly quality: QualitySettings;
  readonly dsp: CanonicalDsp;
  readonly start: ProcessedStart;
}

/** The stream's segments, read in order. */
interface StretchInput {
  readonly length: number;
  read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void>;
}

/** The analysis window's length in seconds, `2/25`, rounded up to a power of two of frames. */
const WINDOW_SECONDS_NUMERATOR = 2;
const WINDOW_SECONDS_DENOMINATOR = 25;
const SMALLEST_WINDOW = 256;
const LARGEST_WINDOW = 16_384;

/** How many frames a preview runs before the frame asked for, so its phases settle. */
const PREVIEW_LEAD_FRAMES = 4;

/**
 * The window's length at `rate`: the power of two at or above 80 ms of
 * frames, which resolves a low partial in frequency without smearing a
 * transient over much more than a beat's subdivision.
 */
export function stretchWindow(rate: number): number {
  let size = SMALLEST_WINDOW;
  while (
    size * WINDOW_SECONDS_DENOMINATOR < rate * WINDOW_SECONDS_NUMERATOR &&
    size < LARGEST_WINDOW
  ) {
    size *= 2;
  }
  return size;
}

/** A stream made `length` frames long without a change of pitch, read in order. */
export class StretchedContent implements ContentReader {
  readonly channels: number;
  readonly length: number;
  readonly #input: StretchInput;
  readonly #settings: StretchSettings;
  /** The analysis window's length, `N`. */
  readonly #size: number;
  /** Per channel, the input under the current analysis window, `N` frames from `inputStart`. */
  readonly #windows: readonly Float32Array[];
  /** Per channel, the output not yet given: `N` frames from `outputBase`. */
  readonly #outputs: readonly Float64Array[];
  readonly #readScratch: readonly Float32Array[];
  #vocoder: PhaseVocoder | undefined;
  /** The next frame to synthesise. */
  #next = 0;
  /** The output frame `outputs[c][0]` stands for: the start of the frame being added. */
  #outputBase = 0;
  /** The output frames before this are final: the last frame's start plus a hop. */
  #complete = 0;
  /** The next output frame a reader is given. */
  #position = 0;
  /** The input frame `windows[c][0]` stands for, or minus infinity when it holds none. */
  #inputStart = Number.NEGATIVE_INFINITY;
  /** The input frames read so far end here; nothing is read twice. */
  #inputEnd = 0;
  /** The analysis position of the previous frame, or `undefined` before the first. */
  #previousCentre: number | undefined;
  /** Whether a read failed part way, leaving a frame half added. */
  #interrupted = false;

  constructor(
    input: StretchInput,
    stream: Pick<PlanStream, 'sampleRate' | 'layout'>,
    length: number,
    settings: StretchSettings,
  ) {
    this.#input = input;
    this.#settings = settings;
    this.channels = stream.layout.roles.length;
    this.length = length;
    const size = stretchWindow(stream.sampleRate);
    this.#size = size;
    this.#windows = stream.layout.roles.map(() => new Float32Array(size));
    this.#outputs = stream.layout.roles.map(() => new Float64Array(size));
    this.#readScratch = stream.layout.roles.map(() => new Float32Array(size));
  }

  async read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    if (this.length === this.#input.length) {
      await this.#input.read(start, frames, into, signal);
      return;
    }
    let vocoder = this.#vocoder;
    if (vocoder === undefined || this.#interrupted || start < this.#position) {
      vocoder = this.#begin(start);
    }
    this.#interrupted = true;
    await this.#give(vocoder, start, frames, into, signal);
    this.#interrupted = false;
  }

  /** Gives the output from `start`, which is at or after the next frame a reader is given. */
  async #give(
    vocoder: PhaseVocoder,
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal: CancellationSignal | undefined,
  ): Promise<void> {
    let done = 0;
    while (done < frames) {
      throwIfCancelled(signal);
      if (this.#position >= this.#complete) {
        await this.#synthesise(vocoder, signal);
        continue;
      }
      const wanted = start + done;
      const until = Math.min(this.#complete, start + frames);
      if (this.#position < wanted) {
        this.#position = Math.min(wanted, until);
        continue;
      }
      const count = until - this.#position;
      const from = this.#position - this.#outputBase;
      this.#outputs.forEach((output, channel) => {
        const target = into[channel];
        if (target === undefined) return;
        for (let index = 0; index < count; index += 1) {
          target[done + index] = output[from + index] ?? 0;
        }
      });
      this.#position += count;
      done += count;
    }
  }

  /** Starts afresh so that frame `start` is given next, or a preview's lead-in before. */
  #begin(start: number): PhaseVocoder {
    let vocoder = this.#vocoder;
    if (vocoder === undefined) {
      const made = PhaseVocoder.create(
        this.#settings.dsp,
        this.#size,
        this.#settings.quality.spectralOverlap,
        this.channels,
      );
      if (!made.ok) throw new MediaReadFailure(made.failures[0]);
      vocoder = made.value;
      this.#vocoder = vocoder;
    }
    const half = this.#size / 2;
    const first =
      this.#settings.start === ProcessedStart.Preview
        ? Math.max(0, Math.floor((start + half) / vocoder.hop) - PREVIEW_LEAD_FRAMES)
        : 0;
    for (const output of this.#outputs) output.fill(0);
    this.#next = first;
    this.#outputBase = first * vocoder.hop - half;
    this.#complete = this.#outputBase;
    this.#position = Math.max(0, this.#outputBase);
    this.#inputStart = Number.NEGATIVE_INFINITY;
    this.#inputEnd = 0;
    this.#previousCentre = undefined;
    return vocoder;
  }

  /**
   * The input frame output frame `m` is centred on: `m · H` scaled by the
   * ratio of the lengths, rounded half up, exactly, since the product can pass
   * what a double holds whole.
   */
  #centreOf(m: number, hop: number): number {
    const scaled = BigInt(m * hop) * BigInt(this.#input.length) * 2n + BigInt(this.length);
    return Number(scaled / (2n * BigInt(this.length)));
  }

  /** Adds the next frame to the output, making one more hop of it final. */
  async #synthesise(vocoder: PhaseVocoder, signal: CancellationSignal | undefined): Promise<void> {
    const size = this.#size;
    const hop = vocoder.hop;
    if (this.#previousCentre !== undefined) {
      for (const output of this.#outputs) {
        output.copyWithin(0, hop);
        output.fill(0, size - hop);
      }
      this.#outputBase += hop;
    }
    const centre = this.#centreOf(this.#next, hop);
    await this.#fillInput(centre - size / 2, signal);
    const previous = this.#previousCentre;
    const analysisHop = previous === undefined ? undefined : centre - previous;
    this.#windows.forEach((held, channel) => {
      const output = this.#outputs[channel];
      if (output !== undefined) vocoder.transform(channel, held, analysisHop, output);
    });
    this.#previousCentre = centre;
    this.#complete = this.#outputBase + hop;
    this.#next += 1;
  }

  /** Makes the windows hold the `N` input frames from `from`, reading each frame of the stream once. */
  async #fillInput(from: number, signal: CancellationSignal | undefined): Promise<void> {
    const size = this.#size;
    const kept = Math.min(size, Math.max(0, this.#inputStart + size - from));
    for (const held of this.#windows) {
      if (kept > 0) held.copyWithin(0, from - this.#inputStart);
      held.fill(0, kept);
    }
    this.#inputStart = from;
    const readFrom = Math.max(this.#inputEnd, from, 0);
    const readTo = Math.min(from + size, this.#input.length);
    if (readTo > readFrom) {
      const count = readTo - readFrom;
      await this.#input.read(
        readFrom,
        count,
        this.#readScratch.map((channel) => channel.subarray(0, count)),
        signal,
      );
      this.#windows.forEach((held, channel) => {
        const read = this.#readScratch[channel];
        if (read !== undefined) held.set(read.subarray(0, count), readFrom - from);
      });
    }
    this.#inputEnd = Math.max(this.#inputEnd, readTo);
  }

  release(): void {
    this.#vocoder?.release();
    this.#vocoder = undefined;
  }
}
