import { describe, expect, it } from 'vitest';

import { derivedSampleCount, sampleRate, type DomainResult } from '@audiogubbins/domain';

import {
  calibrationOf,
  manualCalibration,
  measuredCalibration,
  pathChanges,
  takeCompensation,
  withManualOffset,
  type CalibrationPath,
  type LatencyCalibration,
} from './latency-calibration.js';

function valueOf<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

const RATE = valueOf(sampleRate(48_000));
const OTHER_RATE = valueOf(sampleRate(44_100));
const INPUT = { id: 'input-1', group: 'group-1', label: 'Interface In' };
const OUTPUT = { id: 'output-1', group: 'group-1', label: 'Interface Out' };
const PATH: CalibrationPath = { input: INPUT, output: OUTPUT, rate: RATE };
const MEASURED = { roundTrip: derivedSampleCount(480), peakRatio: 40 };

describe('a latency calibration (REQ-REC-095)', () => {
  it("splits the measured round trip into the output's reported share and the input's", () => {
    const calibration = valueOf(measuredCalibration(PATH, MEASURED, 0.005, 1_000));
    expect(calibration).toEqual({
      ...PATH,
      measured: { roundTrip: 480, output: 240, input: 240, peakRatio: 40, at: 1_000 },
      manualOffset: 0,
    });
  });

  it('refuses a round trip shorter than the output latency the browser reports', () => {
    const result = measuredCalibration(PATH, MEASURED, 0.02, 1_000);
    expect(result).toMatchObject({
      ok: false,
      failures: [{ code: 'recording.calibration-inconsistent' }],
    });
  });

  it('keeps only the path of a whole calibration it is given as one', () => {
    const earlier = valueOf(measuredCalibration(PATH, MEASURED, 0.005, 1_000));
    expect(valueOf(manualCalibration(earlier, 12))).toEqual({ ...PATH, manualOffset: 12 });
  });

  it('takes a manual offset of whole frames, either way', () => {
    const manual = valueOf(manualCalibration(PATH, -64));
    expect(manual.manualOffset).toBe(-64);
    expect(withManualOffset(manual, 1.5).ok).toBe(false);
    expect(valueOf(withManualOffset(manual, 30)).manualOffset).toBe(30);
  });

  it('applies to its own input, output and rate, and names each change that asks for another', () => {
    expect(
      pathChanges(PATH, {
        ...PATH,
        input: { id: 'renewed', group: 'group-1', label: 'Interface In' },
      }),
    ).toEqual([]);
    expect(pathChanges(PATH, { ...PATH, output: { id: 'output-2' } })).toEqual(['output']);
    expect(
      pathChanges(PATH, { input: { id: 'x' }, output: { id: 'y' }, rate: OTHER_RATE }),
    ).toEqual(['input', 'output', 'rate']);
  });

  it('is found among those kept for the current path only', () => {
    const here = valueOf(manualCalibration(PATH, 10));
    const elsewhere = valueOf(manualCalibration({ ...PATH, rate: OTHER_RATE }, 20));
    expect(calibrationOf([elsewhere, here], PATH)).toBe(here);
    expect(calibrationOf([elsewhere], PATH)).toBeUndefined();
  });
});

describe("a take's compensation (REQ-REC-095, ADR-0072)", () => {
  const reported = { output: 0.01, input: 0.002 };

  it('is the measured round trip plus the manual offset, on a calibrated path', () => {
    const calibration: LatencyCalibration = {
      ...valueOf(measuredCalibration(PATH, MEASURED, 0.005, 1_000)),
      manualOffset: -16,
    };
    expect(takeCompensation([calibration], PATH, reported)).toEqual({
      frames: 464,
      basis: 'measured',
      manualOffset: -16,
    });
  });

  it("is the browser's reports of both latencies without a measurement, plus any manual offset", () => {
    expect(takeCompensation([], PATH, reported)).toEqual({
      frames: 480 + 96,
      basis: 'reported',
      manualOffset: 0,
    });
    expect(takeCompensation([valueOf(manualCalibration(PATH, 8))], PATH, reported).frames).toBe(
      584,
    );
  });

  it("is the output's alone where the browser reports no input latency, and says so", () => {
    expect(takeCompensation([], PATH, { output: 0.01 })).toEqual({
      frames: 480,
      basis: 'output-only',
      manualOffset: 0,
    });
  });

  it('ignores a calibration of another path', () => {
    const elsewhere = valueOf(
      measuredCalibration({ ...PATH, output: { id: 'other' } }, MEASURED, 0, 1),
    );
    expect(takeCompensation([elsewhere], PATH, reported).basis).toBe('reported');
  });
});
