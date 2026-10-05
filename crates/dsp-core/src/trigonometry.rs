//! The cosine and tangent of an angle in turns, and the angle in turns of a
//! point: the trigonometry beyond [`crate::sine_of_turns`].
//!
//! Each reduces its argument with subtractions that Sterbenz's lemma makes
//! exact, as the sine does, so none is a sine of `turns + 1/4`, whose addition
//! would round. The cosine needs a polynomial of its own near the turns where
//! it is ±1: there `1/4 − r` would round, and the sine polynomial's argument
//! must be exact.

use crate::exact::{fast_sum_error, product_error};
use crate::turns::{sine_of_reduced, sine_of_turns};

/// The coefficients of `cos(2πt)`, lowest power first: `(-1)^k (2π)^(2k) / (2k)!`.
///
/// Summed to `t¹⁸` over `|t| ≤ 1/8`, where the next term is below 10⁻²⁰.
/// Written as the shortest decimal that parses to each `f64`, so the
/// TypeScript reference path, which parses the same text, holds the same bits.
const COSINE_COEFFICIENTS: [f64; 10] = [
    1.0,
    -19.739_208_802_178_716,
    64.939_394_022_668_3,
    -85.456_817_206_693_73,
    60.244_641_371_876_66,
    -26.426_256_783_374_4,
    7.903_536_371_318_469,
    -1.714_390_711_088_672,
    0.282_005_968_455_791_23,
    -0.036_382_841_142_545_67,
];

/// The coefficients of `atan(t) / 2π`, lowest power first:
/// `(-1)^n / ((2n + 1) · 2π)`, the first of them `1 / 2π`.
///
/// Summed to `t⁵¹` over `|t| ≤ 1/2`, where the next term is below 2⁻⁵⁷ of the
/// sum. Written as the shortest decimal that parses to each `f64`.
const ARCTANGENT_COEFFICIENTS: [f64; 26] = [
    0.159_154_943_091_895_35,
    -0.053_051_647_697_298_45,
    0.031_830_988_618_379_07,
    -0.022_736_420_441_699_334,
    0.017_683_882_565_766_147,
    -0.014_468_631_190_172_302,
    0.012_242_687_930_145_796,
    -0.010_610_329_539_459_689,
    0.009_362_055_475_993_843,
    -0.008_376_575_952_205_017,
    0.007_578_806_813_899_778,
    -0.006_919_780_134_430_232,
    0.006_366_197_723_675_813,
    -0.005_894_627_521_922_049,
    0.005_488_101_485_927_425_5,
    -0.005_134_030_422_319_204,
    0.004_822_877_063_390_768,
    -0.004_547_284_088_339_867,
    0.004_301_484_948_429_603_5,
    -0.004_080_895_976_715_265,
    0.003_881_827_880_290_130_3,
    -0.003_701_277_746_323_147,
    0.003_536_776_513_153_229_7,
    -0.003_386_275_384_933_943_4,
    0.003_248_060_063_099_904_7,
    -0.003_120_685_158_664_614,
];

/// `2⁵¹²` and `2⁻⁵¹²`, between which the arctangent works, so neither its sum
/// nor Veltkamp's split can overflow and no product it splits underflows.
const TWO_TO_512: f64 = 1.340_780_792_994_259_7e154;
const TWO_TO_MINUS_512: f64 = 7.458_340_731_200_207e-155;

/// `cos(2π · turns)`, identical on every platform.
///
/// Exact for any finite input whose magnitude is below 2⁵², as the sine is;
/// NaN for NaN and the infinities. With `r = turns − ⌊turns⌋`, in `[0, 1)`,
/// the octant `r` falls in chooses one of:
///
/// - `r < 1/8`: `cosine_of_reduced(r)`;
/// - `r ≤ 3/8`: `sine_of_reduced(1/4 − r)`;
/// - `r < 5/8`: `−cosine_of_reduced(r − 1/2)`;
/// - `r ≤ 7/8`: `sine_of_reduced(r − 3/4)`;
/// - otherwise `cosine_of_reduced(r − 1)`,
///
/// each subtraction exact by Sterbenz's lemma, so the cosine is exactly 1,
/// 0, −1 and 0 at the quarter turns, and at every odd eighth it is the sine
/// polynomial at ±1/8, as the sine is, so the two agree there in magnitude.
#[must_use]
pub fn cosine_of_turns(turns: f64) -> f64 {
    let r = turns - turns.floor();
    if r < 0.125 {
        cosine_of_reduced(r)
    } else if r <= 0.375 {
        sine_of_reduced(0.25 - r)
    } else if r < 0.625 {
        -cosine_of_reduced(r - 0.5)
    } else if r <= 0.875 {
        sine_of_reduced(r - 0.75)
    } else {
        cosine_of_reduced(r - 1.0)
    }
}

