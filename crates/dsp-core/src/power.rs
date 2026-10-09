//! A number raised to a power.
//!
//! `xʸ = e^(y · ln x)`, where `ln x` is the logarithm's two-part value and
//! `y · ln x` is formed as two parts too, its high part's rounding error found
//! exactly. The exponential can then take an argument in the hundreds and
//! still be within a unit or so in the last place, where a single `f64` for
//! `y · ln x` would carry an error of hundreds of units into the result.
//!
//! The processors raise only numbers at or above zero to a power, so a negative
//! base is NaN for every exponent but zero, whole exponents included: an odd
//! root of a negative number is never what they ask for.

use crate::exact::product_low;
use crate::exponential::{LARGEST_ARGUMENT, SMALLEST_ARGUMENT, exp_of_sum};
use crate::logarithm::ln_parts;

/// `xʸ` for `x ≥ 0`, identical on every platform.
///
/// The cases, in the order they are decided:
///
/// 1. `y = ±0`: 1, whatever `x` is, NaN included;
/// 2. `x = 1`: 1, whatever `y` is, NaN and infinities included;
/// 3. `x` or `y` NaN: NaN;
/// 4. `x < 0` (not `−0`): NaN;
/// 5. `x = ±0`: `+0` for `y > 0` and `+∞` for `y < 0`; a zero base is taken
///    as `+0` whatever its sign;
/// 6. `x = +∞`: `+∞` for `y > 0` and `+0` for `y < 0`;
/// 7. `y = ±∞`: `+∞` where `x > 1` and `y > 0`, or `x < 1` and `y < 0`;
///    `+0` otherwise;
/// 8. otherwise, `(l, lₗ) = ln_parts(x)`; `z = y · l`; `+∞` past
///    `LARGEST_ARGUMENT` and `+0` below `SMALLEST_ARGUMENT`; else
///    `zₗ = error(y · l) + y · lₗ` and the answer is `exp_of_sum(z, zₗ)`.
#[must_use]
#[allow(clippy::float_cmp, reason = "a base of exactly one is a stated case")]
pub fn pow(x: f64, y: f64) -> f64 {
    if y == 0.0 || x == 1.0 {
        return 1.0;
    }
    if x.is_nan() || y.is_nan() || x < 0.0 {
        return f64::NAN;
    }
    if x == 0.0 {
        return if y > 0.0 { 0.0 } else { f64::INFINITY };
    }
    if x == f64::INFINITY {
        return if y > 0.0 { f64::INFINITY } else { 0.0 };
    }
    if y.is_infinite() {
        return if (x > 1.0) == (y > 0.0) {
            f64::INFINITY
        } else {
            0.0
        };
    }
    let (log, log_low) = ln_parts(x);
    let z = y * log;
    // Decided before the error is found: a `y` so large that `z` is past the
    // range would overflow Veltkamp's split.
    if z > LARGEST_ARGUMENT {
        return f64::INFINITY;
    }
    if z < SMALLEST_ARGUMENT {
        return 0.0;
    }
    exp_of_sum(z, product_low(y, log, log_low, z))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use super::pow;
    use crate::ulps::ulps_between;

    #[test]
    fn gives_the_stated_special_values() {
        let nan = f64::NAN;
        let inf = f64::INFINITY;
        assert_eq!(pow(nan, 0.0), 1.0);
        assert_eq!(pow(-3.0, -0.0), 1.0);
        assert!(pow(nan, 1.0).is_nan());
        assert!(pow(2.0, nan).is_nan());
        assert!(pow(-2.0, 2.0).is_nan());
        assert!(pow(-8.0, 1.0 / 3.0).is_nan());
        assert_eq!(pow(1.0, inf), 1.0);
        assert_eq!(pow(1.0, nan), 1.0);
        assert_eq!(pow(0.0, 2.0).to_bits(), 0.0_f64.to_bits());
        assert_eq!(pow(-0.0, 3.0).to_bits(), 0.0_f64.to_bits());
        assert_eq!(pow(0.0, -1.0), inf);
        assert_eq!(pow(inf, 0.5), inf);
        assert_eq!(pow(inf, -0.5).to_bits(), 0.0_f64.to_bits());
        assert_eq!(pow(2.0, inf), inf);
        assert_eq!(pow(0.5, inf), 0.0);
        assert_eq!(pow(2.0, -inf), 0.0);
        assert_eq!(pow(0.5, -inf), inf);
        assert_eq!(pow(10.0, 400.0), inf);
        assert_eq!(pow(10.0, -400.0), 0.0);
        assert_eq!(pow(1.000_000_1, 1.0e300), inf);
    }

    #[test]
    fn is_exact_where_the_answer_is_a_power_of_two_or_a_square() {
        assert_eq!(pow(2.0, 10.0), 1_024.0);
        assert_eq!(pow(2.0, -1_074.0), f64::from_bits(1));
        assert_eq!(pow(4.0, 0.5), 2.0);
        assert_eq!(pow(10.0, 2.0), 100.0);
        assert_eq!(pow(10.0, -1.0), 0.1);
    }

    #[test]
    fn agrees_with_the_platform_power_to_within_one_ulp() {
        // Bases from 10⁻⁶ to 10⁶ and exponents from -50 to 50, and the
        // arguments near the overflow, where a single-f64 `y · ln x` would be
        // hundreds of units out.
        let mut checked = 0;
        for i in 0..400 {
            let x = 10.0_f64.powf(f64::from(i) / 400.0 * 12.0 - 6.0);
            for j in 0..400 {
                let y = f64::from(j) / 4.0 - 50.0;
                let expected = x.powf(y);
                if expected.is_finite() && expected > f64::MIN_POSITIVE {
                    assert!(ulps_between(pow(x, y), expected) <= 1, "pow({x}, {y})");
                    checked += 1;
                }
            }
        }
        for (x, y) in [
            (std::f64::consts::E, 700.0),
            (1.000_001, 7.0e8),
            (0.999, 7.0e5),
        ] {
            assert!(ulps_between(pow(x, y), x.powf(y)) <= 1, "pow({x}, {y})");
        }
        assert!(checked > 150_000);
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        let bits: Vec<u64> = GOLDEN_INPUTS
            .iter()
            .map(|(x, y)| pow(*x, *y).to_bits())
            .collect();
        assert_eq!(bits, GOLDEN_POW_BITS, "pow bits changed: {bits:#x?}");
    }

    const GOLDEN_INPUTS: [(f64, f64); 6] = [
        (2.0, 0.5),
        (10.0, 0.3),
        (0.5, 3.7),
        (1.000_01, 50_000.0),
        (123.456, -2.5),
        (0.99, 70_000.0),
    ];

    /// `xʸ` for each pair of the inputs in turn.
    const GOLDEN_POW_BITS: [u64; 6] = [
        0x3ff6_a09e_667f_3bcc,
        0x3fff_ec98_2d5b_b8af,
        0x3fb3_b2c4_7bff_8328,
        0x3ffa_6125_3bb0_7b56,
        0x3ed8_c470_85e5_4025,
        0x0080_566a_dc70_8a35,
    ];
}
