//! Why a resampler cannot be made, fed or moved.

/// Why a resampler cannot be made, fed or moved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResamplerError {
    /// A sample rate is zero.
    RateZero,
    /// There are no channels.
    NoChannels,
    /// Input was given after the stream was finished, or with the wrong
    /// number of channels or of different lengths.
    InputRefused,
    /// A seek names an output frame whose input position does not fit in a
    /// 64-bit frame count.
    SeekOutOfRange,
}
