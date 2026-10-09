/**
 * Finding the round trip in a loopback capture, off the page's thread
 * (`REQ-REC-095`).
 *
 * The recording package's analysis correlates the burst with every lag up to a
 * second, which is hundreds of millions of multiplications at studio rates: a
 * stall the page would show. So the page hands the capture to a worker of its
 * own, which runs the same analysis and answers its result. The answer crosses
 * a thread, so it is read field by field rather than trusted.
 */

import {
  FailureKind,
  fail,
  failure,
  sampleCount,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import type { LoopbackMeasurement } from '@audiogubbins/recording';

import { isMemberOf, isRecord } from '../state/stored-value.js';

/** Finds the round trip in `captured`, mono and beginning at the frame the burst was played at. */
export type MeasureRoundTrip = (
  captured: Float32Array<ArrayBuffer>,
  rate: SampleRate,
) => Promise<DomainResult<LoopbackMeasurement>>;

/** What the page asks the worker. */
export interface LoopbackQuestion {
  readonly captured: Float32Array<ArrayBuffer>;
  readonly rate: number;
}

/** Why a measurement could not be had from the worker. */
export function unmeasured(reason: string): DomainResult<never> {
  return fail(
    failure(
      'recording.loopback-worker',
      FailureKind.Unrecoverable,
      `The measurement failed: ${reason}`,
    ),
  );
}

function failureOf(value: unknown): DomainFailure | undefined {
  if (!isRecord(value)) return undefined;
  const { code, kind, summary } = value;
  if (typeof code !== 'string' || typeof summary !== 'string') return undefined;
  return isMemberOf(FailureKind, kind) ? failure(code, kind, summary) : undefined;
}

/** The worker's answer, read, or why it cannot be. */
export function measurementOf(value: unknown): DomainResult<LoopbackMeasurement> {
  if (isRecord(value) && value['ok'] === true && isRecord(value['value'])) {
    const { roundTrip, peakRatio } = value['value'];
    const frames = typeof roundTrip === 'number' ? sampleCount(roundTrip) : undefined;
    if (frames?.ok === true && typeof peakRatio === 'number' && Number.isFinite(peakRatio)) {
      return succeed({ roundTrip: frames.value, peakRatio });
    }
  }
  if (isRecord(value) && value['ok'] === false && Array.isArray(value['failures'])) {
    const read = value['failures'].map(failureOf);
    const known = read.filter((one): one is DomainFailure => one !== undefined);
    const [first, ...rest] = known;
    if (first !== undefined && known.length === read.length) return fail(first, ...rest);
  }
  return unmeasured('its answer could not be read.');
}
