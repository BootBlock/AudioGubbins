//! The Kaiser window and the Bessel function it is built from.
//!
//! The window the canonical resampler shapes its filter with. Its Bessel
//! function is summed from its power series, so it needs no transcendental
//! function and gives the same bits everywhere.

/// The last term the Bessel series adds, as a share of the sum: `2⁻⁶⁰`, past
/// which a term can no longer change an `f64` sum.
const SERIES_TOLERANCE: f64 = 1.0 / 1_152_921_504_606_846_976.0;

/// The most terms the series is summed to, far past what any argument the
/// resampler gives needs, so a bad argument cannot loop for ever.
const MOST_TERMS: u32 = 500;

/// The modified Bessel function of the first kind, of order zero.
///
/// `I₀(x) = Σ ((x/2)^k / k!)²`, each term the last times `(x/2)² / k²`,
/// summed from the first until a term falls below `2⁻⁶⁰` of the sum.
#[must_use]
pub fn bessel_i0(x: f64) -> f64 {
    let quarter_square = x * x / 4.0;
    let mut term = 1.0;
    let mut sum = 1.0;
    let mut k: u32 = 1;
    while k <= MOST_TERMS {
        let kf = f64::from(k);
        term = term * quarter_square / (kf * kf);
        sum += term;
        if term <= sum * SERIES_TOLERANCE {
            break;
        }
        k += 1;
    }
    sum
}

/// The Kaiser window of shape `beta` at `position`, where `-1` and `1` are its
/// ends and `0` its centre, divided by `I₀(beta)` so its centre is one.
///
/// Zero outside `[-1, 1]`.
#[must_use]
pub fn kaiser(position: f64, beta: f64, bessel_of_beta: f64) -> f64 {
    let inside = 1.0 - position * position;
    if inside < 0.0 {
        return 0.0;
    }
    bessel_i0(beta * inside.sqrt()) / bessel_of_beta
}

#[cfg(test)]
mod tests {
    // Each exact comparison here is the point: the canonical rule promises
    // these bits, not values near them.
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use super::{bessel_i0, kaiser};

    #[test]
    fn is_one_at_zero_and_matches_known_values() {
        assert_eq!(bessel_i0(0.0), 1.0);
        // I0(1) = 1.2660658777520083..., I0(10) = 2815.716628466254...
        assert!((bessel_i0(1.0) - 1.266_065_877_752_008_3).abs() < 1.0e-15);
        assert!((bessel_i0(10.0) / 2_815.716_628_466_254 - 1.0).abs() < 1.0e-14);
    }

    #[test]
    fn peaks_at_its_centre_and_vanishes_past_its_ends() {
        let beta = 10.0;
        let normaliser = bessel_i0(beta);
        assert_eq!(kaiser(0.0, beta, normaliser), 1.0);
        assert!(kaiser(0.5, beta, normaliser) < 1.0);
        assert_eq!(kaiser(1.5, beta, normaliser), 0.0);
        assert_eq!(
            kaiser(-0.3, beta, normaliser),
            kaiser(0.3, beta, normaliser)
        );
    }
}
