//! Why the module refused a file, a packet or a setting.

use crate::byte_source::ReadFailure;

/// Why a decode or an encode failed. Each is final: a session that answers
/// one keeps nothing more to give (ADR-0090: a decode that fails part way is
/// refused whole, and no output is repaired after it).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodecFailure {
    /// The host could not read the file.
    Unreadable,
    /// The file changed while it was read.
    Changed,
    /// No container the module reads was found in the file.
    Unrecognised,
    /// The container holds no audio track.
    NoAudioTrack,
    /// The audio is in a codec, or a form of one, the module does not decode.
    Unsupported,
    /// The file breaks its format's rules, or a packet would not decode.
    Malformed,
    /// An encoder was given settings or samples it cannot encode.
    Refused,
}

impl From<ReadFailure> for CodecFailure {
    fn from(failure: ReadFailure) -> Self {
        match failure {
            ReadFailure::Unreadable => Self::Unreadable,
            ReadFailure::Changed => Self::Changed,
        }
    }
}

impl std::fmt::Display for CodecFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Unreadable => "the file could not be read",
            Self::Changed => "the file changed while it was read",
            Self::Unrecognised => "no container the module reads was found",
            Self::NoAudioTrack => "the container holds no audio track",
            Self::Unsupported => "the audio is in a codec the module does not decode",
            Self::Malformed => "the file is malformed",
            Self::Refused => "the encoder refused its settings or samples",
        })
    }
}

impl std::error::Error for CodecFailure {}
