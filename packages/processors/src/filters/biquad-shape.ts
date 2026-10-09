/**
 * What a second-order section is designed as: its shape, the settings it is
 * designed from, and the highest frequency the cookbook places one at. Apart
 * from the designs, so the cookbook's and the magnitude fit's share them.
 */

/** The shapes a section can take, each a design of the cookbook. */
export const BiquadShape = {
  Peaking: 'peaking',
  LowShelf: 'low-shelf',
  HighShelf: 'high-shelf',
  LowPass: 'low-pass',
  HighPass: 'high-pass',
  BandPass: 'band-pass',
  Notch: 'notch',
  AllPass: 'all-pass',
} as const;

/** A shape a section can take. */
export type BiquadShape = (typeof BiquadShape)[keyof typeof BiquadShape];

/** Where each of a section's settings is in a cascade's settings. */
export const SectionSetting = { Frequency: 0, Gain: 1, Q: 2 } as const;

/**
 * The highest frequency, as a fraction of the rate, the cookbook's design
 * takes part in a section's at. At half the rate the sine of the angle is
 * zero, so `α` is zero and the poles of a low-pass reach the unit circle, and
 * above it a frequency has no place in the spectrum. Above this fraction a
 * section is fitted to its analogue prototype's magnitude alone
 * (`magnitude-fit.ts`).
 */
export const HIGHEST_DESIGN_FRACTION = 0.49;

/**
 * Where the hand-over from the cookbook's designs to the fitted ones starts,
 * as a fraction of the rate: from here to {@link HIGHEST_DESIGN_FRACTION} a
 * section's coefficients move from the cookbook's design to the fitted one in
 * proportion to its frequency, so the design is continuous in its frequency.
 * A hard switch at 0.49 of the rate, from the cookbook's design, cramped
 * towards half the rate, to the analogue magnitude's, moved a response by up
 * to 40 dB at once.
 */
export const HANDOVER_START = 0.45;

/**
 * Writes to `into[at]` the fitted design's share of a section at the
 * frequency in `settings` at `rate`: none to {@link HANDOVER_START} of the
 * rate, all of it from {@link HIGHEST_DESIGN_FRACTION} on, and in proportion
 * to the frequency between.
 */
export function prototypeShare(
  rate: number,
  settings: Float64Array,
  into: Float64Array,
  at: number,
): void {
  const fraction = (settings[SectionSetting.Frequency] ?? 0) / rate;
  const share = (fraction - HANDOVER_START) / (HIGHEST_DESIGN_FRACTION - HANDOVER_START);
  into[at] = Math.min(1, Math.max(0, share));
}
