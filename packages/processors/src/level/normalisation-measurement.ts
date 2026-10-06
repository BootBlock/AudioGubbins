/**
 * What a normalisation's whole pass measures, as the numbers a node carries,
 * and how its measurer hears the input.
 *
 * A measurement opens with the rate and the channel count it was made at, then
 * the processor's own values. A kernel reads it only where both match its own
 * run and it holds exactly the values it expects, every one finite: a
 * measurement made of another stream, or of another shape than this version
 * makes, is stale, and a stale or a missing one passes the input through
 * unchanged, as the rack's measuring pass needs (ADR-0060). The peaks a
 * measurement holds are linked over every channel: the largest of any, so one
 * gain serves the whole signal and keeps the balance between its channels.
 */

import type { DomainResult } from '@audiogubbins/domain';

import type { Measurer, ProcessorRun } from '../framework/processor-type.js';
import { finiteSample } from '../framework/sample-safety.js';

/** The values a measurement opens with: the rate, then the channel count. */
const HEADER = 2;

/** Where a peak meter's reading holds a channel's linear sample peak and true peak. */
const READING_WIDTH = 4;
export const SAMPLE_PEAK = 0;
export const TRUE_PEAK = 2;

/** What a measurer was made for: its run, less the measurement it is making. */
export type MeasuringRun = Omit<ProcessorRun, 'measured'>;

/** The measurement `values` make for `run`, behind its header. */
function measurementOf(run: MeasuringRun, values: readonly number[]): readonly number[] {
  return [run.sampleRate, run.input.roles.length, ...values];
}

/**
 * The `count` values of `run`'s measurement after its header, or nothing
 * where it has none or it is stale.
 */
export function measuredValues(run: ProcessorRun, count: number): readonly number[] | undefined {
  const { measured } = run;
  if (measured?.length !== HEADER + count) return undefined;
  if (measured[0] !== run.sampleRate || measured[1] !== run.input.roles.length) return undefined;
  const values = measured.slice(HEADER);
  return values.every((value) => Number.isFinite(value)) ? values : undefined;
}

/** The largest of the value at `offset` of each channel's four in a peak meter's `reading`. */
export function linkedPeak(reading: Float64Array, offset: number): number {
  let largest = 0;
  for (let at = offset; at < reading.length; at += READING_WIDTH) {
    largest = Math.max(largest, reading[at] ?? 0);
  }
  return largest;
}

/** The frames of input a measurer copies at a time. */
const FEED_FRAMES = 4_096;

/**
 * The input a measurer is given, read through `finiteSample` into arrays of
 * its own and handed on a chunk at a time, so a NaN or an infinity is heard
 * as the silence the kernel hears it as and cannot spoil a meter's reading.
 */
class FiniteFeed {
  readonly #chunk: readonly Float32Array[];

  constructor(channels: number) {
    this.#chunk = Array.from({ length: channels }, () => new Float32Array(FEED_FRAMES));
  }

  /** Hands the first `frames` frames of `input` to `take`, every array of one length. */
  feed(
    input: readonly Float32Array[],
    frames: number,
    take: (chunk: readonly Float32Array[]) => void,
  ): void {
    for (let start = 0; start < frames; start += FEED_FRAMES) {
      const length = Math.min(FEED_FRAMES, frames - start);
      for (let channel = 0; channel < this.#chunk.length; channel += 1) {
        const from = input[channel];
        const into = this.#chunk[channel];
        if (into === undefined) continue;
        for (let frame = 0; frame < length; frame += 1) {
          into[frame] = finiteSample(from?.[start + frame] ?? 0);
        }
      }
      // A meter takes whole arrays, so a short chunk is a view of the start
      // of each; the pass is not on the audio thread.
      take(
        length === FEED_FRAMES
          ? this.#chunk
          : this.#chunk.map((channel) => channel.subarray(0, length)),
      );
    }
  }
}

/**
 * The meter `made` answers. A meter takes 1 to 256 channels, every layout
 * has as many, and the rate is the run's, so a refusal is a fault here.
 */
export function meterOf<T>(made: DomainResult<T>): T {
  if (!made.ok)
    throw new Error(`A normalisation could not make its meter: ${made.failures[0].summary}`);
  return made.value;
}

/** What a whole-pass measurer does with its meters. */
export interface WholePassMeters {
  /** Measures a chunk of input, made finite. */
  push(chunk: readonly Float32Array[]): void;
  /** The measurement's values, read from the meters once the input is done. */
  finish(): readonly number[];
  /** Frees the meters. */
  release(): void;
}

/**
 * A measurer that hands its input, made finite, to its meters, and whose
 * result is their values behind the run's header, made once and answered
 * again after. Its meters are freed once, by {@link release}.
 */
export class WholePassMeasurer implements Measurer {
  readonly #run: MeasuringRun;
  readonly #finite: FiniteFeed;
  readonly #meters: WholePassMeters;
  #result: readonly number[] | undefined;
  #released = false;

  constructor(run: MeasuringRun, meters: WholePassMeters) {
    this.#run = run;
    this.#finite = new FiniteFeed(run.input.roles.length);
    this.#meters = meters;
  }

  add(input: readonly Float32Array[], frames: number): void {
    if (this.#result !== undefined) throw new Error('A finished measurement was given more input.');
    if (this.#released) throw new Error('A released measurer was given more input.');
    this.#finite.feed(input, frames, (chunk) => {
      this.#meters.push(chunk);
    });
  }

  result(): readonly number[] {
    if (this.#result === undefined && this.#released) {
      throw new Error('A released measurer was asked for its result.');
    }
    this.#result ??= measurementOf(this.#run, this.#meters.finish());
    return this.#result;
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#meters.release();
  }
}
