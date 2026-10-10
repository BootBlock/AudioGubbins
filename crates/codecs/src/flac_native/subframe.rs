//! One channel's subframe (RFC 9639, section 9.2): planned by trying every
//! predictor the search allows and keeping the smallest, then written.
//!
//! The candidates are a constant, the samples verbatim, the fixed
//! predictors of orders 0 to 4 and, where the search allows, linear
//! prediction. Bits every sample shares at the bottom are taken out first
//! ("wasted bits"). A predictor whose prediction or residual leaves 32 bits
//! is not a candidate, so verbatim is always one.

use super::bits::BitWriter;
use super::lpc::{self, Quantised};
use super::residual::{self, ResidualPlan};

/// The highest fixed predictor.
const MAX_FIXED_ORDER: usize = 4;

/// How hard a subframe's predictor is searched for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Search {
    /// The highest linear prediction order, 0 for none.
    pub lpc_limit: usize,
    /// Whether every linear prediction order is tried, rather than the one
    /// the prediction error suggests.
    pub every_lpc: bool,
    /// The finest partition order of the residual.
    pub partition_limit: u32,
}

/// What predicts a subframe's samples.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Predictor {
    Constant,
    Verbatim,
    Fixed(usize),
    Lpc(Quantised),
}

/// A subframe as it will be written, and its size.
#[derive(Clone, Copy, Debug)]
pub struct SubframePlan {
    predictor: Predictor,
    /// Low bits every sample shares as zeros, taken out before prediction.
    wasted: u32,
    residual: Option<ResidualPlan>,
    /// The bits the subframe takes, at most.
    pub bits: u64,
}

/// The residual of the fixed predictor of `order`, from its warm-up on,
/// into `residual`; `false` where one leaves 32 bits.
fn fixed_residual(signal: &[i64], order: usize, residual: &mut Vec<i64>) -> bool {
    residual.clear();
    for index in order..signal.len() {
        let at = |back: usize| signal[index - back];
        let value = match order {
            0 => at(0),
            1 => at(0) - at(1),
            2 => at(0) - 2 * at(1) + at(2),
            3 => at(0) - 3 * at(1) + 3 * at(2) - at(3),
            _ => at(0) - 4 * at(1) + 6 * at(2) - 4 * at(3) + at(4),
        };
        if i32::try_from(value).is_err() {
            return false;
        }
        residual.push(value);
    }
    true
}

/// Plans and writes subframes, keeping its working buffers between frames.
#[derive(Default)]
pub struct SubframeCoder {
    /// The signal less its wasted bits.
    shifted: Vec<i64>,
    residual: Vec<i64>,
    window: Vec<f64>,
    windowed: Vec<f64>,
}

impl SubframeCoder {
    /// The smallest subframe of `signal`, whose samples fit `bits` bits.
    pub fn plan(&mut self, signal: &[i64], bits: u32, search: Search) -> SubframePlan {
        let frames = signal.len();
        if signal.iter().all(|&sample| sample == signal[0]) {
            return SubframePlan {
                predictor: Predictor::Constant,
                wasted: 0,
                residual: None,
                bits: 8 + u64::from(bits),
            };
        }
        // Not every sample is equal, so one is not zero.
        let wasted = signal
            .iter()
            .fold(0, |shared, &sample| shared | sample)
            .trailing_zeros()
            .min(bits - 1);
        let shifted_bits = bits - wasted;
        self.shifted.clear();
        self.shifted
            .extend(signal.iter().map(|&sample| sample >> wasted));
        let header = 8 + u64::from(wasted);
        let frame_count = frames as u64;
        let mut best = SubframePlan {
            predictor: Predictor::Verbatim,
            wasted,
            residual: None,
            bits: header + frame_count * u64::from(shifted_bits),
        };
        for order in 0..=MAX_FIXED_ORDER.min(frames - 1) {
            if !fixed_residual(&self.shifted, order, &mut self.residual) {
                continue;
            }
            let planned = residual::plan(&self.residual, frames, order, search.partition_limit);
            let bits = header + order as u64 * u64::from(shifted_bits) + planned.bits;
            if bits < best.bits {
                best = SubframePlan {
                    predictor: Predictor::Fixed(order),
                    wasted,
                    residual: Some(planned),
                    bits,
                };
            }
        }
        if let Some(lpc) = self.plan_lpc(shifted_bits, header, search) {
            if lpc.bits < best.bits {
                best = SubframePlan { wasted, ..lpc };
            }
        }
        best
    }

