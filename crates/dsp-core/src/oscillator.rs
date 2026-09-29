//! A deterministic sine oscillator.
//!
//! The source of the engine's test tone and of every generated reference
//! signal the golden renders are built from. Its phase is held in turns, so it
//! wraps by an exact subtraction and never drifts with the length of the run.

use crate::turns::sine_of_turns;

/// A sine oscillator of fixed frequency and amplitude.
#[derive(Debug, Clone)]
pub struct SineOscillator {
    /// Where the next sample is, in turns, in `[0, 1)`.
    phase: f64,
    /// Turns advanced per sample: the frequency over the sample rate.
    increment: f64,
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
        Ok(Self {
            phase: start_phase - start_phase.floor(),
            increment: frequency / rate,
            amplitude,
        })
    }

    /// Writes the next `output.len()` samples.
    pub fn render(&mut self, output: &mut [f32]) {
        for sample in output {
            // Rounded once, from the f64 product, to the f32 the engine carries.
            #[allow(
                clippy::cast_possible_truncation,
                reason = "rounding to the working precision is the intent"
            )]
            let value = (self.amplitude * sine_of_turns(self.phase)) as f32;
            *sample = value;
            self.phase += self.increment;
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{OscillatorError, SineOscillator};
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

    /// The 440 Hz tone at half scale, 4 800 frames at 48 kHz.
    const GOLDEN_TONE: u64 = 0x46fc_8a68_33be_7402;
}
