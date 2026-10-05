/**
 * The checks both implementations of the port make before they build a
 * measuring object, and before they take a call, so they refuse the same
 * settings with the same failure and the same calls with the same fault.
 * Each range is the one `crates/analysis` states and refuses.
 */

import { failure, FailureKind, fail, succeed, type DomainResult } from '@audiogubbins/domain';

import {
  DetectorKind,
  type DetectorSettings,
  type HumSettings,
  type LoudnessMeterSettings,
  type PeakMeterSettings,
  type StftSettings,
} from './canonical-analysis.js';
import { LARGEST_FFT_SIZE, SMALLEST_FFT_SIZE } from './canonical-dsp.js';

/** The most channels a measuring object takes: `MOST_CHANNELS` in the crate. */
const MOST_CHANNELS = 256;

/** The most samples a detector's frame, block or window holds: 2²⁰. */
const MOST_FRAME_SAMPLES = 1_048_576;

/** The most frames a detector's history holds. */
const MOST_HISTORY_FRAMES = 65_536;

/** The fewest samples a click block holds: four times the predictor's order of 16. */
const SMALLEST_CLICK_BLOCK = 64;

/** The smallest STFT the hum search takes. */
const SMALLEST_HUM_SIZE = 16;

/** Whether `value` is a whole number from `low` to `high`. */
function wholeWithin(value: number, low: number, high: number): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}

/** Whether `value` is finite and at least zero. */
function finiteAtLeastZero(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Whether `size` is a power of two an FFT takes. */
function isFftSize(size: number): boolean {
  // A power of two from 2 has a single bit set, and so shares none with one less.
  return wholeWithin(size, SMALLEST_FFT_SIZE, LARGEST_FFT_SIZE) && (size & (size - 1)) === 0;
}

/** The refusal of `what`'s settings, naming `reason`. */
function refused(code: string, what: string, reason: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, `${what} ${reason}.`));
}

/** The channel count, or why it is not one a measuring object takes. */
function channelsRefusal(channels: number, code: string, what: string): DomainResult<never> | null {
  return wholeWithin(channels, 1, MOST_CHANNELS)
    ? null
    : refused(code, what, `needs a whole number of channels from 1 to ${String(MOST_CHANNELS)}`);
}

/** The settings, or why a short-time Fourier transform cannot be made from them. */
export function checkStft(settings: StftSettings): DomainResult<StftSettings> {
  const code = 'dsp.stft-settings-invalid';
  const what = 'A short-time Fourier transform';
  const { channels, size, hop } = settings;
  const channelsWrong = channelsRefusal(channels, code, what);
  if (channelsWrong !== null) return channelsWrong;
  if (!isFftSize(size) || !wholeWithin(hop, 1, size)) {
    return refused(
      code,
      what,
      `takes frames of a power of two from ${String(SMALLEST_FFT_SIZE)} to ${String(LARGEST_FFT_SIZE)} samples, a hop of 1 to that many apart`,
    );
  }
  return succeed(settings);
}

/** The settings, or why a peak meter cannot be made from them. */
export function checkPeakMeter(settings: PeakMeterSettings): DomainResult<PeakMeterSettings> {
  return (
    channelsRefusal(settings.channels, 'dsp.peak-meter-settings-invalid', 'A peak meter') ??
    succeed(settings)
  );
}

/** The settings, or why a loudness meter cannot be made from them. */
export function checkLoudnessMeter(
  settings: LoudnessMeterSettings,
): DomainResult<LoudnessMeterSettings> {
  return (
    channelsRefusal(
      settings.layout.roles.length,
      'dsp.loudness-meter-settings-invalid',
      'A loudness meter',
    ) ?? succeed(settings)
  );
}

/** Why a hum detector's settings are out of range, or `null` where none is. */
function humReason(settings: HumSettings): string | null {
  if (!isFftSize(settings.size) || settings.size < SMALLEST_HUM_SIZE) {
    return 'takes an STFT of a power of two from 16 to 65 536 samples';
  }
  if (!wholeWithin(settings.hop, 1, settings.size)) return 'takes a hop of 1 to its size';
  if (!(Number.isFinite(settings.searchWidth) && settings.searchWidth > 0)) {
    return 'takes a search width above zero';
  }
  if (!(Number.isFinite(settings.floorWidth) && settings.floorWidth > settings.searchWidth)) {
    return 'takes a floor width wider than its search width';
  }
  return 2 * (120 + settings.floorWidth) >= settings.sampleRate
    ? 'needs a sample rate above twice 120 Hz and its floor width'
    : null;
}

