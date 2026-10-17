import { describe, expect, it } from 'vitest';

import type { LoudnessMeasurement } from '@audiogubbins/detection-runtime';
import type { LoudnessTarget } from '@audiogubbins/game-audio';

import type { LoudnessReading } from '../../state/loudness-store.js';
import { CONFORMANCE_VERDICTS, conformance, conformanceWords } from './loudness-conformance.js';

const TARGET: LoudnessTarget = { integratedLufs: -16, toleranceLu: 1, truePeakCeilingDbtp: -1 };

function measured(integratedLufs: number | undefined, truePeakDbtp = -3): LoudnessReading {
  const measurement: LoudnessMeasurement = {
    frames: 48_000,
    integratedLufs,
    rangeLu: 2,
    truePeakDbtp,
  };
  return { kind: 'measured', identity: 'now', name: 'Step', measurement };
}

describe("a member's loudness against its target (ADR-0101)", () => {
  it('conforms within the tolerance, and says by how much it is off outside it', () => {
    expect(conformance(TARGET, measured(-16.8), 'now')).toEqual({ kind: 'conforms', lufs: -16.8 });
    expect(conformance(TARGET, measured(-14.5), 'now')).toEqual({
      kind: 'too-loud',
      lufs: -14.5,
      by: 1.5,
    });
    expect(conformance(TARGET, measured(-18), 'now')).toEqual({
      kind: 'too-quiet',
      lufs: -18,
      by: 2,
    });
  });

  it('holds the true peak to the ceiling before the loudness', () => {
    expect(conformance(TARGET, measured(-16, -0.5), 'now')).toEqual({
      kind: 'peaks-over',
      peak: -0.5,
      by: 0.5,
    });
    const noCeiling: LoudnessTarget = { integratedLufs: -16, toleranceLu: 1 };
    expect(conformance(noCeiling, measured(-16, -0.5), 'now').kind).toBe('conforms');
  });

  it('never stands a reading of audio changed since for the audio now, and says what is missing', () => {
    expect(conformance(TARGET, measured(-16), 'changed').kind).toBe('stale');
    expect(conformance(undefined, measured(-16), 'now').kind).toBe('no-target');
    expect(conformance(TARGET, undefined, 'now').kind).toBe('unmeasured');
    expect(conformance(TARGET, measured(undefined), 'now').kind).toBe('silent');
  });

  it('tells every verdict in words and by its glyph, never by colour alone', () => {
    expect(conformanceWords({ kind: 'conforms', lufs: -16.2 })).toBe('Conforms at −16.2 LUFS');
    expect(conformanceWords({ kind: 'too-loud', lufs: -14.5, by: 1.5 })).toBe(
      'Too loud: −14.5 LUFS, 1.5 LU over',
    );
    expect(conformanceWords({ kind: 'measuring', percent: 40 })).toBe('Measuring, 40%');
    expect(CONFORMANCE_VERDICTS.conforms).toBe('passes');
    expect(CONFORMANCE_VERDICTS['too-loud']).toBe('fails');
    expect(CONFORMANCE_VERDICTS.stale).toBe('warns');
    expect(CONFORMANCE_VERDICTS.measuring).toBe('running');
    expect(CONFORMANCE_VERDICTS['no-target']).toBe('none');
  });
});
