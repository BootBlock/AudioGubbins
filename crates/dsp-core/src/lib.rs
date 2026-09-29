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

pub mod oscillator;
pub mod turns;
pub mod window;

pub use oscillator::SineOscillator;
pub use turns::sine_of_turns;
pub use window::{bessel_i0, kaiser};

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
