/**
 * How the engine's numbers are written, in the Transport panel and in what the
 * audio part says: times, latencies, levels and fingerprints. At the root of
 * the application, below both, so the two write each number alike.
 *
 * Latency is written twice, in milliseconds for a person and in frames for an
 * engineer, since each reads the other as noise when it is the only one
 * given. The formatters are made once, at module scope, and every number is
 * written in British English whatever the browser's own locale.
 */

import { DspImplementation } from '@audiogubbins/audio-engine';

const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const TENTHS = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A count of frames, grouped as a person reads it: `480,000`. */
export function framesText(frames: number): string {
  return WHOLE.format(frames);
}

/** A latency given in frames at `sampleRate`: `10.7 ms (512 frames)`. */
export function latencyFramesText(frames: number, sampleRate: number): string {
  return `${TENTHS.format((frames * 1000) / sampleRate)} ms (${framesText(frames)} frames)`;
}

/**
 * A latency the browser gives in seconds, with the frames it stands for at
 * `sampleRate`, rounded to the nearest, as the browser measured it in frames.
 */
export function latencySecondsText(seconds: number, sampleRate: number): string {
  return latencyFramesText(Math.round(seconds * sampleRate), sampleRate);
}

/** A span of time in seconds: `0.8 s`. */
export function durationText(milliseconds: number): string {
  return `${TENTHS.format(milliseconds / 1000)} s`;
}

/** A peak in decibels below full scale, `−12.0 dB`, or `−∞ dB` for silence. */
export function peakText(peak: number): string {
  if (peak <= 0) return '−∞ dB';
  // The typographic minus, which a screen reader says as "minus" rather than
  // reading a hyphen as a dash.
  return `${TENTHS.format(20 * Math.log10(peak)).replace('-', '−')} dB`;
}

const HUNDREDTHS = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});

/**
 * A phase correlation, signed, to two places: `+0.98`, `0.00`, `−1.00`, with
 * the typographic minus, which a screen reader says as "minus".
 */
export function correlationText(correlation: number): string {
  return HUNDREDTHS.format(correlation).replace('-', '−');
}

/** Where a peak sits on a meter's scale, for its colour. */
export const MeterZone = {
  Low: 'low',
  Mid: 'mid',
  High: 'high',
  Clip: 'clip',
} as const;

/** Where a peak sits on a meter's scale. */
export type MeterZone = (typeof MeterZone)[keyof typeof MeterZone];

/** The linear peaks at −18 dB and −6 dB, where a meter turns amber and then red. */
const MID_FROM = 10 ** (-18 / 20);
const HIGH_FROM = 10 ** (-6 / 20);

export function meterZone(peak: number): MeterZone {
  if (peak >= 1) return MeterZone.Clip;
  if (peak >= HIGH_FROM) return MeterZone.High;
  return peak >= MID_FROM ? MeterZone.Mid : MeterZone.Low;
}

/** A fingerprint as the golden tests print it: `0x` and sixteen hexadecimal digits. */
export function fingerprintText(fingerprint: bigint): string {
  return `0x${fingerprint.toString(16).padStart(16, '0')}`;
}

/** Which canonical DSP ran, in a person's words. */
export function dspText(dsp: DspImplementation): string {
  return dsp === DspImplementation.WebAssembly ? 'WebAssembly module' : 'Reference path';
}
