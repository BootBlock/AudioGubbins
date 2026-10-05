//! Conversion between decibels and linear gain.
//!
//! A gain of `g` is `20 · log₁₀ g` decibels, and `d` decibels is a gain of
//! `10^(d/20) = e^(d · ln 10 / 20)`. Each conversion is one composition of
//! the exponential's or the logarithm's two-part core with a two-part
//! constant, rounded once, rather than a call of [`crate::pow`] or of
//! [`crate::log10`] followed by a multiplication, each of which would round
//! again: so 20 dB is a gain of exactly 10, and a gain of 10 exactly 20 dB.

use crate::exact::{double_product_rounded, product_low};
use crate::exponential::{LARGEST_ARGUMENT, SMALLEST_ARGUMENT, exp_of_sum};
use crate::logarithm::{ln_parts, special_logarithm};

/// `ln 10 / 20` as two parts: the natural logarithm of the gain of one decibel.
const NEPERS_PER_DECIBEL_HIGH: f64 = 0.115_129_254_649_702_28;
const NEPERS_PER_DECIBEL_LOW: f64 = 5.799_564_252_466_100_6e-18;

/// `20 / ln 10` as two parts: the decibels of a gain of `e`.
const DECIBELS_PER_NEPER_HIGH: f64 = 8.685_889_638_065_037;
const DECIBELS_PER_NEPER_LOW: f64 = -2.244_252_798_067_096e-16;

/// The linear gain of `decibels`, identical on every platform.
///
/// NaN for NaN, `+∞` for `+∞` and above about 6 165 dB, `+0` for `−∞` and
/// below about −6 472 dB, and exactly 1 at 0 dB. The operations, in order:
/// `z = decibels · NEPERS_PER_DECIBEL_HIGH`; `+∞` or `+0` past the
/// exponential's range; `zₗ = error(z) + decibels · NEPERS_PER_DECIBEL_LOW`;
/// the answer is `exp_of_sum(z, zₗ)`.
#[must_use]
pub fn decibels_to_gain(decibels: f64) -> f64 {
    if decibels.is_nan() {
        return f64::NAN;
    }
    let z = decibels * NEPERS_PER_DECIBEL_HIGH;
    // Decided before the error is found, which would overflow Veltkamp's
    // split for an argument this far out.
    if z > LARGEST_ARGUMENT {
        return f64::INFINITY;
    }
    if z < SMALLEST_ARGUMENT {
        return 0.0;
    }
    exp_of_sum(
        z,
        product_low(decibels, NEPERS_PER_DECIBEL_HIGH, NEPERS_PER_DECIBEL_LOW, z),
    )
}

/// The decibels of a linear `gain`, identical on every platform.
///
/// NaN for NaN and below zero, `−∞` for `±0`, `+∞` for `+∞`, and `+0` for a
/// gain of exactly 1. Otherwise the logarithm's two parts times
/// `20 / ln 10`'s, rounded once (`double_product_rounded`).
#[must_use]
pub fn gain_to_decibels(gain: f64) -> f64 {
    special_logarithm(gain).unwrap_or_else(|| {
        let (high, low) = ln_parts(gain);
        double_product_rounded(high, low, DECIBELS_PER_NEPER_HIGH, DECIBELS_PER_NEPER_LOW)
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use super::{decibels_to_gain, gain_to_decibels};
    use crate::ulps::ulps_between;

    #[test]
    fn gives_the_exact_special_values() {
        assert_eq!(decibels_to_gain(0.0), 1.0);
        assert_eq!(decibels_to_gain(-0.0), 1.0);
        assert_eq!(decibels_to_gain(20.0), 10.0);
        assert_eq!(decibels_to_gain(-40.0), 0.01);
        assert!(decibels_to_gain(f64::NAN).is_nan());
        assert_eq!(decibels_to_gain(f64::INFINITY), f64::INFINITY);
        assert_eq!(
            decibels_to_gain(f64::NEG_INFINITY).to_bits(),
            0.0_f64.to_bits()
        );
        assert_eq!(decibels_to_gain(7_000.0), f64::INFINITY);
        assert_eq!(decibels_to_gain(-7_000.0), 0.0);

        assert_eq!(gain_to_decibels(1.0).to_bits(), 0.0_f64.to_bits());
        assert_eq!(gain_to_decibels(10.0), 20.0);
        assert_eq!(gain_to_decibels(0.001), -60.0);
        assert_eq!(gain_to_decibels(0.0), f64::NEG_INFINITY);
        assert_eq!(gain_to_decibels(f64::INFINITY), f64::INFINITY);
        assert!(gain_to_decibels(-0.5).is_nan());
        assert!(gain_to_decibels(f64::NAN).is_nan());
    }

    #[test]
    fn agrees_with_the_platform_composition_to_within_one_ulp() {
        // The platform's own `powf` and `log10` are the oracle only. Each
        // level is 5k/256 dB, so its twentieth, k/1024, is exact, and the
        // oracle rounds nothing before its `powf`.
        for k in -15_360..=5_120 {
            let decibels = f64::from(k) * 5.0 / 256.0;
            let gain = decibels_to_gain(decibels);
            let expected = 10.0_f64.powf(f64::from(k) / 1_024.0);
            assert!(ulps_between(gain, expected) <= 1, "{decibels} dB");
            let back = gain_to_decibels(gain);
            assert!(
                (back - decibels).abs() <= 1.0e-12,
                "{gain} back to {back} dB"
            );
        }
        // `20 · log10` rounds twice, so it is itself up to a unit and a half out.
        for step in 1..=100_000 {
            let gain = f64::from(step) / 50_000.0;
            let expected = 20.0 * gain.log10();
            assert!(
                ulps_between(gain_to_decibels(gain), expected) <= 2,
                "gain {gain}"
            );
        }
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        let bits: Vec<u64> = GOLDEN_DECIBELS
            .iter()
            .map(|decibels| decibels_to_gain(*decibels).to_bits())
            .chain(
                GOLDEN_GAINS
                    .iter()
                    .map(|gain| gain_to_decibels(*gain).to_bits()),
            )
            .collect();
        assert_eq!(
            bits, GOLDEN_DECIBEL_BITS,
            "decibel bits changed: {bits:#x?}"
        );
    }

    const GOLDEN_DECIBELS: [f64; 4] = [-6.0, 3.0, -96.5, 0.1];
    const GOLDEN_GAINS: [f64; 4] = [0.5, 2.0, 1.0e-5, 0.707];

    /// The gain of each of the decibels, then the decibels of each of the gains.
    const GOLDEN_DECIBEL_BITS: [u64; 8] = [
        0x3fe0_09b9_cf33_4252,
        0x3ff6_99c0_f7e8_6e10,
        0x3eef_60da_a090_e824,
        0x3ff0_2f6d_f015_a0f1,
        0xc018_1518_24c7_587f,
        0x4018_1518_24c7_587f,
        0xc059_0000_0000_0000,
        0xc008_17c7_e338_c5ac,
    ];
}
