//! Linear prediction for a FLAC subframe, after `libFLAC`'s method: a
//! Tukey-windowed autocorrelation, the Levinson–Durbin recursion for the
//! coefficients of every order, and coefficients quantised with error
//! feedback to a precision chosen by the block's length.
//!
//! Only shifts from 0 to 15 are made: RFC 9639 gives the shift five signed
//! bits, but a negative shift is one decoders refuse (Symphonia among them).

/// The highest order FLAC names.
pub const MAX_ORDER: usize = 32;

/// The largest shift a coefficient set may take.
const MAX_SHIFT: i32 = 15;

/// The fraction of a block the Tukey window tapers over, `libFLAC`'s default.
const TUKEY_TAPER: f64 = 0.5;

/// The coefficients of every order up to the highest found, and the error
/// each leaves.
pub struct Coefficients {
    /// `orders[n - 1]` holds the `n` coefficients of order `n`, the first
    /// applied to the most recent sample.
    orders: [[f64; MAX_ORDER]; MAX_ORDER],
    errors: [f64; MAX_ORDER],
    /// The highest order the recursion reached before the error vanished.
    pub highest: usize,
}

impl Coefficients {
    /// The coefficients of order `order`.
    #[must_use]
    pub fn of(&self, order: usize) -> &[f64] {
        &self.orders[order - 1][..order]
    }

    /// The order whose residual `libFLAC` expects to take the fewest bits
    /// over a block of `frames` frames, each coefficient costing
    /// `overhead` bits more.
    #[must_use]
    #[allow(
        clippy::cast_precision_loss,
        reason = "block lengths and orders far below 2^52"
    )]
    pub fn expected_best(&self, frames: usize, overhead: u32) -> usize {
        let scale = 0.5 / frames as f64;
        let mut best = (1, f64::INFINITY);
        for order in 1..=self.highest {
            let error = self.errors[order - 1];
            let per_sample = if error > 0.0 {
                (0.5 * (scale * error).log2()).max(0.0)
            } else {
                0.0
            };
            let bits = per_sample * (frames - order) as f64 + order as f64 * f64::from(overhead);
            if bits < best.1 {
                best = (order, bits);
            }
        }
        best.0
    }
}

/// The Tukey window of `length` frames, written into `window`.
#[allow(clippy::cast_precision_loss, reason = "block lengths far below 2^52")]
pub fn tukey(length: usize, window: &mut Vec<f64>) {
    window.clear();
    window.resize(length, 1.0);
    let taper = (TUKEY_TAPER / 2.0 * length as f64).floor() - 1.0;
    if taper < 1.0 {
        return;
    }
    for (index, weight) in window.iter_mut().enumerate() {
        let position = index as f64;
        let mirrored = (length - 1 - index) as f64;
        if position <= taper {
            *weight = 0.5 - 0.5 * (std::f64::consts::PI * position / taper).cos();
        } else if mirrored <= taper {
            *weight = 0.5 - 0.5 * (std::f64::consts::PI * mirrored / taper).cos();
        }
    }
}

/// The coefficients of orders 1 to `highest` predicting `signal`, which is
/// already windowed; `None` for a signal of no energy.
#[must_use]
pub fn coefficients(signal: &[f64], highest: usize) -> Option<Coefficients> {
    let highest = highest.min(MAX_ORDER).min(signal.len().saturating_sub(1));
    let mut autocorrelation = [0.0f64; MAX_ORDER + 1];
    for (lag, value) in autocorrelation.iter_mut().enumerate().take(highest + 1) {
        *value = signal[lag..]
            .iter()
            .zip(signal)
            .map(|(later, earlier)| later * earlier)
            .sum();
    }
    if autocorrelation[0] <= 0.0 || highest == 0 {
        return None;
    }
    let mut result = Coefficients {
        orders: [[0.0; MAX_ORDER]; MAX_ORDER],
        errors: [0.0; MAX_ORDER],
        highest: 0,
    };
    let mut error = autocorrelation[0];
    let mut lpc = [0.0f64; MAX_ORDER];
    for order in 0..highest {
        let mut reflection = -autocorrelation[order + 1];
        for index in 0..order {
            reflection -= lpc[index] * autocorrelation[order - index];
        }
        reflection /= error;
        lpc[order] = reflection;
        for index in 0..order / 2 {
            let earlier = lpc[index];
            lpc[index] += reflection * lpc[order - 1 - index];
            lpc[order - 1 - index] += reflection * earlier;
        }
        if order % 2 == 1 {
            lpc[order / 2] += lpc[order / 2] * reflection;
        }
        error *= 1.0 - reflection * reflection;
        for (coefficient, value) in result.orders[order].iter_mut().zip(&lpc[..=order]) {
            *coefficient = -value;
        }
        result.errors[order] = error;
        result.highest = order + 1;
        if error <= 0.0 || !error.is_finite() {
            break;
        }
    }
    Some(result)
}

