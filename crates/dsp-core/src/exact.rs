//! Error-free transformations: the exact rounding error of a sum or a product,
//! itself a floating-point number.
//!
//! The exponential, the logarithm and the power carry an intermediate value as
//! an unevaluated sum `hi + lo` of two `f64`s (a double-double) where one
//! `f64` would lose bits the answer needs. These are the operations that
//! make that possible with correctly rounded arithmetic alone. A platform's
//! fused multiply-add would give a product's error in one instruction, but
//! JavaScript has none, so the product's error is found by Dekker's method
//! instead, which needs only multiplication and addition (ADR-0032).
//!
//! Each answers one number, the error, rather than a pair, so the TypeScript
//! reference path can repeat it without allocating a pair per call.

/// `2²⁷ + 1`: Veltkamp's constant, which splits a 53-bit significand into two
/// halves of at most 26 bits, whose products are each exact.
const SPLITTER: f64 = 134_217_729.0;

/// The high half of `a` by Veltkamp's split: `c = 134 217 729 · a`, then
/// `c − (c − a)`. The low half is `a − high`, exactly.
///
/// Exact for `|a|` below 2⁹⁹⁶, past which `c` overflows; every caller keeps
/// its arguments far inside that.
#[must_use]
pub(crate) fn split_high(a: f64) -> f64 {
    let c = SPLITTER * a;
    c - (c - a)
}

/// The rounding error of `product = a · b`: `a · b − product`, exactly, by
/// Dekker's method, unless a partial product underflows.
///
/// With `a = ah + al` and `b = bh + bl` from [`split_high`], the error is
/// `(((ah·bh − product) + ah·bl) + al·bh) + al·bl`, summed in that order.
#[must_use]
pub(crate) fn product_error(a: f64, b: f64, product: f64) -> f64 {
    let a_high = split_high(a);
    let a_low = a - a_high;
    let b_high = split_high(b);
    let b_low = b - b_high;
    (((a_high * b_high - product) + a_high * b_low) + a_low * b_high) + a_low * b_low
}

/// The rounding error of `sum = a + b`, exactly, for any order of magnitude:
/// Knuth's two-sum, `(a − (sum − (sum − a))) + (b − (sum − a))`.
#[must_use]
pub(crate) fn sum_error(a: f64, b: f64, sum: f64) -> f64 {
    let b_virtual = sum - a;
    let a_virtual = sum - b_virtual;
    (a - a_virtual) + (b - b_virtual)
}

/// The rounding error of `sum = a + b` where `|a| ≥ |b|` or `a` is zero:
/// Dekker's fast two-sum, `b − (sum − a)`.
#[must_use]
pub(crate) fn fast_sum_error(a: f64, b: f64, sum: f64) -> f64 {
    b - (sum - a)
}

/// The low part of `a · (b_high + b_low)`, whose high part is
/// `high = a · b_high`: the rounding error of that product, plus `a · b_low`,
/// in that order.
#[must_use]
pub(crate) fn product_low(a: f64, b_high: f64, b_low: f64, high: f64) -> f64 {
    product_error(a, b_high, high) + a * b_low
}

/// `(a_high + a_low) · (b_high + b_low)` rounded once to an `f64`: the
/// product of the high parts, plus its error, plus the cross terms, as
/// `product + (error + (a_high · b_low + a_low · b_high))`. The product of
/// the low parts is below the last bit and is left out.
#[must_use]
pub(crate) fn double_product_rounded(a_high: f64, a_low: f64, b_high: f64, b_low: f64) -> f64 {
    let product = a_high * b_high;
    product + (product_error(a_high, b_high, product) + (a_high * b_low + a_low * b_high))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "error-free transformations are exact")]

    use super::{fast_sum_error, product_error, split_high, sum_error};

    #[test]
    fn splits_into_halves_that_sum_back_exactly() {
        for a in [1.0 / 3.0, -7.123_456_789_012_345e100, 0.1, 1.0e-200] {
            let high = split_high(a);
            let low = a - high;
            assert_eq!(high + low, a);
            assert_eq!(high.to_bits() & ((1 << 26) - 1), 0, "{a} high half");
        }
    }

    #[test]
    fn finds_the_exact_error_of_a_product() {
        // (2²⁷ + 1)² = 2⁵⁴ + 2²⁸ + 1, whose last 1 an f64 cannot hold.
        let a = 134_217_729.0;
        let product = a * a;
        assert_eq!(product_error(a, a, product), 1.0);
        let third = 1.0 / 3.0;
        let product = third * 3.0;
        // 3 · fl(1/3) = 1 − 2⁻⁵⁴, which rounds to 1.
        assert_eq!(product_error(third, 3.0, product), -(2.0_f64.powi(-54)));
    }

    #[test]
    fn finds_the_exact_error_of_a_sum() {
        let tiny = 2.0_f64.powi(-60);
        assert_eq!(sum_error(1.0, tiny, 1.0 + tiny), tiny);
        assert_eq!(sum_error(tiny, 1.0, 1.0 + tiny), tiny);
        assert_eq!(fast_sum_error(1.0, tiny, 1.0 + tiny), tiny);
    }
}
