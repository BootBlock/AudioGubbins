/**
 * What a normalisation's whole pass measures, as the numbers a node carries,
 * and how its measurer hears the input.
 *
 * A measurement opens with the rate and the channel count it was made at, then
 * the processor's own values. A kernel reads it only where both match its own
 * run and it holds exactly the values it expects, every one finite. A missing
 * one passes the input through unchanged, as the rack's measuring pass needs
 * (ADR-0060). One made of another stream, or of another shape than this version
 * makes, is stale, and is refused with the reason: the rack measures the stream
 * a node runs over, so its node was built wrongly, and played as though
 * unmeasured it would give the input unchanged where the processor was asked
 * for. The peaks a measurement holds are linked over every channel: the largest
 * of any, so one gain serves the whole signal and keeps the balance between its
 * channels.
 */

import {
  fail,
  failure,
  FailureKind,
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import type { MeasuringRun, ProcessorRun } from '../framework/processor-type.js';
import { finiteSample, flushSubnormal } from '../framework/sample-safety.js';
import type { Measurement, Measurer } from '../framework/whole-pass.js';

/** The values a measurement opens with: the rate, then the channel count. */
const HEADER = 2;

/** Where a peak meter's reading holds a channel's linear sample peak and true peak. */
const READING_WIDTH = 4;
export const SAMPLE_PEAK = 0;
export const TRUE_PEAK = 2;

/** The measurement `values` make for `run`, behind its header. */
function measurementOf(run: MeasuringRun, values: readonly number[]): readonly number[] {
  return [run.sampleRate, run.input.roles.length, ...values];
}

/**
 * The `count` values of `run`'s measurement after its header, nothing where
 * it has none, or why the kernel `label` names cannot run: samples are
 * another processor's kind of measurement, and a measurement of another
 * stream or shape is stale, so a node holding either was built wrongly.
 */
export function measuredValues(
  run: ProcessorRun,
  count: number,
  label: string,
): DomainResult<readonly number[] | undefined> {
  const { measured } = run;
  if (measured instanceof Float32Array) {
    return fail(
      failure(
        'processor.measurement-kind',
        FailureKind.Unrecoverable,
        `A ${label} measures its input as a list of numbers, but its node holds samples.`,
      ),
    );
  }
  if (measured === undefined) return succeed(undefined);
  const channels = run.input.roles.length;
  const values = measured.slice(HEADER);
  const why =
    measured.length !== HEADER + count
      ? `holds ${String(measured.length - HEADER)} values where this version makes ${String(count)}`
      : measured[0] !== run.sampleRate || measured[1] !== channels
        ? `was made at ${String(measured[0])} Hz over ${String(measured[1])} channels, and this run is at ${String(run.sampleRate)} Hz over ${String(channels)}`
        : values.every((value) => Number.isFinite(value))
          ? undefined
          : 'holds a value that is not a finite number';
  if (why === undefined) return succeed(values);
  return fail(
    failure(
      'processor.measurement-stale',
      FailureKind.Unrecoverable,
      `A ${label}'s measurement ${why}, so it was made of another stream or by another version.`,
    ),
  );
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
 * as the silence the kernel hears it as and cannot spoil a meter's reading;
 * and through `flushSubnormal`, so a level below silence, a subnormal among
 * them, measures as none and is never raised to the target as a level.
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
          into[frame] = flushSubnormal(finiteSample(from?.[start + frame] ?? 0));
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
  #result: Measurement | undefined;
  #released = false;

  constructor(run: MeasuringRun, meters: WholePassMeters) {
    this.#run = run;
    this.#finite = new FiniteFeed(run.input.roles.length);
    this.#meters = meters;
  }

  // The meters work synchronously, so a chunk is measured as it is given and
  // the pass is never held back; the promise's executor turns a misuse or a
  // cancellation into its rejection.
  add(input: readonly Float32Array[], frames: number, signal?: CancellationSignal): Promise<void> {
    return new Promise((resolve) => {
      if (this.#result !== undefined) {
        throw new Error('A finished measurement was given more input.');
      }
      if (this.#released) throw new Error('A released measurer was given more input.');
      throwIfCancelled(signal);
      this.#finite.feed(input, frames, (chunk) => {
        this.#meters.push(chunk);
      });
      resolve();
    });
  }

  result(signal?: CancellationSignal): Promise<DomainResult<Measurement>> {
    return new Promise((resolve) => {
      if (this.#result === undefined && this.#released) {
        throw new Error('A released measurer was asked for its result.');
      }
      throwIfCancelled(signal);
      this.#result ??= measurementOf(this.#run, this.#meters.finish());
      resolve(succeed(this.#result));
    });
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#meters.release();
  }
}
