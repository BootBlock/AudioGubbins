//! Canonical measurement of audio: what reads samples and never changes them.
//!
//! The short-time Fourier transform, the peak and loudness meters of ITU-R
//! BS.1770-4 and EBU R 128, and the feature extractors restoration's detectors
//! read (ADR-0061, ADR-0062). Each is a streaming object: made with its
//! settings, pushed planar samples in any chunks, and read for what it found,
//! with every chunking giving the same bits.
//!
//! Every operation is one ADR-0032 allows, in the order each item's
//! documentation states, and the TypeScript reference path in
//! `packages/audio-engine/src/dsp/reference/analysis/` repeats it operation for
//! operation; the golden tests hold both to the same bits. Nothing here
//! panics on any input, a NaN or an infinity included, and nothing allocates
//! per call once an object's buffers have grown to the chunks it is fed.

mod burg;
pub mod detectors;
mod error;
mod framing;
pub mod k_weighting;
pub mod loudness;
pub mod peak;
mod selection;
pub mod stft;

pub use detectors::{DetectorFeatures, DetectorKind, DetectorSettings};
pub use error::AnalysisError;
pub use k_weighting::{Biquad, k_weighting};
pub use loudness::LoudnessMeter;
pub use peak::{PeakMeter, PeakReading};
pub use stft::{Stft, StftWindow};

/// The most channels an analysis object takes: the largest channel count the
/// domain accepts (`MAXIMUM_CHANNEL_COUNT`).
pub const MOST_CHANNELS: usize = 256;

/// The most samples a frame, block or window of a detector holds: 2²⁰, about
/// 22 seconds at 48 kHz, which bounds the memory an object takes when made.
pub const MOST_FRAME_SAMPLES: usize = 1 << 20;

/// The most frames a detector's history holds.
pub const MOST_HISTORY_FRAMES: usize = 1 << 16;

/// `count` as an `f64`, exactly: every count here is far below 2⁵³.
#[allow(clippy::cast_precision_loss, reason = "counts far below 2^53")]
pub(crate) const fn exact(count: usize) -> f64 {
    count as f64
}

/// `count` as an `f64`, exactly: every sample position here is below 2⁵³.
#[allow(clippy::cast_precision_loss, reason = "positions far below 2^53")]
pub(crate) const fn exact_u64(count: u64) -> f64 {
    count as f64
}

#[cfg(test)]
pub(crate) mod fingerprint {
    /// FNV-1a over the little-endian bits of each `f64`, as the TypeScript
    /// tests compute it over a `Float64Array`.
    pub fn of(values: &[f64]) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for value in values {
            for byte in value.to_bits().to_le_bytes() {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        hash
    }
}

#[cfg(test)]
pub(crate) mod signals {
    use audiogubbins_dsp_core::sine_of_turns;

    /// A seeded generator in `[−1, 1)`: Marsaglia's xorshift, as the
    /// TypeScript tests draw it, so both languages test the same signals.
    pub struct Noise(u32);

    impl Noise {
        pub const fn new(seed: u32) -> Self {
            Self(seed)
        }

        pub fn next(&mut self) -> f64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 17;
            self.0 ^= self.0 << 5;
            f64::from(self.0) / 2_147_483_648.0 - 1.0
        }
    }

    /// The fixed planar signal the golden tests measure: per channel `c`, a
    /// tone of `0.013 + 0.01c` turns a sample at half scale, a quarter-scale
    /// tone of `0.31` turns, and a ramp, rounded once to `f32`.
    pub fn golden(channels: usize, frames: usize) -> Vec<f32> {
        let mut planar = Vec::with_capacity(channels * frames);
        for channel in 0..channels {
            let offset = super::exact(channel) * 0.01;
            for n in 0..frames {
                let at = super::exact(n);
                let value = 0.5 * sine_of_turns(at * (0.013 + offset))
                    + 0.25 * sine_of_turns(at * 0.31 + 0.1)
                    + at / 1.0e5;
                #[allow(clippy::cast_possible_truncation, reason = "rounded once to f32")]
                planar.push(value as f32);
            }
        }
        planar
    }
}
