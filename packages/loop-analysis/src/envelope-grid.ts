/**
 * The loop's 10 ms dB envelope as one pass makes it (the plan's candidate
 * search, step 2): steps on a grid aligned to S − R, each the RMS of its
 * frames in dB, measured where a step lies whole inside the range the pass
 * reads for it. A step within the radius and the drift's reach of a boundary
 * is kept one by one, since which pairs it lies inside depends on the pair;
 * every step between lies inside every pair, so it is only counted, in a
 * histogram (`envelope-histogram.ts`), and the envelope's memory does not grow
 * with the loop.
 */

import type { AudioFrameBlock } from '@audiogubbins/audio-engine';

import { ENVELOPE_BINS, binOf, stepDecibels } from './envelope-histogram.js';

/** The loop's envelope as the pass leaves it. */
export interface CapturedEnvelope {
  /** The frame the grid's first step starts at. */
  readonly origin: number;
  /** The frames of one step. */
  readonly cell: number;
  /** Each kept step's dB, one per channel, by its index on the grid. */
  readonly kept: ReadonlyMap<number, Float64Array>;
  /** The steps inside every pair, counted per channel. */
  readonly core: readonly Uint32Array[];
  /** How many steps the core counts. */
  readonly coreCount: number;
}

/** Where a grid lies and which of its steps are kept one by one. */
export interface GridPlace {
  readonly channels: number;
  /** The frame step 0 starts at. */
  readonly origin: number;
  readonly cell: number;
  /** The frames `[from, to)` steps are measured over. */
  readonly measured: readonly [number, number];
  /** The ranges a step meeting either of is kept one by one. */
  readonly keptNear: readonly (readonly [number, number])[];
}

/** Whether `[from, to)` meets `[lo, hi)`. */
function meets(from: number, to: number, lo: number, hi: number): boolean {
  return to > lo && from < hi;
}

/** The envelope, built a chunk at a time. */
export class EnvelopeGrid {
  readonly #place: GridPlace;
  readonly #firstStep: number;
  readonly #lastStep: number;
  readonly #squares: Float64Array;
  readonly #kept = new Map<number, Float64Array>();
  readonly #core: readonly Uint32Array[];
  #coreCount = 0;

  constructor(place: GridPlace) {
    this.#place = place;
    const [from, to] = place.measured;
    this.#firstStep = Math.ceil((from - place.origin) / place.cell);
    this.#lastStep = Math.floor((to - place.origin) / place.cell);
    this.#squares = new Float64Array(place.channels);
    this.#core = Array.from({ length: place.channels }, () => new Uint32Array(ENVELOPE_BINS));
  }

  /** Adds the frames of `chunk`, the first of which is frame `firstFrame`. */
  hear(chunk: AudioFrameBlock, firstFrame: number): void {
    const { origin, cell } = this.#place;
    const squares = this.#squares;
    for (let index = 0; index < chunk.frames; index += 1) {
      const frame = firstFrame + index;
      const step = Math.floor((frame - origin) / cell);
      if (step < this.#firstStep || step >= this.#lastStep) continue;
      chunk.channels.forEach((samples, channel) => {
        const sample = samples[index] ?? 0;
        squares[channel] = (squares[channel] ?? 0) + sample * sample;
      });
      if (frame - origin - step * cell === cell - 1) {
        this.#close(step);
        squares.fill(0);
      }
    }
  }

  /** Files step `step`, whose squares are summed, as kept or as counted in the core. */
  #close(step: number): void {
    const { origin, cell, keptNear } = this.#place;
    const from = origin + step * cell;
    const values = this.#squares.map((squares) => stepDecibels(squares, cell));
    if (keptNear.some(([lo, hi]) => meets(from, from + cell, lo, hi))) {
      this.#kept.set(step, values);
      return;
    }
    this.#coreCount += 1;
    this.#core.forEach((histogram, channel) => {
      const bin = binOf(values[channel] ?? 0);
      histogram[bin] = (histogram[bin] ?? 0) + 1;
    });
  }

  /** The envelope heard. */
  envelope(): CapturedEnvelope {
    return {
      origin: this.#place.origin,
      cell: this.#place.cell,
      kept: this.#kept,
      core: this.#core,
      coreCount: this.#coreCount,
    };
  }
}
