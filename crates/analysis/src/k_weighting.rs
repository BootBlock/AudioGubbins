//! The K-weighting of ITU-R BS.1770-4, its two filters designed for any
//! rate.
//!
//! The recommendation prints the coefficients for 48 kHz alone. Each stage is
//! the bilinear transform of an analogue prototype, a high shelf and a
//! high-pass, whose parameters are those fitted to reproduce the printed
//! coefficients at 48 kHz (the corner frequencies, gain and qualities
//! libebur128 publishes); the tests hold the design at 48 kHz to the printed
//! values within 10⁻⁸. With `K = tan(π · f₀ / rate)`, the tangent
//! [`tangent_of_turns`] of `f₀ / (2 · rate)`, `kq = K / Q` and `k2 = K · K`,
//! each coefficient is computed in the order written:
//!
//! - shelf: `vh = decibels_to_gain(G)`, `vb = pow(vh, 0.499 666 774 154 541 6)`,
//!   `a0 = (1 + kq) + k2`, `b0 = ((vh + vb · kq) + k2) / a0`,
//!   `b1 = (2 · (k2 − vh)) / a0`, `b2 = ((vh − vb · kq) + k2) / a0`,
//!   `a1 = (2 · (k2 − 1)) / a0`, `a2 = ((1 − kq) + k2) / a0`;
//! - high-pass: `a0 = (1 + kq) + k2`, `b0 = 1`, `b1 = −2`, `b2 = 1`,
//!   `a1 = (2 · (k2 − 1)) / a0`, `a2 = ((1 − kq) + k2) / a0`.

use audiogubbins_dsp_core::{decibels_to_gain, pow, tangent_of_turns};

/// The shelf's corner frequency in hertz, gain in decibels and quality.
const SHELF_FREQUENCY: f64 = 1_681.974_450_955_533;
const SHELF_GAIN: f64 = 3.999_843_853_973_347;
const SHELF_QUALITY: f64 = 0.707_175_236_955_419_6;

/// The exponent that makes the shelf's band gain from its high gain.
const SHELF_BAND_EXPONENT: f64 = 0.499_666_774_154_541_6;

/// The high-pass filter's corner frequency in hertz and quality.
const HIGH_PASS_FREQUENCY: f64 = 38.135_470_876_024_44;
const HIGH_PASS_QUALITY: f64 = 0.500_327_037_323_877_3;

/// The lowest rate K-weighting is designed for: the shelf's corner, at
/// 1.68 kHz, must lie well inside the band, as it does from 8 kHz.
pub const LOWEST_RATE: u32 = 8_000;

/// A biquad's coefficients, its `a0` divided out.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Biquad {
    /// The feed-forward coefficient of the input now.
    pub b0: f64,
    /// The feed-forward coefficient of the input one sample back.
    pub b1: f64,
    /// The feed-forward coefficient of the input two samples back.
    pub b2: f64,
    /// The feedback coefficient of the output one sample back.
    pub a1: f64,
    /// The feedback coefficient of the output two samples back.
    pub a2: f64,
}

impl Biquad {
    /// The next output for `input`, with the transposed direct form II state
    /// `state`: `y = b0 · x + s₁`, then `s₁ = (b1 · x − a1 · y) + s₂` and
    /// `s₂ = b2 · x − a2 · y`.
    #[must_use]
    pub fn run(&self, state: &mut [f64; 2], input: f64) -> f64 {
        let output = self.b0 * input + state[0];
        state[0] = (self.b1 * input - self.a1 * output) + state[1];
        state[1] = self.b2 * input - self.a2 * output;
        output
    }
}

/// The two stages of K-weighting at `sample_rate`, the shelf first. The
/// caller has checked the rate is at least [`LOWEST_RATE`].
#[must_use]
pub fn k_weighting(sample_rate: u32) -> [Biquad; 2] {
    let rate = f64::from(sample_rate);
    let (kq, k2) = prototype(SHELF_FREQUENCY, SHELF_QUALITY, rate);
    let vh = decibels_to_gain(SHELF_GAIN);
    let vb = pow(vh, SHELF_BAND_EXPONENT);
    let a0 = (1.0 + kq) + k2;
    let shelf = Biquad {
        b0: ((vh + vb * kq) + k2) / a0,
        b1: (2.0 * (k2 - vh)) / a0,
        b2: ((vh - vb * kq) + k2) / a0,
        a1: (2.0 * (k2 - 1.0)) / a0,
        a2: ((1.0 - kq) + k2) / a0,
    };
    let (kq, k2) = prototype(HIGH_PASS_FREQUENCY, HIGH_PASS_QUALITY, rate);
    let a0 = (1.0 + kq) + k2;
    let high_pass = Biquad {
        b0: 1.0,
        b1: -2.0,
        b2: 1.0,
        a1: (2.0 * (k2 - 1.0)) / a0,
        a2: ((1.0 - kq) + k2) / a0,
    };
    [shelf, high_pass]
}

/// `K / Q` and `K · K`, with `K = tan(π · frequency / rate)`.
fn prototype(frequency: f64, quality: f64, rate: f64) -> (f64, f64) {
    let k = tangent_of_turns(frequency / (2.0 * rate));
    (k / quality, k * k)
}

#[cfg(test)]
mod tests {
    use super::k_weighting;
    use crate::fingerprint;

    #[test]
    fn matches_the_coefficients_the_recommendation_prints_for_48_khz() {
        // ITU-R BS.1770-4, Annex 1, Tables 1 and 2.
        let [shelf, high_pass] = k_weighting(48_000);
        let printed = [
            (shelf.b0, 1.535_124_859_586_97),
            (shelf.b1, -2.691_696_189_406_38),
            (shelf.b2, 1.198_392_810_852_85),
            (shelf.a1, -1.690_659_293_182_41),
            (shelf.a2, 0.732_480_774_215_85),
            (high_pass.b0, 1.0),
            (high_pass.b1, -2.0),
            (high_pass.b2, 1.0),
            (high_pass.a1, -1.990_047_454_833_98),
            (high_pass.a2, 0.990_072_250_366_21),
        ];
        for (index, (designed, expected)) in printed.iter().enumerate() {
            assert!(
                (designed - expected).abs() < 1.0e-8,
                "coefficient {index}: {designed} against {expected}"
            );
        }
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        let coefficients: Vec<f64> = [44_100, 48_000, 96_000, 8_000]
            .into_iter()
            .flat_map(k_weighting)
            .flat_map(|stage| [stage.b0, stage.b1, stage.b2, stage.a1, stage.a2])
            .collect();
        let hash = fingerprint::of(&coefficients);
        assert_eq!(
            hash, GOLDEN_K_WEIGHTING,
            "k-weighting bits changed: {hash:#x}"
        );
    }

    /// Both stages' coefficients at 44.1, 48, 96 and 8 kHz.
    const GOLDEN_K_WEIGHTING: u64 = 0xa2aa_fa38_a286_f78c;
}
