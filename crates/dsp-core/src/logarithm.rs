//! The natural, binary and decimal logarithms.
//!
//! `x = 2ᵉ · m` from the bits of `x`, with `m` in `[√½, √2]`, so
//! `ln x = e · ln 2 + ln m`. With `f = m − 1` and `s = f / (2 + f)`, which is
//! at most `3 − 2√2` (about 0.17) in size, `ln m = 2 · atanh s`, the odd series
//! `2s + 2s³/3 + 2s⁵/5 + …`, summed here to the 25th power, past which a term
//! is below 2⁻⁷⁰ of the sum.
//!
//! The logarithm is carried as two `f64`s, `hi + lo`, accurate to about 2⁻⁶³
//! of its size, because the power multiplies it by an exponent that can be in
//! the hundreds and the exponential of the product needs its every bit. `s`,
//! `s²`, `s³` and the leading term of the series are each formed as two parts
//! by the error-free transformations of [`crate::exact`]; only the small tail
//! of the series is a single `f64`. The logarithms an `f64` is asked for are
//! that pair rounded once, after any change of base, which makes each of them
//! within one unit in the last place, and exact where the answer is: `ln 1`,
//! `log₂ 2ⁿ` and `log₁₀ 10ⁿ` for the powers of ten an `f64` holds exactly.

use crate::exact::{double_product_rounded, fast_sum_error, product_error, sum_error};
use crate::exponential::{LN2_HIGH, LN2_LOW};

/// `2/(2n + 1)` for `n` from 2 to 12, lowest first: the series after its
/// first two terms, `s³ · (2/3 + s² · Σ 2s²⁽ⁿ⁻²⁾/(2n + 1))`.
///
/// Written as the shortest decimal that parses to each `f64`, so the
/// TypeScript reference path, which parses the same text, holds the same bits.
const SERIES: [f64; 11] = [
    0.4,
    0.285_714_285_714_285_7,
    0.222_222_222_222_222_2,
    0.181_818_181_818_181_82,
    0.153_846_153_846_153_85,
    0.133_333_333_333_333_33,
    0.117_647_058_823_529_41,
    0.105_263_157_894_736_84,
    0.095_238_095_238_095_23,
    0.086_956_521_739_130_43,
    0.08,
];

/// `2/3` as two parts.
const TWO_THIRDS_HIGH: f64 = 0.666_666_666_666_666_6;
const TWO_THIRDS_LOW: f64 = 3.700_743_415_417_188e-17;

/// `1 / ln 2` as two parts.
const LOG2_E_HIGH: f64 = std::f64::consts::LOG2_E;
const LOG2_E_LOW: f64 = 2.035_527_374_093_103_3e-17;

/// `1 / ln 10` as two parts.
const LOG10_E_HIGH: f64 = std::f64::consts::LOG10_E;
const LOG10_E_LOW: f64 = 1.098_319_650_216_765e-17;

/// `2⁵⁴`, which lifts a subnormal into the normal range exactly.
const TWO_TO_54: f64 = 18_014_398_509_481_984.0;

const FRACTION_MASK: u64 = (1 << 52) - 1;
const EXPONENT_OF_ONE: u64 = 1023 << 52;

/// `ln x`, identical on every platform.
///
/// NaN for NaN and for any `x` below zero, `−∞` for `±0`, `+∞` for `+∞`, and
/// `+0` for 1 exactly.
#[must_use]
pub fn ln(x: f64) -> f64 {
    special_logarithm(x).unwrap_or_else(|| ln_parts(x).0)
}

/// `log₂ x`, identical on every platform: [`ln_parts`] times `1 / ln 2`,
/// both as two parts, rounded once (`double_product_rounded`). Exact at every
/// power of two. The special values are [`ln`]'s.
#[must_use]
pub fn log2(x: f64) -> f64 {
    special_logarithm(x).unwrap_or_else(|| {
        let (high, low) = ln_parts(x);
        double_product_rounded(high, low, LOG2_E_HIGH, LOG2_E_LOW)
    })
}

