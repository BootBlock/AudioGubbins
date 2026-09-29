//! The interpolation filter: its coefficients for each fractional position.

use std::f64::consts::PI;

use audiogubbins_dsp_core::{bessel_i0, kaiser, sine_of_turns};

use crate::quality::ResamplingQuality;

/// How many coefficients the kernel keeps in a table before it computes each
/// phase as it is needed instead: a mebi-coefficient, eight mebibytes.
///
/// Both ways give the same bits, because the table holds what the function
/// computes; the table only saves the work. Conversion between two rates that
/// share little, 44 099 Hz to 48 000 Hz, has 48 000 phases, whose table would
/// be large, so it is computed as it goes.
const TABLE_LIMIT: usize = 1 << 20;

/// The filter for one conversion.
#[derive(Debug, Clone)]
pub struct Kernel {
    /// Output samples per `input_step` input samples: the rates reduced by their
    /// greatest common divisor.
    output_step: u32,
    input_step: u32,
    /// Taps each side of the centre, `K`, so each output reads `2K + 1` inputs.
    half: u32,
    half_width: f64,
    cutoff: f64,
    beta: f64,
    bessel_of_beta: f64,
    table: Option<Vec<f64>>,
}

impl Kernel {
    /// The filter converting by `output_step / input_step` at `quality`.
    ///
    /// The cutoff is the lower of the two Nyquist frequencies times the
    /// quality's rolloff, in units of the input's, and the filter widens by
    /// the same factor when it narrows, so its zero crossings stay the
    /// quality's number.
    ///
    /// Between equal rates the kernel is a single tap of one, so the
    /// conversion copies its input exactly: REQ-ARCH-085 forbids filtering
    /// audio that needs no conversion.
    #[must_use]
    pub fn new(output_step: u32, input_step: u32, quality: ResamplingQuality) -> Self {
        if output_step == input_step {
            return Self {
                output_step,
                input_step,
                half: 0,
                half_width: 1.0,
                cutoff: 1.0,
                beta: 0.0,
                bessel_of_beta: 1.0,
                table: Some(vec![1.0; output_step as usize]),
            };
        }
        let ratio = f64::from(output_step) / f64::from(input_step);
        let cutoff = (if ratio < 1.0 { ratio } else { 1.0 }) * quality.rolloff();
        let half_width = f64::from(quality.zero_crossings()) / cutoff;
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "half_width is positive and far below u32::MAX for any rate pair"
        )]
        let half = half_width.ceil() as u32;
        let beta = quality.beta();
        let mut kernel = Self {
            output_step,
            input_step,
            half,
            half_width,
            cutoff,
            beta,
            bessel_of_beta: bessel_i0(beta),
            table: None,
        };
        let size = kernel.taps() * output_step as usize;
        if size <= TABLE_LIMIT {
            let mut table = vec![0.0; size];
            for (phase, taps) in (0..output_step).zip(table.chunks_mut(kernel.taps())) {
                kernel.fill_phase(phase, taps);
            }
            kernel.table = Some(table);
        }
        kernel
    }

    /// Output samples per [`Self::input_step`] input samples.
    #[must_use]
    pub fn output_step(&self) -> u32 {
        self.output_step
    }

    /// Input samples per [`Self::output_step`] output samples.
    #[must_use]
    pub fn input_step(&self) -> u32 {
        self.input_step
    }

    /// Taps each side of the centre: the input frames the filter looks ahead.
    #[must_use]
    pub fn half(&self) -> u32 {
        self.half
    }

    /// Coefficients per output sample.
    #[must_use]
    pub fn taps(&self) -> usize {
        2 * self.half as usize + 1
    }

    /// The raw filter at `n + phase / output_step` input samples from centre.
    fn coefficient(&self, n: i64, phase: u32) -> f64 {
        #[allow(
            clippy::cast_precision_loss,
            reason = "both operands are far below 2^53"
        )]
        let t = (n * i64::from(self.output_step) + i64::from(phase)) as f64
            / f64::from(self.output_step);
        if t.abs() >= self.half_width {
            return 0.0;
        }
        let x = self.cutoff * t;
        let sinc = if x == 0.0 {
            1.0
        } else {
            sine_of_turns(x / 2.0) / (PI * x)
        };
        let window = kaiser(t / self.half_width, self.beta, self.bessel_of_beta);
        self.cutoff * sinc * window
    }

    /// Writes the taps of `phase`, for `n` from `-K` to `K`, scaled so they
    /// sum to one, so a constant input passes at unity gain at every phase.
    fn fill_phase(&self, phase: u32, taps: &mut [f64]) {
        let half = i64::from(self.half);
        let mut sum = 0.0;
        for (tap, n) in taps.iter_mut().zip(-half..=half) {
            *tap = self.coefficient(n, phase);
            sum += *tap;
        }
        for tap in taps.iter_mut() {
            *tap /= sum;
        }
    }

    /// The taps of `phase`, from the table or computed into `scratch`.
    pub(crate) fn phase_taps<'a>(&'a self, phase: u32, scratch: &'a mut [f64]) -> &'a [f64] {
        let taps = self.taps();
        if let Some(table) = &self.table {
            let start = phase as usize * taps;
            return &table[start..start + taps];
        }
        self.fill_phase(phase, scratch);
        scratch
    }
}

#[cfg(test)]
mod tests {
    use super::Kernel;
    use crate::quality::ResamplingQuality;

    #[test]
    fn sums_each_phase_to_one() {
        let kernel = Kernel::new(160, 147, ResamplingQuality::High);
        let mut scratch = vec![0.0; kernel.taps()];
        for phase in [0, 1, 80, 159] {
            let sum: f64 = kernel.phase_taps(phase, &mut scratch).iter().sum();
            assert!((sum - 1.0).abs() < 1.0e-12);
        }
    }

    #[test]
    fn is_one_unit_tap_between_equal_rates() {
        let kernel = Kernel::new(1, 1, ResamplingQuality::Maximum);
        let mut scratch = vec![0.0; kernel.taps()];
        assert_eq!(kernel.phase_taps(0, &mut scratch), &[1.0]);
        assert_eq!(kernel.half(), 0);
    }

    #[test]
    fn computes_the_same_taps_with_or_without_its_table() {
        let tabled = Kernel::new(3, 2, ResamplingQuality::Draft);
        let mut untabled = tabled.clone();
        untabled.table = None;
        let mut first = vec![0.0; tabled.taps()];
        let mut second = vec![0.0; tabled.taps()];
        for phase in 0..3 {
            let a = tabled.phase_taps(phase, &mut first).to_vec();
            let b = untabled.phase_taps(phase, &mut second).to_vec();
            assert_eq!(a, b);
        }
    }

    #[test]
    fn widens_when_the_rate_falls() {
        let up = Kernel::new(2, 1, ResamplingQuality::Draft);
        let down = Kernel::new(1, 2, ResamplingQuality::Draft);
        assert!(down.half() > up.half());
    }
}