    /// The smallest linear prediction of the shifted signal, of samples of
    /// `bits` bits, the search allows.
    fn plan_lpc(&mut self, bits: u32, header: u64, search: Search) -> Option<SubframePlan> {
        let frames = self.shifted.len();
        if search.lpc_limit == 0 {
            return None;
        }
        lpc::tukey(frames, &mut self.window);
        self.windowed.clear();
        #[allow(
            clippy::cast_precision_loss,
            reason = "a sample of 32 bits is within an f64's 53"
        )]
        self.windowed.extend(
            self.shifted
                .iter()
                .zip(&self.window)
                .map(|(&sample, weight)| sample as f64 * weight),
        );
        let found = lpc::coefficients(&self.windowed, search.lpc_limit)?;
        let precision = lpc::precision(frames);
        let orders = if search.every_lpc {
            1..=found.highest
        } else {
            let order = found.expected_best(frames, bits + precision);
            order..=order
        };
        let mut best: Option<SubframePlan> = None;
        for order in orders {
            let Some(quantised) = lpc::quantise(found.of(order), precision) else {
                continue;
            };
            if !lpc::residual(&self.shifted, &quantised, &mut self.residual) {
                continue;
            }
            let planned = residual::plan(&self.residual, frames, order, search.partition_limit);
            let coefficients = order as u64 * u64::from(bits + precision);
            let total = header + coefficients + 4 + 5 + planned.bits;
            if best.is_none_or(|best| total < best.bits) {
                best = Some(SubframePlan {
                    predictor: Predictor::Lpc(quantised),
                    wasted: 0,
                    residual: Some(planned),
                    bits: total,
                });
            }
        }
        best
    }

    /// Writes `signal`, of samples of `bits` bits, as `plan` codes it.
    pub fn write(
        &mut self,
        plan: &SubframePlan,
        signal: &[i64],
        bits: u32,
        writer: &mut BitWriter,
    ) {
        let kind = match plan.predictor {
            Predictor::Constant => 0b00_0000,
            Predictor::Verbatim => 0b00_0001,
            Predictor::Fixed(order) => 0b00_1000 | order as u64,
            Predictor::Lpc(quantised) => 0b10_0000 | (quantised.order as u64 - 1),
        };
        writer.put(0, 1);
        writer.put(kind, 6);
        if plan.wasted == 0 {
            writer.put(0, 1);
        } else {
            writer.put(1, 1);
            writer.put_unary(u64::from(plan.wasted - 1));
        }
        if plan.predictor == Predictor::Constant {
            writer.put_signed(signal[0], bits);
            return;
        }
        let bits = bits - plan.wasted;
        self.shifted.clear();
        self.shifted
            .extend(signal.iter().map(|&sample| sample >> plan.wasted));
        let (order, fits) = match plan.predictor {
            Predictor::Fixed(order) => (
                order,
                fixed_residual(&self.shifted, order, &mut self.residual),
            ),
            Predictor::Lpc(quantised) => (
                quantised.order,
                lpc::residual(&self.shifted, &quantised, &mut self.residual),
            ),
            Predictor::Constant | Predictor::Verbatim => (self.shifted.len(), true),
        };
        // The plan was made from these samples, so the residual it measured
        // is the one recomputed here.
        debug_assert!(fits, "a planned predictor's residual fits 32 bits");
        // A predictor's warm-up, or every sample of a verbatim subframe.
        for &sample in &self.shifted[..order] {
            writer.put_signed(sample, bits);
        }
        if let Predictor::Lpc(quantised) = plan.predictor {
            writer.put(u64::from(quantised.precision - 1), 4);
            writer.put(u64::from(quantised.shift), 5);
            for &coefficient in &quantised.coefficients[..quantised.order] {
                writer.put_signed(i64::from(coefficient), quantised.precision);
            }
        }
        if let Some(planned) = plan.residual.as_ref() {
            residual::write(planned, &self.residual, self.shifted.len(), order, writer);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Predictor, Search, SubframeCoder};

    const SEARCH: Search = Search {
        lpc_limit: 8,
        every_lpc: false,
        partition_limit: 5,
    };

    #[test]
    fn chooses_constant_verbatim_fixed_or_wasted_bits_as_each_signal_asks() {
        let mut coder = SubframeCoder::default();
        let silence = coder.plan(&[0; 512], 32, SEARCH);
        assert_eq!(silence.predictor, Predictor::Constant);
        assert_eq!(silence.bits, 40);
        let ramp: Vec<i64> = (0..512)
            .map(|index| index * 1_000_000 - 256_000_000)
            .collect();
        let planned = coder.plan(&ramp, 32, SEARCH);
        assert!(matches!(
            planned.predictor,
            Predictor::Fixed(2..=4) | Predictor::Lpc(_)
        ));
        let shifted: Vec<i64> = (0..512)
            .map(|index| ((index * 7_919) % 1_001) << 8)
            .collect();
        assert_eq!(coder.plan(&shifted, 24, SEARCH).wasted, 8);
        let extremes: Vec<i64> = (0..512)
            .map(|index| {
                if index % 2 == 0 {
                    i64::from(i32::MIN)
                } else {
                    i64::from(i32::MAX)
                }
            })
            .collect();
        // Every predictor's residual of a full-scale square wave leaves 32
        // bits but order 0's, which is the samples themselves.
        let planned = coder.plan(&extremes, 32, SEARCH);
        assert!(matches!(
            planned.predictor,
            Predictor::Verbatim | Predictor::Fixed(0)
        ));
    }
}
