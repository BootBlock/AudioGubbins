import { describe, expect, it } from 'vitest';

import { MeasureUnit, type DetectorFinding } from '@audiogubbins/domain';
import { decibelsToGain, gainToDecibels } from '@audiogubbins/audio-engine';

import { partials } from '../testing/repair-signals.js';
import { detect, hiss, mixed, scaled, tone } from '../testing/detection-signals.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { HUM_DETECTOR } from './hum-detector.js';

const LENGTH = 4 * TEST_RATE;
/** The STFT 48 kHz is read in: bins of 1.46 Hz. */
const SIZE = 32_768;
/** Programme over a noise of −70 dBFS RMS. */
const programme = mixed(partials(LENGTH), hiss(LENGTH, -70));

/**
 * The median level of a bin of a white noise of `level` dBFS RMS, as the
 * extractor reads a level: a noise of RMS `σ` gives a bin of an `N`-sample
 * Hann frame a complex Gaussian of mean square `σ²·3N/8`, whose magnitude's
 * median is `√(ln 2)` times its RMS, read as `4·|X|/N`.
 */
function noiseFloor(level: number): number {
  const rms = Math.sqrt((3 * SIZE) / 8) * decibelsToGain(level);
  return gainToDecibels((4 * Math.sqrt(Math.LN2) * rms) / SIZE);
}

/** The de-hum `finding` recommends: its fundamental, and its offset to the nearest tenth. */
function deHumOf(finding: DetectorFinding | undefined): unknown {
  if (finding?.treatment.kind !== 'steps') return undefined;
  const { fundamental, offset } = finding.treatment.steps[0]?.values ?? {};
  return { fundamental, offset: Math.round(Number(offset) * 10) / 10 + 0 };
}

describe('the hum detector', () => {
  it('finds a 50 Hz hum over the whole audio, and treats it at the frequency measured', () => {
    const found = detect(HUM_DETECTOR, [mixed(programme, tone(LENGTH, 50.3, -50))]);
    expect(found).toHaveLength(1);
    const [finding] = found;
    expect(finding?.range).toEqual({ start: 0, end: LENGTH });
    expect(finding?.channels).toEqual([0]);
    expect(finding?.measure.unit).toBe(MeasureUnit.Decibels);
    expect(deHumOf(finding)).toEqual({ fundamental: '50-hz', offset: 0.3 });
  });

  it('measures a hum by how far it stands above the noise beside it', () => {
    // A sine reads its own peak and the floor is the noise's, while the
    // window's sidelobes, 32 dB and more under the line, stay under the
    // noise: a hum of −70 or −60 dBFS over a noise of −50 dBFS RMS, each
    // clear of the margin in nearly every frame, so the mean is over all.
    const noisy = mixed(partials(LENGTH), hiss(LENGTH, -50));
    const margin = (level: number) =>
      detect(HUM_DETECTOR, [mixed(noisy, tone(LENGTH, 60, level))])[0]?.measure.value ?? 0;
    expect(Math.abs(margin(-70) - (-70 - noiseFloor(-50)))).toBeLessThan(1.5);
    expect(Math.abs(margin(-60) - margin(-70) - 10)).toBeLessThan(1);
  });

  it('finds a 60 Hz hum, and one heard only at its second harmonic', () => {
    const sixty = detect(HUM_DETECTOR, [mixed(programme, tone(LENGTH, 60, -60))]);
    expect(deHumOf(sixty[0])).toEqual({ fundamental: '60-hz', offset: 0 });
    const buzz = detect(HUM_DETECTOR, [mixed(programme, tone(LENGTH, 100.4, -55))]);
    expect(deHumOf(buzz[0])).toEqual({ fundamental: '50-hz', offset: 0.2 });
  });

  it('treats the louder family where both show', () => {
    const both = mixed(programme, tone(LENGTH, 50, -60), tone(LENGTH, 60, -45));
    expect(deHumOf(detect(HUM_DETECTOR, [both])[0])).toEqual({ fundamental: '60-hz', offset: 0 });
    const other = mixed(programme, tone(LENGTH, 50, -45), tone(LENGTH, 60, -60));
    expect(deHumOf(detect(HUM_DETECTOR, [other])[0])).toEqual({ fundamental: '50-hz', offset: 0 });
  });

  it('finds a hum on the channels it stands on', () => {
    const found = detect(HUM_DETECTOR, [programme, mixed(programme, tone(LENGTH, 50, -50))]);
    expect(found.map(({ channels }) => channels)).toEqual([[1]]);
  });

  it('finds a hum heard over most of the audio, and none over less than half', () => {
    const hum = tone(LENGTH, 50, -50);
    const most = scaled(hum, 0, 0.35 * LENGTH, 0);
    expect(detect(HUM_DETECTOR, [mixed(programme, most)])).toHaveLength(1);
    const less = scaled(hum, 0, 0.6 * LENGTH, 0);
    expect(detect(HUM_DETECTOR, [mixed(programme, less)])).toEqual([]);
  });

  it('finds nothing in clean programme, under the margin, or under the audible level', () => {
    expect(detect(HUM_DETECTOR, [programme])).toEqual([]);
    // 8 dB over the floor of a louder noise: within what noise itself reaches.
    const noisy = mixed(partials(LENGTH), hiss(LENGTH, -40));
    const level = noiseFloor(-40) + 8;
    expect(detect(HUM_DETECTOR, [mixed(noisy, tone(LENGTH, 50, level))])).toEqual([]);
    // −95 dBFS over digital silence: far above its floor, and never heard.
    expect(detect(HUM_DETECTOR, [tone(LENGTH, 50, -95)])).toEqual([]);
    expect(detect(HUM_DETECTOR, [tone(LENGTH, 50, -85)])).toHaveLength(1);
  });

  it('finds nothing in audio shorter than one frame', () => {
    expect(
      detect(HUM_DETECTOR, [mixed(programme, tone(LENGTH, 50, -40)).subarray(0, 30_000)]),
    ).toEqual([]);
  });
});