/// `log₁₀ x`, identical on every platform: [`ln_parts`] times `1 / ln 10`,
/// both as two parts, rounded once. The special values are [`ln`]'s.
#[must_use]
pub fn log10(x: f64) -> f64 {
    special_logarithm(x).unwrap_or_else(|| {
        let (high, low) = ln_parts(x);
        double_product_rounded(high, low, LOG10_E_HIGH, LOG10_E_LOW)
    })
}

/// What every logarithm answers where the series does not apply: NaN for NaN
/// and below zero, `−∞` at either zero, `+∞` at `+∞`; `None` for a finite
/// `x` above zero.
#[must_use]
pub(crate) fn special_logarithm(x: f64) -> Option<f64> {
    if x.is_nan() || x < 0.0 {
        Some(f64::NAN)
    } else if x == 0.0 {
        Some(f64::NEG_INFINITY)
    } else if x == f64::INFINITY {
        Some(f64::INFINITY)
    } else {
        None
    }
}

/// `ln x` as `(hi, lo)`, `hi` the sum rounded and `lo` what it lost, for a
/// finite `x` above zero.
///
/// The operations, in order:
///
/// 1. a subnormal `x` is first multiplied by 2⁵⁴, and `e` lowered by 54;
/// 2. `e` and `m` in `[1, 2)` from the bits; if `m > √2`, `m = m · ½` and
///    `e = e + 1`; `f = m − 1`, exact;
/// 3. `d = 2 + f` and `dₗ = f − (d − 2)`; `s = f / d`, and
///    `sₗ = (((f − s·d) − error(s·d)) − s·dₗ) / d`;
/// 4. `z = s · s` and `zₗ = error(s·s) + (s + s) · sₗ`;
///    `c = s · z` and `cₗ = error(s·z) + (s · zₗ + sₗ · z)`;
/// 5. `t` by Horner's rule over [`SERIES`], highest first, in `z`;
///    `u = z · t`; `q = 2/3 + u` and `qₗ = (u − (q − 2/3)) + TWO_THIRDS_LOW`;
/// 6. `p = c · q` and `pₗ = error(c·q) + (c · qₗ + cₗ · q)`;
/// 7. `g = 2s + p` and `gₗ = (p − (g − 2s)) + (2sₗ + pₗ)`: `ln m`;
/// 8. `h = e · LN2_HIGH`, exact; `y = h + g` and
///    `yₗ = two-sum error(h, g) + (gₗ + e · LN2_LOW)`;
/// 9. `hi = y + yₗ` and `lo = yₗ − (hi − y)`.
#[must_use]
#[allow(
    clippy::many_single_char_names,
    reason = "the names are the stated operations', letter for letter"
)]
pub(crate) fn ln_parts(x: f64) -> (f64, f64) {
    let (scaled, lift) = if x.to_bits() >> 52 == 0 {
        (x * TWO_TO_54, -54)
    } else {
        (x, 0)
    };
    let bits = scaled.to_bits();
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_possible_wrap,
        reason = "an 11-bit exponent field"
    )]
    let biased = (bits >> 52) as i32;
    let mut exponent = biased - 1023 + lift;
    let mut m = f64::from_bits((bits & FRACTION_MASK) | EXPONENT_OF_ONE);
    if m > std::f64::consts::SQRT_2 {
        m *= 0.5;
        exponent += 1;
    }
    let f = m - 1.0;

    let d = 2.0 + f;
    let d_low = fast_sum_error(2.0, f, d);
    let s = f / d;
    let sd = s * d;
    let s_low = (((f - sd) - product_error(s, d, sd)) - s * d_low) / d;

    let z = s * s;
    let z_low = product_error(s, s, z) + (s + s) * s_low;
    let c = s * z;
    let c_low = product_error(s, z, c) + (s * z_low + s_low * z);

    let mut t = SERIES[10];
    for coefficient in SERIES[..10].iter().rev() {
        t = t * z + coefficient;
    }
    let u = z * t;
    let q = TWO_THIRDS_HIGH + u;
    let q_low = fast_sum_error(TWO_THIRDS_HIGH, u, q) + TWO_THIRDS_LOW;

    let p = c * q;
    let p_low = product_error(c, q, p) + (c * q_low + c_low * q);

    let two_s = s + s;
    let g = two_s + p;
    let g_low = fast_sum_error(two_s, p, g) + ((s_low + s_low) + p_low);

    let e = f64::from(exponent);
    let h = e * LN2_HIGH;
    let y = h + g;
    let y_low = sum_error(h, g, y) + (g_low + e * LN2_LOW);
    let high = y + y_low;
    (high, fast_sum_error(y, y_low, high))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use super::{ln, log2, log10};
    use crate::ulps::ulps_between;

    /// Positive numbers from the least subnormal to the largest `f64`, spread
    /// evenly over their bit patterns, and densely around 1.
    fn sweep() -> impl Iterator<Item = f64> {
        let spread =
            (1..200_000_u64).map(|step| f64::from_bits(step * (0x7fef_ffff_ffff_ffff / 200_000)));
        let near_one = (-20_000..=20_000).map(|step| 1.0 + f64::from(step) * 1.0e-6);
        spread.chain(near_one).filter(|x| *x > 0.0)
    }

    #[test]
    fn gives_the_exact_special_values() {
        for log in [ln, log2, log10] {
            assert_eq!(log(1.0).to_bits(), 0.0_f64.to_bits());
            assert_eq!(log(0.0), f64::NEG_INFINITY);
            assert_eq!(log(-0.0), f64::NEG_INFINITY);
            assert_eq!(log(f64::INFINITY), f64::INFINITY);
            assert!(log(-1.0).is_nan());
            assert!(log(f64::NEG_INFINITY).is_nan());
            assert!(log(f64::NAN).is_nan());
        }
        assert_eq!(ln(2.0), std::f64::consts::LN_2);
        assert_eq!(ln(10.0), std::f64::consts::LN_10);
    }

    #[test]
    fn is_exact_at_the_powers_of_its_base() {
        for n in -1074..=1023 {
            assert_eq!(log2(2.0_f64.powi(n)), f64::from(n), "log2(2^{n})");
        }
        let mut power = 1.0;
        for n in 0..=22 {
            assert_eq!(log10(power), f64::from(n), "log10(10^{n})");
            power *= 10.0;
        }
    }

    #[test]
    fn agrees_with_the_platform_logarithms_to_within_one_ulp() {
        // The platform's logarithms are not canonical, but they are close, and
        // a wrong coefficient or reduction would miss them by far more.
        for x in sweep() {
            assert!(ulps_between(ln(x), x.ln()) <= 1, "ln({x})");
            assert!(ulps_between(log2(x), x.log2()) <= 1, "log2({x})");
            assert!(ulps_between(log10(x), x.log10()) <= 1, "log10({x})");
        }
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        let bits: Vec<u64> = GOLDEN_INPUTS
            .iter()
            .flat_map(|x| [ln(*x).to_bits(), log2(*x).to_bits(), log10(*x).to_bits()])
            .collect();
        assert_eq!(
            bits, GOLDEN_LOGARITHM_BITS,
            "logarithm bits changed: {bits:#x?}"
        );
    }

    const GOLDEN_INPUTS: [f64; 6] = [0.1, 3.0, 1.0e-310, 1.5e300, 0.999_999, 1_234.5];

    /// `ln x`, `log₂ x` and `log₁₀ x` for each of the inputs in turn.
    const GOLDEN_LOGARITHM_BITS: [u64; 18] = [
        0xc002_6bb1_bbb5_5515,
        0xc00a_934f_0979_a371,
        0xbff0_0000_0000_0000,
        0x3ff1_93ea_7aad_030b,
        0x3ff9_5c01_a39f_bd68,
        0x3fde_8927_964f_d5fd,
        0xc086_4e69_394d_9508,
        0xc090_1730_dabc_a5f6,
        0xc073_6000_0000_0000,
        0x4085_9972_ac76_17a8,
        0x408f_294e_9fec_5b68,
        0x4072_c2d1_4511_6c17,
        0xbeb0_c6f8_2d74_d230,
        0xbeb8_3454_c416_7fe4,
        0xbe9d_2520_4937_a8c5,
        0x401c_7943_6f81_8745,
        0x4024_8a17_9379_59fb,
        0x4008_bb5f_aece_0c80,
    ];
}