/// The precision `libFLAC` gives the coefficients of a block of `frames`,
/// below the field's limit of 15 (its sixteenth value is reserved).
#[must_use]
pub const fn precision(frames: usize) -> u32 {
    match frames {
        0..=192 => 7,
        193..=384 => 8,
        385..=576 => 9,
        577..=1_152 => 10,
        1_153..=2_304 => 11,
        2_305..=4_608 => 12,
        _ => 13,
    }
}

/// Quantised coefficients and their shift.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quantised {
    /// Each of at most 15 bits, the precision's limit.
    pub coefficients: [i16; MAX_ORDER],
    pub order: usize,
    pub precision: u32,
    pub shift: u32,
}

/// `coefficients` quantised to `precision` bits each, with error feedback,
/// or `None` where they are all zero or need a negative shift.
#[must_use]
pub fn quantise(coefficients: &[f64], precision: u32) -> Option<Quantised> {
    let largest = coefficients.iter().fold(0.0f64, |largest, coefficient| {
        largest.max(coefficient.abs())
    });
    if !(largest.is_normal() && largest > 0.0) {
        return None;
    }
    // The exponent `frexp` gives: largest = m · 2^exponent, m in [0.5, 1),
    // so the largest scaled by 2^shift is below 2^(precision - 1).
    let exponent = i32::try_from((largest.to_bits() >> 52) & 0x7ff).ok()? - 1022;
    let shift = (i32::try_from(precision).ok()? - 1 - exponent).min(MAX_SHIFT);
    let shift = u32::try_from(shift).ok()?;
    let limit = 1i16 << (precision - 1);
    let mut quantised = Quantised {
        coefficients: [0; MAX_ORDER],
        order: coefficients.len(),
        precision,
        shift,
    };
    let scale = f64::from(1u32 << shift);
    let mut error = 0.0;
    for (into, &coefficient) in quantised.coefficients.iter_mut().zip(coefficients) {
        error += coefficient * scale;
        #[allow(
            clippy::cast_possible_truncation,
            reason = "rounded and clamped to the precision at once"
        )]
        let rounded = error.round().clamp(f64::from(-limit), f64::from(limit - 1)) as i16;
        error -= f64::from(rounded);
        *into = rounded;
    }
    Some(quantised)
}

/// The residual of `signal` after the predictor `quantised`, from its
/// warm-up on, into `residual`; `false` where a prediction or a residual
/// falls outside 32 bits, which RFC 9639 does not allow and a decoder that
/// predicts in 32 bits would get wrong.
pub fn residual(signal: &[i64], quantised: &Quantised, residual: &mut Vec<i64>) -> bool {
    let order = quantised.order;
    let coefficients = &quantised.coefficients[..order];
    residual.clear();
    for index in order..signal.len() {
        let prediction = coefficients
            .iter()
            .zip(signal[index - order..index].iter().rev())
            .map(|(&coefficient, sample)| i64::from(coefficient) * sample)
            .sum::<i64>()
            >> quantised.shift;
        let value = signal[index] - prediction;
        if i32::try_from(prediction).is_err() || i32::try_from(value).is_err() {
            return false;
        }
        residual.push(value);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{coefficients, quantise, residual, tukey};

    #[test]
    fn predicts_a_sine_almost_exactly() {
        #[allow(clippy::cast_possible_truncation, reason = "a sine of 2^20")]
        let signal: Vec<i64> = (0..1_024)
            .map(|index| ((f64::from(index) * 0.05).sin() * 1_048_576.0).round() as i64)
            .collect();
        let mut window = Vec::new();
        tukey(signal.len(), &mut window);
        #[allow(clippy::cast_precision_loss, reason = "samples of 21 bits")]
        let windowed: Vec<f64> = signal
            .iter()
            .zip(&window)
            .map(|(&sample, weight)| sample as f64 * weight)
            .collect();
        let found = coefficients(&windowed, 8).expect("a signal of energy");
        let quantised = quantise(found.of(2), 12).expect("quantisable");
        let mut out = Vec::new();
        assert!(residual(&signal, &quantised, &mut out));
        // Coefficients of 12 bits leave an error of about 2^-10 of the
        // amplitude; the signal itself swings by 2^20.
        assert!(out.iter().all(|value| value.abs() < 4_096), "{out:?}");
    }

    #[test]
    fn refuses_zero_coefficients_and_out_of_range_predictions() {
        assert_eq!(quantise(&[0.0, 0.0], 12), None);
        let doubling = quantise(&[2.0], 12).expect("quantisable");
        let mut out = Vec::new();
        assert!(!residual(
            &[i64::from(i32::MAX), i64::from(i32::MAX)],
            &doubling,
            &mut out
        ));
    }
}
