//! A linear predictor fitted to a block by Burg's method.
//!
//! Burg's method chooses each reflection coefficient to minimise the sum of
//! the forward and backward prediction errors' energies, which keeps every
//! coefficient's magnitude at most one, so the predictor is stable whatever
//! the block holds, and fits a short block better than the autocorrelation
//! method, which windows it.

/// The scratch of a fit of order `order` to blocks of a fixed length.
#[derive(Debug, Clone)]
pub(crate) struct Burg {
    forward: Vec<f64>,
    backward: Vec<f64>,
    previous: Vec<f64>,
}

impl Burg {
    /// Scratch for fits of `order` to blocks of `length` samples.
    pub(crate) fn new(order: usize, length: usize) -> Self {
        Self {
            forward: vec![0.0; length],
            backward: vec![0.0; length],
            previous: vec![0.0; order + 1],
        }
    }

    /// Writes the prediction-error filter of `block` to `coefficients`,
    /// `order + 1` of them, the first 1: the residual of sample `n` is
    /// `Σ coefficients[i] · x[n − i]`. `block` is the length the scratch was
    /// made for, longer than the order.
    ///
    /// With the forward and backward errors `f` and `b` both starting as the
    /// block, each order `m` from 0 takes, over `i` from `m + 1` to the end,
    /// `num = Σ f[i] · b[i − 1]` and `den = Σ ((f[i] · f[i]) + (b[i − 1] · b[i − 1]))`,
    /// and the reflection coefficient `k = (−2 · num) / den`, or 0 unless
    /// `den` is above zero. With `a` the coefficients before it,
    /// `aᵢ ← aᵢ + k · a₍ₘ₊₁₋ᵢ₎` for `i` from 1 to `m` and `a₍ₘ₊₁₎ ← k`. Then,
    /// for `i` from the end down to `m + 1`, `f[i] ← f[i] + k · b[i − 1]` and
    /// `b[i] ← b[i − 1] + k · f[i]`, both from the values before.
    pub(crate) fn fit(&mut self, block: &[f64], coefficients: &mut [f64]) {
        let length = block.len().min(self.forward.len());
        let order = coefficients.len() - 1;
        self.forward[..length].copy_from_slice(&block[..length]);
        self.backward[..length].copy_from_slice(&block[..length]);
        coefficients.fill(0.0);
        coefficients[0] = 1.0;
        for m in 0..order.min(length.saturating_sub(1)) {
            let mut numerator = 0.0;
            let mut denominator = 0.0;
            for i in m + 1..length {
                let (f, b) = (self.forward[i], self.backward[i - 1]);
                numerator += f * b;
                denominator += f * f + b * b;
            }
            let reflection = if denominator > 0.0 {
                (-2.0 * numerator) / denominator
            } else {
                0.0
            };
            self.previous[..=m].copy_from_slice(&coefficients[..=m]);
            for (i, coefficient) in coefficients.iter_mut().enumerate().take(m + 1).skip(1) {
                *coefficient = self.previous[i] + reflection * self.previous[m + 1 - i];
            }
            coefficients[m + 1] = reflection;
            for i in (m + 1..length).rev() {
                let (f, b) = (self.forward[i], self.backward[i - 1]);
                self.forward[i] = f + reflection * b;
                self.backward[i] = b + reflection * f;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "silence fits to exact zeros")]

    use super::Burg;
    use crate::signals::Noise;

    #[test]
    fn recovers_the_process_that_made_a_signal() {
        // x[n] = 1.6 x[n−1] − 0.8 x[n−2] + noise: the prediction-error filter
        // is [1, −1.6, 0.8], and the higher coefficients near zero.
        let mut noise = Noise::new(11);
        let mut signal = vec![0.0_f64; 8_192];
        for n in 2..signal.len() {
            signal[n] = 1.6 * signal[n - 1] - 0.8 * signal[n - 2] + 0.01 * noise.next();
        }
        let mut burg = Burg::new(4, signal.len());
        let mut coefficients = [0.0; 5];
        burg.fit(&signal, &mut coefficients);
        let expected = [1.0, -1.6, 0.8, 0.0, 0.0];
        for (index, (fitted, wanted)) in coefficients.iter().zip(expected).enumerate() {
            assert!((fitted - wanted).abs() < 0.02, "{index}: {coefficients:?}");
        }
    }

    #[test]
    fn fits_silence_and_nan_without_failing() {
        let mut burg = Burg::new(16, 64);
        let mut coefficients = [9.0; 17];
        burg.fit(&[0.0; 64], &mut coefficients);
        assert!((coefficients[0] - 1.0).abs() < f64::EPSILON);
        assert!(coefficients[1..].iter().all(|c| *c == 0.0));
        let mut poisoned = [0.5; 64];
        poisoned[3] = f64::NAN;
        burg.fit(&poisoned, &mut coefficients);
    }
}