/// `tan(2π · turns)`, identical on every platform: `sine_of_turns(turns)`
/// divided by `cosine_of_turns(turns)`, in that order.
///
/// At an odd quarter turn the cosine is exactly `+0`, so the tangent is
/// infinite with the sine's sign: `+∞` at 1/4 and `−∞` at 3/4. Exactly 1 at
/// an eighth, where the two are equal.
#[must_use]
pub fn tangent_of_turns(turns: f64) -> f64 {
    sine_of_turns(turns) / cosine_of_turns(turns)
}

/// `cos(2πt)` for `t` in `[−1/8, 1/8]`: Horner's rule in `t²`, highest
/// coefficient first.
fn cosine_of_reduced(t: f64) -> f64 {
    let square = t * t;
    let mut sum = COSINE_COEFFICIENTS[9];
    for coefficient in COSINE_COEFFICIENTS[..9].iter().rev() {
        sum = sum * square + coefficient;
    }
    sum
}

/// The angle of the point `(x, y)` from the positive x-axis, in turns, in
/// `(−1/2, 1/2]`: `atan2(y, x) / 2π`, identical on every platform.
///
/// - NaN if either coordinate is NaN;
/// - exactly 0, ±1/8, ±1/4, ±3/8 and 1/2 on the axes and the diagonals,
///   infinite coordinates included: `(±∞, ±∞)` is a diagonal;
/// - a zero `y` keeps its sign where `x` is above zero or `+0`; the negative
///   x-axis, `x` below zero or `−0` with a zero `y`, is `+1/2` whatever the
///   sign of `y`, so the range is half open, and so is any result that
///   rounds to −1/2;
/// - `(±0, ±0)` is `±0` where `x` is `+0` and `1/2` where it is `−0`.
///
/// Otherwise, with `a = |x|`, `b = |y|`, the larger of them `big` and the
/// smaller `small`, both scaled by 2⁻⁵¹² where `big ≥ 2⁵¹²` and by 2⁵¹² where
/// `big < 2⁻⁵¹²`, the angle from the nearer axis, `[0, 1/8]`, is `base + inner`:
///
/// - where `small + small ≤ big`, `base = 0`, `t = small / big`,
///   `tₗ = ((small − t·big) − error(t·big)) / big`, and
///   `inner = t · P(t · t) + tₗ · P₀`;
/// - otherwise `base = 1/8`, `n = small − big`, exact, `d = small + big`,
///   `dₗ = small − (d − big)`, `u = n / d`,
///   `uₗ = (((n − u·d) − error(u·d)) − u · dₗ) / d`, and
///   `inner = u · P(u · u) + uₗ · P₀`,
///
/// where `P` is Horner's rule over the arctangent coefficients, highest first,
/// and `P₀` the first of them. The answer is then one rounding of
/// `(base, 1/4 − base, 1/2 − base or 1/4 + base) ± inner`, by the octant the
/// point is in, negated where `y` is below zero or `−0`.
#[must_use]
#[allow(
    clippy::float_cmp,
    reason = "the diagonals and the half turn are exact values, and stated cases"
)]
pub fn arctangent_turns(y: f64, x: f64) -> f64 {
    if y.is_nan() || x.is_nan() {
        return f64::NAN;
    }
    let across = x.is_sign_negative();
    let (a, b) = (x.abs(), y.abs());
    let half_turn_side = if a.is_infinite() || b.is_infinite() || (a == 0.0 && b == 0.0) {
        let first_quadrant = if b == 0.0 {
            0.0
        } else if a == b {
            0.125
        } else if b.is_infinite() {
            0.25
        } else {
            0.0
        };
        if across {
            0.5 - first_quadrant
        } else {
            first_quadrant
        }
    } else {
        angle_of_finite(b, a, across)
    };
    if y.is_sign_negative() && half_turn_side != 0.5 {
        -half_turn_side
    } else {
        half_turn_side
    }
}

