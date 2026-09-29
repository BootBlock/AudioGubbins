//! The sine of an angle measured in turns.
//!
//! An angle in turns (one turn is 2π radians) reduces to a quarter turn with
//! exact subtractions alone, where an angle in radians needs 2π, which no
//! floating-point number holds exactly. The quarter is then evaluated by the
//! Taylor series of `sin(2πt)` to the 23rd power, whose next term is below
//! 10⁻²⁰ for `|t| ≤ 1/4`, well under half an `f64` ulp of any result that
//! could round differently.

/// The coefficients of `sin(2πt)`, lowest power first: `(-1)^k (2π)^(2k+1) / (2k+1)!`.
///
/// Written as the shortest decimal that parses to each `f64`, so the
/// TypeScript reference path, which parses the same text, holds the same bits.
const SINE_COEFFICIENTS: [f64; 12] = [
    std::f64::consts::TAU,
    -41.341_702_240_399_76,
    81.605_249_276_075_06,
    -76.705_859_753_061_39,
    42.058_693_944_897_655,
    -15.094_642_576_822_99,
    3.819_952_584_848_282,
    -0.718_122_301_778_500_6,
    0.104_229_162_208_139_84,
    -0.012_031_585_942_120_627,
    0.001_130_923_748_251_796_3,
    -8.823_533_599_243_006e-5,
];

/// `sin(2π · turns)`, identical on every platform.
///
/// Exact for any finite input whose magnitude is below 2⁵², where the
/// fractional part of a turn is exact. The reduction:
///
/// 1. `r = turns − ⌊turns⌋`, in `[0, 1)`;
/// 2. to `t` in `[−1/4, 1/4]`, by `sin(2πr) = sin(2π(1/2 − r)) = sin(2π(r − 1))`,
///    each subtraction exact by Sterbenz's lemma;
/// 3. Horner's rule in `t²`, highest coefficient first, then times `t`.
#[must_use]
pub fn sine_of_turns(turns: f64) -> f64 {
    let r = turns - turns.floor();
    let t = if r < 0.25 {
        r
    } else if r < 0.75 {
        0.5 - r
    } else {
        r - 1.0
    };
    let square = t * t;
    let mut sum = SINE_COEFFICIENTS[11];
    for coefficient in SINE_COEFFICIENTS[..11].iter().rev() {
        sum = sum * square + coefficient;
    }
    sum * t
}

#[cfg(test)]
mod tests {
    // Each exact comparison here is the point: the canonical rule promises
    // these bits, not values near them.
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use super::sine_of_turns;

    #[test]
    fn is_exact_at_the_quarter_turns() {
        assert_eq!(sine_of_turns(0.0).to_bits(), 0.0_f64.to_bits());
        assert_eq!(sine_of_turns(0.5), 0.0);
        assert!((sine_of_turns(0.25) - 1.0).abs() <= f64::EPSILON);
        assert!((sine_of_turns(0.75) + 1.0).abs() <= f64::EPSILON);
    }

    #[test]
    fn agrees_with_the_platform_sine_to_within_a_few_ulps() {
        // The platform sine is not canonical, but it is close, and a wrong
        // coefficient or reduction would miss it by far more than this.
        for step in 0..10_000 {
            let turns = f64::from(step) / 10_000.0 * 3.0 - 1.5;
            let expected = (turns * std::f64::consts::TAU).sin();
            let difference = (sine_of_turns(turns) - expected).abs();
            assert!(
                difference < 4.0e-15,
                "at {turns} turns the difference is {difference}"
            );
        }
    }

    #[test]
    fn repeats_every_turn() {
        for step in 0..100 {
            let turns = f64::from(step) / 100.0;
            let one_on = sine_of_turns(turns + 1.0);
            assert!((sine_of_turns(turns) - one_on).abs() < 1.0e-15);
        }
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        // The same inputs and bits are asserted by the TypeScript reference
        // tests; a difference in either language fails one of them.
        let bits: Vec<u64> = [0.1, 0.3, 0.6, 0.9, -0.2, 12.345]
            .iter()
            .map(|turns| sine_of_turns(*turns).to_bits())
            .collect();
        assert_eq!(bits, GOLDEN_SINE_BITS, "sine bits changed: {bits:#x?}");
    }

    /// `sin(2π · t)` for t = 0.1, 0.3, 0.6, 0.9, −0.2 and 12.345.
    const GOLDEN_SINE_BITS: [u64; 6] = [
        0x3fe2_cf23_0475_5a5e,
        0x3fee_6f0e_1344_54ff,
        0xbfe2_cf23_0475_5a5c,
        0xbfe2_cf23_0475_5a5c,
        0xbfee_6f0e_1344_54fe,
        0x3fea_7771_ae35_50f5,
    ];
}