/** Why a detector's settings, past its channels, are out of range, or `null` where none is. */
function detectorReason(settings: DetectorSettings): string | null {
  switch (settings.kind) {
    case DetectorKind.Clicks:
      return wholeWithin(settings.block, SMALLEST_CLICK_BLOCK, MOST_FRAME_SAMPLES) &&
        Number.isFinite(settings.sensitivity) &&
        settings.sensitivity > 0
        ? null
        : 'takes blocks of 64 to 1 048 576 samples and a sensitivity above zero';
    case DetectorKind.Hum:
      return humReason(settings);
    case DetectorKind.NoiseFloor:
      return wholeWithin(settings.frame, 1, MOST_FRAME_SAMPLES) &&
        wholeWithin(settings.hop, 1, settings.frame) &&
        wholeWithin(settings.history, 1, MOST_HISTORY_FRAMES) &&
        settings.percentile >= 0 &&
        settings.percentile <= 1
        ? null
        : 'takes frames of 1 to 1 048 576 samples, a hop of 1 to that, a percentile from 0 to 1 and a history of 1 to 65 536 frames';
    case DetectorKind.Clipping:
      return wholeWithin(settings.block, 1, MOST_FRAME_SAMPLES) &&
        wholeWithin(settings.minimumRun, 1, settings.block) &&
        finiteAtLeastZero(settings.epsilon)
        ? null
        : 'takes blocks of 1 to 1 048 576 samples, a shortest run of 1 to that, and an epsilon of zero or more';
    case DetectorKind.DcOffset:
      return wholeWithin(settings.window, 1, MOST_FRAME_SAMPLES) &&
        wholeWithin(settings.hop, 1, settings.window)
        ? null
        : 'takes windows of 1 to 1 048 576 samples, a hop of 1 to that';
    case DetectorKind.Transients:
      return isFftSize(settings.size) &&
        wholeWithin(settings.hop, 1, settings.size) &&
        wholeWithin(settings.history, 1, MOST_HISTORY_FRAMES) &&
        finiteAtLeastZero(settings.multiplier) &&
        finiteAtLeastZero(settings.offset)
        ? null
        : 'takes an STFT of a power of two from 2 to 65 536 samples, a hop of 1 to that, a history of 1 to 65 536 frames, and a multiplier and offset of zero or more';
  }
}

/** The settings, or why a detector's feature extractor cannot be made from them. */
export function checkDetector(settings: DetectorSettings): DomainResult<DetectorSettings> {
  const code = 'dsp.detector-settings-invalid';
  const what = `A ${settings.kind} detector`;
  const channelsWrong = channelsRefusal(settings.channels, code, what);
  if (channelsWrong !== null) return channelsWrong;
  const reason = detectorReason(settings);
  return reason === null ? succeed(settings) : refused(code, what, reason);
}

/** Each kind's code in the ABI: `DetectorKind::from_code` in `detectors/mod.rs`. */
export const DETECTOR_CODES: Readonly<Record<DetectorKind, number>> = {
  [DetectorKind.Clicks]: 0,
  [DetectorKind.Hum]: 1,
  [DetectorKind.NoiseFloor]: 2,
  [DetectorKind.Clipping]: 3,
  [DetectorKind.DcOffset]: 4,
  [DetectorKind.Transients]: 5,
};

/** A detector's settings as the values the ABI carries, in `DetectorSettings::from_values` order. */
export function detectorValues(settings: DetectorSettings): readonly number[] {
  switch (settings.kind) {
    case DetectorKind.Clicks:
      return [settings.block, settings.sensitivity];
    case DetectorKind.Hum:
      return [settings.size, settings.hop, settings.searchWidth, settings.floorWidth];
    case DetectorKind.NoiseFloor:
      return [settings.frame, settings.hop, settings.percentile, settings.history];
    case DetectorKind.Clipping:
      return [settings.block, settings.epsilon, settings.minimumRun];
    case DetectorKind.DcOffset:
      return [settings.window, settings.hop];
    case DetectorKind.Transients:
      return [settings.size, settings.hop, settings.history, settings.multiplier, settings.offset];
  }
}

/**
 * The frames in `input`, one array per channel of an object of `channels`,
 * or a throw where it is not that shape. `what` names the object.
 */
export function framesOf(input: readonly Float32Array[], channels: number, what: string): number {
  const frames = input[0]?.length ?? 0;
  if (input.length !== channels) {
    throw new Error(
      `${what} of ${String(channels)} channels was given ${String(input.length)} arrays.`,
    );
  }
  // Indexed rather than `some`, whose callback would be an object a call.
  for (let index = 1; index < input.length; index += 1) {
    if (input[index]?.length !== frames) {
      throw new Error(`${what} was given channel arrays of different lengths.`);
    }
  }
  return frames;
}

/** What a short-time Fourier transform's outputs are called in the fault for one of the wrong length. */
export const STFT_OUTPUTS = {
  real: 'A short-time Fourier transform’s real parts',
  imaginary: 'A short-time Fourier transform’s imaginary parts',
  magnitudes: 'A short-time Fourier transform’s magnitudes',
  phases: 'A short-time Fourier transform’s phases',
} as const;

/** Throws unless `array` holds exactly `length` values: `what` names the object and the array. */
export function assertLength(array: Float64Array, length: number, what: string): void {
  if (array.length !== length) {
    throw new Error(
      `${what} takes ${String(length)} values, and was given ${String(array.length)}.`,
    );
  }
}
