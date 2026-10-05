//! The natural exponential.
//!
//! `eˣ = 2ᵏ · eʳ`, where `k` is the whole number nearest `x / ln 2` and
//! `r = x − k · ln 2`, so `|r|` is about `ln 2 / 2` at most. The reduction is
//! Cody and Waite's: `ln 2` is split into a high part with 42 significant bits,
//! so `k` times it is exact for every `k` an `f64` result can need, and a low
//! part that carries the next 53 bits. `eʳ` is then the Taylor series to the
//! 14th power, whose next term is below 2⁻⁵⁶ of the sum, and the scaling by
//! `2ᵏ` is built from the bits of the result, so the only rounding after the
//! series is the one the scaling into the subnormal range must make.
//!
//! Measured against the platform's `exp`, every result is within one unit in
//! the last place.

/// `ln 2`'s high 42 bits, so `k · LN2_HIGH` is exact for any `|k| < 2¹¹`.
pub(crate) const LN2_HIGH: f64 = 0.693_147_180_559_890_3;

/// `ln 2 − LN2_HIGH`, rounded: the two together are `ln 2` within 2⁻¹⁰².
pub(crate) const LN2_LOW: f64 = 5.497_923_018_708_371e-14;

/// The largest argument whose exponential is computed: past it the result
/// would overflow, so it is infinity at once.
pub(crate) const LARGEST_ARGUMENT: f64 = 709.8;

/// The smallest argument whose exponential is computed: below it the result
/// rounds to zero, so it is zero at once.
pub(crate) const SMALLEST_ARGUMENT: f64 = -745.2;

/// `1/n!` for `n` from 2 to 14, lowest first: `eʳ = 1 + r + r² · Σ rⁿ⁻²/n!`.
///
/// Written as the shortest decimal that parses to each `f64`, so the
/// TypeScript reference path, which parses the same text, holds the same bits.
const TAYLOR: [f64; 13] = [
    0.5,
    0.166_666_666_666_666_66,
    0.041_666_666_666_666_664,
    0.008_333_333_333_333_333,
    0.001_388_888_888_888_889,
    0.000_198_412_698_412_698_4,
    2.480_158_730_158_73e-5,
    2.755_731_922_398_589_3e-6,
    2.755_731_922_398_589e-7,
    2.505_210_838_544_172e-8,
    2.087_675_698_786_81e-9,
    1.605_904_383_682_161_3e-10,
    1.147_074_559_772_972_5e-11,
];

/// `eˣ`, identical on every platform.
///
/// NaN for NaN, infinity for `+∞` and any `x` past about 709.78, and `+0` for
/// `−∞` and any `x` below about −745.13, where the result rounds to zero.
/// `e⁰` is exactly 1. Between −745.13 and −708.4 the result is subnormal, and
/// is the exact `p · 2ᵏ` rounded once.
#[must_use]
pub fn exp(x: f64) -> f64 {
    if x.is_nan() {
        return f64::NAN;
    }
    exp_of_sum(x, 0.0)
}

/// `e^(high + low)` for an argument carried as two parts, `|low|` at most
/// about an ulp of `high`: what [`exp`] is with `low` zero, and what the
/// power and the conversion from decibels use so the argument they form keeps
/// the bits a single `f64` would lose. `high` is not NaN.
///
/// The operations, in order:
///
/// 1. `+∞` past [`LARGEST_ARGUMENT`], `+0` below [`SMALLEST_ARGUMENT`];
/// 2. `k = ⌊high · log₂e + 0.5⌋`;
/// 3. `h = high − k · LN2_HIGH`, exact; `l = k · LN2_LOW − low`;
///    `r = h − l`; `c = (h − r) − l`, what `r` lost;
/// 4. `q` by Horner's rule over [`TAYLOR`], highest first, in `r`;
/// 5. `p = 1 + (r + (r · r · q + c · (1 + r)))`, so `eʳ⁺ᶜ` to first order in `c`;
/// 6. `p · 2ᵏ`, by [`scale_by_power_of_two`].
#[must_use]
#[allow(
    clippy::many_single_char_names,
    reason = "the names are the stated operations', letter for letter"
)]
pub(crate) fn exp_of_sum(high: f64, low: f64) -> f64 {
    if high > LARGEST_ARGUMENT {
        return f64::INFINITY;
    }
    if high < SMALLEST_ARGUMENT {
        return 0.0;
    }
    let k = (high * std::f64::consts::LOG2_E + 0.5).floor();
    let h = high - k * LN2_HIGH;
    let l = k * LN2_LOW - low;
    let r = h - l;
    let lost = (h - r) - l;
    let mut q = TAYLOR[12];
    for coefficient in TAYLOR[..12].iter().rev() {
        q = q * r + coefficient;
    }
    let p = 1.0 + (r + (r * r * q + lost * (1.0 + r)));
    // `high` is within [-745.2, 709.8], so k is a whole number in [-1076, 1025].
    #[allow(
        clippy::cast_possible_truncation,
        reason = "a whole number from -1076 to 1025"
    )]
    let exponent = k as i32;
    scale_by_power_of_two(p, exponent)
}