/// The angle in turns, in `[0, 1/2]`, of a point `(±a, b)` with finite
/// coordinates `a, b ≥ 0`, not both zero, `across` saying whether its x is
/// on the negative side.
#[allow(
    clippy::many_single_char_names,
    reason = "the names are the stated operations', letter for letter"
)]
fn angle_of_finite(b: f64, a: f64, across: bool) -> f64 {
    let from_y_axis = b > a;
    let (mut big, mut small) = if from_y_axis { (b, a) } else { (a, b) };
    if big >= TWO_TO_512 {
        big *= TWO_TO_MINUS_512;
        small *= TWO_TO_MINUS_512;
    } else if big < TWO_TO_MINUS_512 {
        big *= TWO_TO_512;
        small *= TWO_TO_512;
    }
    let (base, inner) = if small + small <= big {
        let t = small / big;
        let tb = t * big;
        let t_low = ((small - tb) - product_error(t, big, tb)) / big;
        (
            0.0,
            t * arctangent_series(t * t) + t_low * ARCTANGENT_COEFFICIENTS[0],
        )
    } else {
        let n = small - big;
        let d = small + big;
        let d_low = fast_sum_error(big, small, d);
        let u = n / d;
        let ud = u * d;
        let u_low = (((n - ud) - product_error(u, d, ud)) - u * d_low) / d;
        (
            0.125,
            u * arctangent_series(u * u) + u_low * ARCTANGENT_COEFFICIENTS[0],
        )
    };
    match (from_y_axis, across) {
        (false, false) => base + inner,
        (false, true) => (0.5 - base) - inner,
        (true, false) => (0.25 - base) - inner,
        (true, true) => (0.25 + base) + inner,
    }
}

