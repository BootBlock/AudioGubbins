/**
 * The measuring objects allocate nothing per call once warm, on either
 * implementation of the port.
 *
 * A meter runs on the audio thread, where a collection pauses the quantum that
 * triggered it, and a spectral processor pulls an STFT frame there, so an
 * array, a view, a message or a closure made per push or per pull is a pause
 * waiting to happen. The one memory that grows, a loudness meter's gating
 * history, grows by doubling, rarely enough that most measured trials see none
 * of it. How an allocation is measured is in `testing/allocation.ts`.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { QUANTA, allocatedBy } from '../testing/allocation.js';
import { dspModuleExports } from '../testing/dsp-module.js';
import { DetectorKind, type DetectorSettings, StftWindow } from './canonical-analysis.js';
import type { CanonicalDsp } from './canonical-dsp.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

/** The frames of one render quantum. */
const FRAMES = 128;

/**
 * Quanta each run is warmed for first: about four minutes of audio. A
 * meter's step, a detector's block and the canonical logarithm and
 * arctangent they call run once in some tens of quanta, so the warming
 * `allocatedBy` gives a run leaves them a tier short of the optimised code
 * an engine runs within minutes, which still boxes the numbers its helpers
 * answer. This reaches that code; an allocation in it still fails.
 */
const WARM_QUANTA = 100_000;

/** Measures `quantum` as `allocatedBy` does, after {@link WARM_QUANTA} of it. */
function warmedAllocation(quantum: () => void): number {
  for (let count = 0; count < WARM_QUANTA; count += 1) quantum();
  return allocatedBy({ quantum });
}

const RATE = expectSuccess(sampleRate(48_000));

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

/** A quantum of stereo samples, a tone in each channel. */
const INPUT = [0.011, 0.017].map((turns) =>
  Float32Array.from({ length: FRAMES }, (_, n) => 0.5 * Math.sin(2 * Math.PI * turns * n)),
);

/** Each detector's settings, a stereo extractor at 48 kHz. */
const DETECTORS: readonly DetectorSettings[] = [
  { kind: DetectorKind.Clicks, channels: 2, sampleRate: RATE, block: 512, sensitivity: 4 },
  {
    kind: DetectorKind.Hum,
    channels: 2,
    sampleRate: RATE,
    size: 2_048,
    hop: 1_024,
    searchWidth: 5,
    floorWidth: 40,
  },
  {
    kind: DetectorKind.NoiseFloor,
    channels: 2,
    sampleRate: RATE,
    frame: 480,
    hop: 240,
    percentile: 0.1,
    history: 50,
  },
  {
    kind: DetectorKind.Clipping,
    channels: 2,
    sampleRate: RATE,
    block: 480,
    epsilon: 0,
    minimumRun: 2,
  },
  { kind: DetectorKind.DcOffset, channels: 2, sampleRate: RATE, window: 480, hop: 240 },
  {
    kind: DetectorKind.Transients,
    channels: 2,
    sampleRate: RATE,
    size: 512,
    hop: 256,
    history: 16,
    multiplier: 1.5,
    offset: 0.01,
  },
  { kind: DetectorKind.Silence, channels: 2, sampleRate: RATE, block: 480, threshold: 0.01 },
];

/**
 * Whether a path's STFT is measured pulling polar frames as well as complex
 * ones. The reference path's phases come from the canonical arctangent,
 * which answers a number from a chain of calls too large for V8 to inline
 * reliably, so a polar pull there boxes a phase a bin whenever it does not;
 * a spectral kernel reads complex frames, which are measured on both paths.
 */
describe.each([
  ['the WebAssembly path', (): CanonicalDsp => wasm, true],
  ['the reference path', (): CanonicalDsp => REFERENCE_DSP, false],
])('%s allocates nothing per call', (_name, dspOf, pullsPolar) => {
  it('pushing to an STFT and pulling its frames', () => {
    const stft = expectSuccess(
      dspOf().createStft({ channels: 2, size: 256, hop: 128, window: StftWindow.Hann }),
    );
    const first = new Float64Array(2 * stft.bins);
    const second = new Float64Array(2 * stft.bins);
    let frames = 0;

    const allocated = warmedAllocation(() => {
      stft.push(INPUT);
      // Polar and complex alternately where both are measured.
      const polar = pullsPolar && frames % 2 === 0;
      while (polar ? stft.pullPolar(first, second) : stft.pullComplex(first, second)) {
        frames += 1;
      }
    });

    stft.release();
    expect(frames).toBeGreaterThan(QUANTA);
    expect(allocated).toBeLessThan(QUANTA);
  });

  it('metering peaks', () => {
    const meter = expectSuccess(dspOf().createPeakMeter({ channels: 2, sampleRate: RATE }));
    const reading = new Float64Array(8);

    const allocated = warmedAllocation(() => {
      meter.push(INPUT);
      meter.read(reading);
    });

    meter.release();
    expect(reading[0]).toBeGreaterThan(0.49);
    expect(allocated).toBeLessThan(QUANTA);
  });

  it('metering loudness and pulling its series', () => {
    const meter = expectSuccess(
      dspOf().createLoudnessMeter({ sampleRate: RATE, layout: StandardLayouts.stereo }),
    );
    const series = new Float64Array(8);
    let pairs = 0;

    const allocated = warmedAllocation(() => {
      meter.push(INPUT);
      pairs += meter.pullSeries(series);
    });

    meter.release();
    expect(pairs).toBeGreaterThan(0);
    expect(allocated).toBeLessThan(QUANTA);
  });

  it.each(DETECTORS)('extracting $kind features', (settings) => {
    const features = expectSuccess(dspOf().createDetectorFeatures(settings));
    const records = new Float64Array(4 * features.recordWidth);

    const allocated = warmedAllocation(() => {
      features.push(INPUT);
      while (features.pull(records) > 0);
    });

    features.release();
    expect(allocated).toBeLessThan(QUANTA);
  });
});
