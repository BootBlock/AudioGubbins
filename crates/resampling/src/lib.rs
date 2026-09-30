//! Canonical sample-rate conversion.
//!
//! REQ-ARCH-085 requires resampling to be explicit, deterministic and of high
//! quality. This is a band-limited interpolator: each output sample is the
//! input convolved with a Kaiser-windowed sinc centred on the output's exact
//! position, which is a rational number of input samples, so no position is
//! ever rounded. Its output depends only on the input samples and on where the
//! output sample falls, never on how the input arrived in chunks, which is what
//! lets the offline renderer choose its chunk size for memory without changing
//! a bit of what it writes (REQ-ARCH-049).
//!
//! The arithmetic follows ADR-0032, and the TypeScript reference path in
//! `packages/audio-engine` repeats it operation for operation.

mod error;
mod kernel;
mod quality;
mod stream;

pub use error::ResamplerError;
pub use kernel::{CoefficientStrategy, Kernel};
pub use quality::ResamplingQuality;
pub use stream::StreamingResampler;

/// The greatest common divisor of two rates.
#[must_use]
pub fn greatest_common_divisor(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}
