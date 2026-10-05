//! Deterministic DSP primitives for the canonical processing path.
//!
//! REQ-ARCH-081 targets bit-identical output on every machine and browser. A
//! platform's `sin`, `cos` or `exp` differs in its last bit from one C library
//! or JavaScript engine to the next, so nothing here calls one. Every function
//! is built from the operations IEEE-754 requires to be correctly rounded
//! (addition, subtraction, multiplication, division, square root and floor),
//! evaluated in the order written, and the TypeScript reference path in
//! `packages/audio-engine` evaluates the same operations in the same order
//! (ADR-0032). A change to the order of any expression here changes golden
//! output, and needs the same change there.

pub mod decibels;
mod exact;
pub mod exponential;
pub mod fft;
pub mod logarithm;
pub mod oscillator;
pub mod power;
pub mod trigonometry;
pub mod turns;
pub mod window;

pub use decibels::{decibels_to_gain, gain_to_decibels};
pub use exponential::exp;
pub use fft::{Fft, FftError, LARGEST_FFT_SIZE, SMALLEST_FFT_SIZE};
pub use logarithm::{ln, log2, log10};
pub use oscillator::SineOscillator;
pub use power::pow;
pub use trigonometry::{arctangent_turns, cosine_of_turns, tangent_of_turns};
pub use turns::sine_of_turns;
pub use window::{bessel_i0, kaiser};

#[cfg(test)]
pub(crate) mod ulps {
    /// How many `f64`s lie between `a` and `b`, counting one of them: 0 where
    /// they are the same number, `u64::MAX` where either is NaN. Zeros of
    /// either sign are one number, so the count across zero is exact.
    pub fn ulps_between(a: f64, b: f64) -> u64 {
        if a.is_nan() || b.is_nan() {
            return u64::MAX;
        }
        ordered(a).abs_diff(ordered(b))
    }

    /// The `f64`s in order as integers: negative numbers below zero, and both
    /// zeros at zero.
    fn ordered(value: f64) -> i64 {
        let magnitude = i64::try_from(value.to_bits() & !(1 << 63)).unwrap_or(i64::MAX);
        if value.is_sign_negative() {
            -magnitude
        } else {
            magnitude
        }
    }
}

#[cfg(test)]
pub(crate) mod fingerprint {
    /// FNV-1a over the bits of each sample, little-endian, as the
    /// TypeScript tests compute it, so a golden vector is one number in both.
    pub fn of_samples(samples: &[f32]) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for sample in samples {
            for byte in sample.to_bits().to_le_bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        hash
    }
}