/// `value · 2ⁿ` rounded once, for `value` in `[½, 2]` and `n` in
/// `[−1076, 1025]`, where `2ⁿ` alone may not be an `f64`.
///
/// Past 2¹⁰²³ the value is first scaled by 2¹⁰²³, exactly, and then by the
/// rest, which rounds once, to infinity if it overflows. Below 2⁻¹⁰²² it is
/// first scaled by `2ⁿ⁺¹⁰⁰⁰`, exactly, since that is still a normal number, and
/// then by 2⁻¹⁰⁰⁰, which rounds once into the subnormal range.
#[must_use]
pub(crate) fn scale_by_power_of_two(value: f64, n: i32) -> f64 {
    if n > 1023 {
        value * power_of_two(1023) * power_of_two(n - 1023)
    } else if n < -1022 {
        value * power_of_two(n + 1000) * power_of_two(-1000)
    } else {
        value * power_of_two(n)
    }
}

/// `2ⁿ` for `n` in `[−1022, 1023]`, built from its bits: a biased exponent of
/// `n + 1023` and a fraction of zero.
fn power_of_two(n: i32) -> f64 {
    #[allow(
        clippy::cast_sign_loss,
        reason = "n + 1023 is from 1 to 2046 for every n a caller passes"
    )]
    let biased = (n + 1023) as u64;
    f64::from_bits(biased << 52)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use super::exp;
    use crate::ulps::ulps_between;

    #[test]
    fn gives_the_exact_special_values() {
        assert_eq!(exp(0.0).to_bits(), 1.0_f64.to_bits());
        assert_eq!(exp(-0.0).to_bits(), 1.0_f64.to_bits());
        assert!(exp(f64::NAN).is_nan());
        assert_eq!(exp(f64::INFINITY), f64::INFINITY);
        assert_eq!(exp(f64::NEG_INFINITY).to_bits(), 0.0_f64.to_bits());
        assert_eq!(exp(710.0), f64::INFINITY);
        assert_eq!(exp(-746.0).to_bits(), 0.0_f64.to_bits());
        assert_eq!(exp(f64::MAX), f64::INFINITY);
        assert_eq!(exp(f64::MIN).to_bits(), 0.0_f64.to_bits());
    }

    #[test]
    fn agrees_with_the_platform_exponential_to_within_one_ulp() {
        // The platform's exp is not canonical, but it is close, and a wrong
        // coefficient or reduction would miss it by far more than this.
        let mut worst = 0;
        for step in 0..200_001 {
            let x = f64::from(step) / 200_000.0 * 1_454.0 - 745.0;
            let expected = x.exp();
            let found = exp(x);
            let difference = ulps_between(found, expected);
            worst = worst.max(difference);
            assert!(difference <= 1, "exp({x}) = {found}, not {expected}");
        }
        for step in -2_000..=2_000 {
            let x = f64::from(step) / 1_000.0;
            assert!(ulps_between(exp(x), x.exp()) <= 1, "exp({x})");
        }
        assert!(worst <= 1);
    }

    #[test]
    fn overflows_and_underflows_where_the_platform_does() {
        // ln of the largest f64 is 709.78271289338399…; e^−745.13321910194110…
        // is half the least subnormal, below which a result rounds to zero.
        assert!(ulps_between(exp(709.782_712_893_383), 709.782_712_893_383_f64.exp()) <= 1);
        assert_eq!(exp(709.782_712_893_385), f64::INFINITY);
        for x in [-708.5, -720.0, -740.0, -744.5, -745.13] {
            assert!(ulps_between(exp(x), x.exp()) <= 1, "exp({x})");
        }
        assert_eq!(exp(-745.14).to_bits(), 0.0_f64.to_bits());
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        let bits: Vec<u64> = GOLDEN_INPUTS.iter().map(|x| exp(*x).to_bits()).collect();
        assert_eq!(bits, GOLDEN_EXP_BITS, "exp bits changed: {bits:#x?}");
    }

    const GOLDEN_INPUTS: [f64; 8] = [1.0, -1.0, 0.5, 10.0, -20.0, 700.0, -740.0, 1.0e-10];

    /// `eˣ` for x = 1, −1, 0.5, 10, −20, 700, −740 and 10⁻¹⁰.
    const GOLDEN_EXP_BITS: [u64; 8] = [
        0x4005_bf0a_8b14_5769,
        0x3fd7_8b56_362c_ef38,
        0x3ffa_6129_8e1e_069c,
        0x40d5_829d_cf95_0560,
        0x3e21_b486_55f3_7267,
        0x7f0d_945d_f4f8_ec8e,
        0x0000_0000_0000_0055,
        0x3ff0_0000_0006_df38,
    ];
}
