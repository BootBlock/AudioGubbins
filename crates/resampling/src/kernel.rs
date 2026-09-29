//! The interpolation filter: its coefficients for each fractional position.

use std::f64::consts::PI;

use audiogubbins_dsp_core::{bessel_i0, kaiser, sine_of_turns};

use crate::error::ResamplerError;
use crate::quality::ResamplingQuality;

/// The shape of one conversion's filter: what every coefficient is computed
/// from.
#[derive(Debug, Clone)]
struct Design {
    output_step: u32,
    /// Taps each side of the centre, `K`, so each output reads `2K + 1` inputs.
    half: u32,
    half_width: f64,
    cutoff: f64,
    beta: f64,
    bessel_of_beta: f64,
}

impl Design {
    fn taps(&self) -> usize {
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
}

/// The filter for one conversion, with a table of its coefficients that each
/// phase fills the first time it is used and keeps.
///
/// Every rate pair has the table, however many phases it has, so no
/// conversion recomputes a Bessel series and a sine per tap per output sample
/// (REQ-ARCH-087 forbids a slow path behind an arbitrary size). The table is
/// allocated when the kernel is made, so a conversion whose table does not fit
/// in memory is refused there, with [`ResamplerError::OutOfMemory`], rather
/// than failing part way through. A phase's taps are the same bits whenever
/// they are computed, so filling on first use changes no output.
#[derive(Debug, Clone)]
pub struct Kernel {
    design: Design,
    /// Input samples per `output_step` output samples: the rates reduced by
    /// their greatest common divisor.
    input_step: u32,
    /// Phase `p`'s taps, from `p · taps()`, once `filled[p]` is set.
    table: Vec<f64>,
    filled: Vec<bool>,
}

impl Kernel {
    /// The filter converting by `output_step / input_step` at `quality`.
    ///
    /// With the lower Nyquist frequency `ν = min(output_step / input_step, 1)`
    /// in units of the input's, and the quality's passband edge `p`, the
    /// transition band runs from `p · ν` to `ν`. The sinc's cutoff is its
    /// centre, `ν · (p + 1) / 2`, and the window's half-length in input
    /// samples is Kaiser's estimate for the quality's attenuation `A` over a
    /// transition of `Δ = ν · (1 − p)`: `(A − 7.95) / (4.57 · π · Δ)`, half of
    /// `(A − 7.95) / (2.285 · Δω)` with `Δω = π · Δ`. Each expression is
    /// evaluated left to right as written, as the TypeScript reference path
    /// evaluates it (ADR-0032).
    ///
    /// Between equal rates the kernel is a single tap of one, so the
    /// conversion copies its input exactly: REQ-ARCH-085 forbids filtering
    /// audio that needs no conversion.
    ///
    /// # Errors
    ///
    /// [`ResamplerError::OutOfMemory`] when the table cannot be allocated.
    pub fn new(
        output_step: u32,
        input_step: u32,
        quality: ResamplingQuality,
    ) -> Result<Self, ResamplerError> {
        let design = if output_step == input_step {
            Design {
                output_step,
                half: 0,
                half_width: 1.0,
                cutoff: 1.0,
                beta: 0.0,
                bessel_of_beta: 1.0,
            }
        } else {
            let ratio = f64::from(output_step) / f64::from(input_step);
            let nyquist = if ratio < 1.0 { ratio } else { 1.0 };
            let edge = quality.passband_edge();
            let cutoff = nyquist * (edge + 1.0) / 2.0;
            let transition = nyquist * (1.0 - edge);
            let half_width = (quality.design_attenuation() - 7.95) / (4.57 * PI * transition);
            #[allow(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "half_width is positive and far below u32::MAX for any rate pair"
            )]
            let half = half_width.ceil() as u32;
            let beta = quality.beta();
            Design {
                output_step,
                half,
                half_width,
                cutoff,
                beta,
                bessel_of_beta: bessel_i0(beta),
            }
        };
        let phases = output_step as usize;
        let size = design
            .taps()
            .checked_mul(phases)
            .ok_or(ResamplerError::OutOfMemory)?;
        let mut table = Vec::new();
        table
            .try_reserve_exact(size)
            .map_err(|_| ResamplerError::OutOfMemory)?;
        let mut filled = Vec::new();
        filled
            .try_reserve_exact(phases)
            .map_err(|_| ResamplerError::OutOfMemory)?;
        if design.half == 0 {
            table.resize(size, 1.0);
            filled.resize(phases, true);
        } else {
            table.resize(size, 0.0);
            filled.resize(phases, false);
        }
        Ok(Self {
            design,
            input_step,
            table,
            filled,
        })
    }

    /// Output samples per [`Self::input_step`] input samples.
    #[must_use]
    pub fn output_step(&self) -> u32 {
        self.design.output_step
    }

    /// Input samples per [`Self::output_step`] output samples.
    #[must_use]
    pub fn input_step(&self) -> u32 {
        self.input_step
    }

    /// Taps each side of the centre: the input frames the filter looks ahead,
    /// and behind.
    #[must_use]
    pub fn half(&self) -> u32 {
        self.design.half
    }

    /// Coefficients per output sample.
    #[must_use]
    pub fn taps(&self) -> usize {
        self.design.taps()
    }

    /// The taps of `phase`, computed into the table the first time it is asked
    /// for. `phase` is below [`Self::output_step`], as the stream keeps it.
    pub(crate) fn phase_taps(&mut self, phase: u32) -> &[f64] {
        let taps = self.design.taps();
        let index = phase as usize;
        let start = index * taps;
        let slot = &mut self.table[start..start + taps];
        if !self.filled[index] {
            self.design.fill_phase(phase, slot);
            self.filled[index] = true;
        }
        slot
    }
}

