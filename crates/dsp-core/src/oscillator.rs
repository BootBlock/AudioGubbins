//! A deterministic sine oscillator.
//!
//! The source of the engine's test tone and of every generated reference
//! signal the golden renders are built from.
//!
//! Its phase is a 64-bit fixed-point number of turns: `p / 2⁶⁴`. Frame `n`'s
//! phase is `(start + n · increment) mod 2⁶⁴`, exact integer arithmetic, so
//! the oscillator can [seek](SineOscillator::seek) to any frame at once and
//! write there the bits a run from frame zero writes, and it never drifts
//! however long it runs. The increment is `frequency / rate` in the same
//! units, rounded once to the nearest; the frequency it sounds is within
//! `rate / 2⁶⁵` hertz of the one asked for.
//!
//! Each sample is `amplitude · sin(2π · p / 2⁶⁴)`, where `p / 2⁶⁴` is `p`
//! rounded to the nearest `f64`, ties to even, and scaled by 2⁻⁶⁴ exactly.
//! The TypeScript reference path holds `p` as two 32-bit halves and forms
//! `hi · 2⁻³² + lo · 2⁻⁶⁴`, one correctly rounded addition of two exact
//! values, which is the same number (ADR-0032).

use crate::turns::sine_of_turns;

/// `2⁻⁶⁴`: one unit of the phase, in turns.
const TURNS_PER_UNIT: f64 = 1.0 / 18_446_744_073_709_551_616.0;

/// `2⁶⁴`, to scale a fraction of a turn to units.
const UNITS_PER_TURN: f64 = 18_446_744_073_709_551_616.0;

/// A sine oscillator of fixed frequency and amplitude.
#[derive(Debug, Clone)]
pub struct SineOscillator {
    /// Where frame zero is, in units of 2⁻⁶⁴ turn.
    start: u64,
    /// Where the next sample is, in units of 2⁻⁶⁴ turn.
    phase: u64,
    /// Units advanced per sample.
    increment: u64,
    amplitude: f64,
}

/// Why an oscillator cannot be made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OscillatorError {
    /// The frequency is not above zero and at or below half the sample rate.
    FrequencyOutOfRange,
    /// The sample rate is zero.
    SampleRateZero,
    /// The amplitude or starting phase is not finite.
    NotFinite,
}

impl SineOscillator {
    /// An oscillator at `frequency` hertz for `sample_rate`, starting at
    /// `start_phase` turns, with a peak of `amplitude`.
    ///
    /// # Errors
    ///
    /// Refuses a frequency that is not in `(0, sample_rate / 2]`, because a
    /// tone above the Nyquist frequency is an alias of another, and refuses a
    /// value that is not finite.
    pub fn new(
        frequency: f64,
        sample_rate: u32,
        start_phase: f64,
        amplitude: f64,
    ) -> Result<Self, OscillatorError> {
        if sample_rate == 0 {
            return Err(OscillatorError::SampleRateZero);
        }
        if !start_phase.is_finite() || !amplitude.is_finite() {
            return Err(OscillatorError::NotFinite);
        }
        let rate = f64::from(sample_rate);
        if !(frequency > 0.0 && frequency <= rate / 2.0) {
            return Err(OscillatorError::FrequencyOutOfRange);
        }
        let fraction = start_phase - start_phase.floor();
        // Below 2⁶⁴, since the fraction is below one; the cast floors it.
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a whole number from 0 to below 2^64 once floored"
        )]
        let start = (fraction * UNITS_PER_TURN) as u64;
        Ok(Self {
            start,
            phase: start,
            increment: increment_of(frequency, sample_rate),
            amplitude,
        })
    }

    /// Moves to frame `frame`, counted from the frame the oscillator started at,
    /// so the next sample written is that frame's.
    pub fn seek(&mut self, frame: u64) {
        self.phase = self.start.wrapping_add(frame.wrapping_mul(self.increment));
    }

    /// Writes the next `output.len()` samples.
    pub fn render(&mut self, output: &mut [f32]) {
        for sample in output {
            // Rounded once, from the f64 product, to the f32 the engine carries.
            #[allow(
                clippy::cast_possible_truncation,
                reason = "rounding to the working precision is the intent"
            )]
            #[allow(
                clippy::cast_precision_loss,
                reason = "rounding the phase to the nearest f64 is the definition"
            )]
            let turns = self.phase as f64 * TURNS_PER_UNIT;
            #[allow(
                clippy::cast_possible_truncation,
                reason = "rounding to the working precision is the intent"
            )]
            let value = (self.amplitude * sine_of_turns(turns)) as f32;
            *sample = value;
            self.phase = self.phase.wrapping_add(self.increment);
        }
    }
}