/// `Σ cₙ zⁿ` over the arctangent coefficients, by Horner's rule, highest first.
fn arctangent_series(z: f64) -> f64 {
    let mut sum = ARCTANGENT_COEFFICIENTS[25];
    for coefficient in ARCTANGENT_COEFFICIENTS[..25].iter().rev() {
        sum = sum * z + coefficient;
    }
    sum
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use std::f64::consts::TAU;

    use super::{arctangent_turns, cosine_of_turns, tangent_of_turns};
    use crate::turns::sine_of_turns;
    use crate::ulps::ulps_between;

    #[test]
    fn is_exact_at_the_quarter_and_eighth_turns() {
        assert_eq!(cosine_of_turns(0.0), 1.0);
        assert_eq!(cosine_of_turns(-0.0), 1.0);
        assert_eq!(cosine_of_turns(0.25).to_bits(), 0.0_f64.to_bits());
        assert_eq!(cosine_of_turns(0.5), -1.0);
        assert_eq!(cosine_of_turns(0.75).to_bits(), 0.0_f64.to_bits());
        assert_eq!(cosine_of_turns(3.0), 1.0);
        for eighth in [0.125, 0.375, 0.625, 0.875] {
            assert_eq!(cosine_of_turns(eighth).abs(), sine_of_turns(eighth).abs());
        }
        assert_eq!(tangent_of_turns(0.125), 1.0);
        assert_eq!(tangent_of_turns(0.0).to_bits(), 0.0_f64.to_bits());
        assert_eq!(tangent_of_turns(0.25), f64::INFINITY);
        assert_eq!(tangent_of_turns(0.75), f64::NEG_INFINITY);
        for turns in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(cosine_of_turns(turns).is_nan());
            assert!(tangent_of_turns(turns).is_nan());
        }
    }

    #[test]
    fn agrees_with_the_platform_cosine_and_tangent() {
        // The platform's are not canonical, but they are close, and a wrong
        // coefficient or reduction would miss them by far more than this.
        for step in 0..100_000 {
            let turns = f64::from(step) / 100_000.0 * 3.0 - 1.5;
            let radians = turns * TAU;
            let difference = (cosine_of_turns(turns) - radians.cos()).abs();
            assert!(
                difference < 4.0e-15,
                "cos at {turns} turns is out by {difference}"
            );
            let expected = radians.tan();
            if expected.abs() < 1.0e3 {
                let relative = (tangent_of_turns(turns) - expected).abs() / expected.abs().max(1.0);
                assert!(
                    relative < 1.0e-12,
                    "tan at {turns} turns is out by {relative}"
                );
            }
        }
        // Small arguments, where the cosine's own polynomial answers and the
        // platform's `2π · t` is accurate: within an ulp.
        for step in 0..10_000 {
            let turns = f64::from(step) * 1.25e-5;
            assert!(ulps_between(cosine_of_turns(turns), (turns * TAU).cos()) <= 1);
        }
    }

    #[test]
    fn gives_the_axes_and_diagonals_exactly_with_their_signed_zeros() {
        let inf = f64::INFINITY;
        let cases = [
            (0.0, 1.0, 0.0),
            (-0.0, 1.0, -0.0),
            (0.0, -1.0, 0.5),
            (-0.0, -1.0, 0.5),
            (0.0, 0.0, 0.0),
            (-0.0, 0.0, -0.0),
            (0.0, -0.0, 0.5),
            (-0.0, -0.0, 0.5),
            (1.0, 0.0, 0.25),
            (1.0, -0.0, 0.25),
            (-1.0, 0.0, -0.25),
            (3.0, 3.0, 0.125),
            (-3.0, 3.0, -0.125),
            (3.0, -3.0, 0.375),
            (-3.0, -3.0, -0.375),
            (1.0e-300, 1.0e-300, 0.125),
            (1.0e300, -1.0e300, 0.375),
            (inf, inf, 0.125),
            (-inf, -inf, -0.375),
            (inf, 1.0, 0.25),
            (1.0, inf, 0.0),
            (-1.0, inf, -0.0),
            (1.0, -inf, 0.5),
            (-1.0, -inf, 0.5),
            (-inf, 0.0, -0.25),
        ];
        for (y, x, expected) in cases {
            let angle = arctangent_turns(y, x);
            assert_eq!(
                angle.to_bits(),
                f64::to_bits(expected),
                "atan2({y}, {x}) = {angle}"
            );
        }
        assert!(arctangent_turns(f64::NAN, 1.0).is_nan());
        assert!(arctangent_turns(1.0, f64::NAN).is_nan());
        // Below the negative x-axis by less than the result can show.
        assert_eq!(arctangent_turns(-1.0e-300, -1.0), 0.5);
    }

    #[test]
    fn agrees_with_the_platform_arctangent_to_within_two_ulps() {
        // The platform's atan2 divided by 2π rounds twice more, so it is
        // itself up to about one and a half units out.
        for i in 0..1_000 {
            let angle = f64::from(i) / 1_000.0 * TAU - std::f64::consts::PI + 1.0e-3;
            let (y, x) = (angle.sin() * 3.7, angle.cos() * 3.7);
            let expected = y.atan2(x) / TAU;
            assert!(
                ulps_between(arctangent_turns(y, x), expected) <= 2,
                "atan2({y}, {x})"
            );
        }
        for (y, x) in [
            (1.0e-310_f64, 1.0_f64),
            (1.0e300, 3.0e300),
            (2.0e-320, 1.0e-320),
            (1.0, 1.0e-300),
        ] {
            let expected = y.atan2(x) / TAU;
            assert!(
                ulps_between(arctangent_turns(y, x), expected) <= 2,
                "atan2({y}, {x})"
            );
        }
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        let bits: Vec<u64> = GOLDEN_TURNS
            .iter()
            .flat_map(|turns| {
                [
                    cosine_of_turns(*turns).to_bits(),
                    tangent_of_turns(*turns).to_bits(),
                ]
            })
            .chain(
                GOLDEN_POINTS
                    .iter()
                    .map(|(y, x)| arctangent_turns(*y, *x).to_bits()),
            )
            .collect();
        assert_eq!(
            bits, GOLDEN_TRIGONOMETRY_BITS,
            "trigonometry bits changed: {bits:#x?}"
        );
    }

    const GOLDEN_TURNS: [f64; 5] = [0.1, 0.3, 0.6, -0.2, 12.345];
    const GOLDEN_POINTS: [(f64, f64); 5] = [
        (1.0, 2.0),
        (-3.0, -4.0),
        (0.3, -0.1),
        (5.0, 4.9),
        (-1.0e-5, 7.0),
    ];

    /// The cosine and tangent of each of the turns, then the angle of each point.
    const GOLDEN_TRIGONOMETRY_BITS: [u64; 15] = [
        0x3fe9_e377_9b97_f4a8,
        0x3fe7_3fd6_1d9d_f543,
        0xbfd3_c6ef_372f_e94e,
        0xc008_9f18_8bdc_d7b0,
        0xbfe9_e377_9b97_f4a8,
        0x3fe7_3fd6_1d9d_f540,
        0x3fd3_c6ef_372f_e954,
        0xc008_9f18_8bdc_d7a8,
        0xbfe1_fc96_47b0_0108,
        0xbff7_8b14_baaf_8d93,
        0x3fb2_e405_1d9d_f309,
        0xbfd9_7202_8ece_f984,
        0x3fd3_46fe_b898_833e,
        0x3fc0_34ad_4878_0d26,
        0xbe8e_842c_b125_000c,
    ];
}