#[cfg(test)]
mod tests {
    // Each exact comparison here is the point: the canonical rule promises
    // these bits, not values near them.
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use super::Kernel;
    use crate::quality::ResamplingQuality;

    #[test]
    fn sums_each_phase_to_one() {
        let mut kernel = Kernel::new(160, 147, ResamplingQuality::High).expect("fits");
        for phase in [0, 1, 80, 159] {
            let sum: f64 = kernel.phase_taps(phase).iter().sum();
            assert!((sum - 1.0).abs() < 1.0e-12);
        }
    }

    #[test]
    fn is_one_unit_tap_between_equal_rates() {
        let mut kernel = Kernel::new(1, 1, ResamplingQuality::Maximum).expect("fits");
        assert_eq!(kernel.phase_taps(0), &[1.0]);
        assert_eq!(kernel.half(), 0);
    }

    #[test]
    fn keeps_the_same_taps_whatever_order_its_phases_are_first_used_in() {
        let mut forward = Kernel::new(160, 147, ResamplingQuality::Draft).expect("fits");
        let mut backward = forward.clone();
        let first: Vec<Vec<f64>> = (0..160)
            .map(|phase| forward.phase_taps(phase).to_vec())
            .collect();
        for phase in (0..160).rev() {
            assert_eq!(backward.phase_taps(phase), &first[phase as usize][..]);
        }
        // Asked again, a phase answers what it kept.
        assert_eq!(forward.phase_taps(7), &first[7][..]);
    }

    #[test]
    fn keeps_a_table_of_every_phase_however_many_there_are() {
        // 44 099 Hz to 48 000 Hz has 48 000 phases: past the mebi-coefficient
        // at which the kernel once stopped keeping a table and recomputed
        // every tap of every output sample instead.
        let mut kernel = Kernel::new(48_000, 44_099, ResamplingQuality::Draft).expect("fits");
        assert_eq!(kernel.table.len(), kernel.taps() * 48_000);
        assert!(kernel.table.len() > 1 << 20);
        let sum: f64 = kernel.phase_taps(12_345).iter().sum();
        assert!((sum - 1.0).abs() < 1.0e-12);
        // Once filled, a phase is read from the table and not computed again.
        let start = 12_345 * kernel.taps();
        kernel.table[start] = 42.0;
        assert_eq!(kernel.phase_taps(12_345)[0], 42.0);
    }

    #[test]
    fn widens_when_the_rate_falls() {
        let up = Kernel::new(2, 1, ResamplingQuality::Draft).expect("fits");
        let down = Kernel::new(1, 2, ResamplingQuality::Draft).expect("fits");
        assert!(down.half() > up.half());
    }

    #[test]
    fn takes_the_half_length_kaisers_formula_gives_each_quality() {
        // (A − 7.95) / (4.57 · π · Δ) rounded up, for 44.1 kHz to 48 kHz,
        // whose lower Nyquist frequency is the input's.
        let half = |quality| Kernel::new(160, 147, quality).expect("fits").half();
        assert_eq!(half(ResamplingQuality::Maximum), 321);
        assert_eq!(half(ResamplingQuality::High), 133);
        assert_eq!(half(ResamplingQuality::Draft), 39);
    }
}