/// `frequency / rate` in units of 2⁻⁶⁴ turn, rounded to the nearest, a half up.
///
/// The frequency is `m · 2ᵉ` exactly, with `m` its 53-bit significand, so the
/// increment is `m · 2^(e + 64) / rate`, a ratio of integers divided exactly
/// in 128 bits. A frequency at most half the rate gives at most 2⁶³.
fn increment_of(frequency: f64, rate: u32) -> u64 {
    let bits = frequency.to_bits();
    let biased = (bits >> 52) & 0x7ff;
    let fraction = bits & ((1 << 52) - 1);
    // A subnormal has no implicit bit and the least exponent.
    let (significand, exponent) = if biased == 0 {
        (fraction, -1074_i64)
    } else {
        #[allow(clippy::cast_possible_wrap, reason = "an 11-bit field")]
        let unbiased = biased as i64 - 1075;
        (fraction | (1 << 52), unbiased)
    };
    let shift = exponent + 64;
    let (numerator, denominator) = if shift >= 0 {
        // At most 43 for a frequency below 2³¹: m · 2⁴³ is below 2⁹⁶.
        (u128::from(significand) << shift, u128::from(rate))
    } else if shift >= -96 {
        (u128::from(significand), u128::from(rate) << -shift)
    } else {
        // Below 2⁵³ / 2⁹⁶ of a unit: nearest is zero.
        return 0;
    };
    let quotient = numerator / denominator;
    let remainder = numerator % denominator;
    let rounded = if remainder >= denominator - remainder {
        quotient + 1
    } else {
        quotient
    };
    // At most 2⁶³ for a frequency the constructor accepts.
    u64::try_from(rounded).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{OscillatorError, SineOscillator, increment_of};
    use crate::fingerprint;

    #[test]
    fn refuses_a_tone_above_nyquist_and_a_rate_of_zero() {
        assert_eq!(
            SineOscillator::new(24_001.0, 48_000, 0.0, 1.0).unwrap_err(),
            OscillatorError::FrequencyOutOfRange
        );
        assert_eq!(
            SineOscillator::new(0.0, 48_000, 0.0, 1.0).unwrap_err(),
            OscillatorError::FrequencyOutOfRange
        );
        assert_eq!(
            SineOscillator::new(440.0, 0, 0.0, 1.0).unwrap_err(),
            OscillatorError::SampleRateZero
        );
        assert_eq!(
            SineOscillator::new(440.0, 48_000, f64::NAN, 1.0).unwrap_err(),
            OscillatorError::NotFinite
        );
    }

    #[test]
    fn renders_the_same_samples_whatever_the_block_size() {
        let mut whole = vec![0.0_f32; 4_800];
        SineOscillator::new(440.0, 48_000, 0.0, 0.5)
            .expect("valid")
            .render(&mut whole);

        let mut pieces = vec![0.0_f32; 4_800];
        let mut oscillator = SineOscillator::new(440.0, 48_000, 0.0, 0.5).expect("valid");
        for chunk in pieces.chunks_mut(128) {
            oscillator.render(chunk);
        }
        assert_eq!(whole, pieces);
    }

    #[test]
    fn peaks_at_its_amplitude_and_crosses_zero_at_the_period() {
        let mut samples = vec![0.0_f32; 48];
        SineOscillator::new(1_000.0, 48_000, 0.0, 1.0)
            .expect("valid")
            .render(&mut samples);
        assert!((samples[12] - 1.0).abs() < 1.0e-6);
        assert!(samples[24].abs() < 1.0e-6);
    }

    #[test]
    fn writes_from_a_frame_it_seeks_to_the_bits_a_run_from_zero_writes() {
        let mut whole = vec![0.0_f32; 10_000];
        SineOscillator::new(997.0, 44_100, 0.25, 0.5)
            .expect("valid")
            .render(&mut whole);
        let mut oscillator = SineOscillator::new(997.0, 44_100, 0.25, 0.5).expect("valid");
        for frame in [7_321_u64, 5, 9_000, 0] {
            let mut part = vec![0.0_f32; 1_000];
            oscillator.seek(frame);
            oscillator.render(&mut part);
            let from = usize::try_from(frame).expect("small");
            assert_eq!(part, whole[from..from + 1_000]);
        }
    }

    #[test]
    fn advances_by_the_frequency_over_the_rate_in_units_of_a_turn() {
        // round(f / rate · 2⁶⁴), from exact rational arithmetic.
        assert_eq!(increment_of(440.0, 48_000), 169_095_154_009_004_223);
        assert_eq!(increment_of(997.0, 44_100), 417_038_635_861_415_487);
        assert_eq!(increment_of(24_000.0, 48_000), 1 << 63);
        assert_eq!(increment_of(0.1, 48_000), 38_430_716_820_228);
    }

    #[test]
    fn gives_the_golden_render_the_reference_path_is_held_to() {
        let mut samples = vec![0.0_f32; 4_800];
        SineOscillator::new(440.0, 48_000, 0.0, 0.5)
            .expect("valid")
            .render(&mut samples);
        assert_eq!(
            fingerprint::of_samples(&samples),
            GOLDEN_TONE,
            "{:#x}",
            fingerprint::of_samples(&samples)
        );
    }

    #[test]
    fn gives_the_golden_render_a_trillion_frames_in() {
        // Far enough in that a phase computed with any rounding would be
        // audibly off: the exact phase is what both paths are held to.
        let mut samples = vec![0.0_f32; 4_800];
        let mut oscillator = SineOscillator::new(440.0, 48_000, 0.0, 0.5).expect("valid");
        oscillator.seek(1_000_000_000_000);
        oscillator.render(&mut samples);
        let hash = fingerprint::of_samples(&samples);
        assert_eq!(hash, GOLDEN_TONE_FAR, "{hash:#x}");
    }

    /// The same tone, 4 800 frames from frame 10¹². Computed by this crate,
    /// the WebAssembly module and the TypeScript reference path, which agreed
    /// on every bit.
    const GOLDEN_TONE_FAR: u64 = 0x6c15_de3e_30ae_6635;

    /// The 440 Hz tone at half scale, 4 800 frames at 48 kHz.
    ///
    /// Changed from `0x46fc_8a68_33be_7402` when the phase became a 64-bit
    /// fixed-point count of turns, so any frame's phase is exact and the
    /// oscillator can seek to it at once (REQ-EXEC-180). The new value was
    /// computed by this crate, the WebAssembly module and the TypeScript
    /// reference path, which agreed on every bit.
    const GOLDEN_TONE: u64 = 0xc92e_d51c_a646_7571;
}
