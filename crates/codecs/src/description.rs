//! What a decode session says of the stream it opened (ADR-0090).
//!
//! The codes match the names `@audiogubbins/codecs` gives (`CodecId`,
//! `ContainerId`), and cross the ABI as the numbers [`Codec::code`] and
//! [`Container::code`] answer, so the two sides change together.

/// The codecs the module recognises in a file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Codec {
    /// FLAC.
    Flac,
    /// Apple Lossless.
    Alac,
    /// MPEG-1 or MPEG-2 Audio Layer III.
    Mp3,
    /// Vorbis.
    Vorbis,
    /// Opus.
    Opus,
    /// AAC Low Complexity.
    AacLc,
    /// AAC with spectral band replication, and with parametric stereo
    /// (HE-AAC and HE-AACv2), which no decoder in the module serves.
    HeAac,
}

impl Codec {
    /// The code the ABI carries: the codec's place in this list.
    #[must_use]
    pub const fn code(self) -> u32 {
        match self {
            Self::Flac => 1,
            Self::Alac => 2,
            Self::Mp3 => 3,
            Self::Vorbis => 4,
            Self::Opus => 5,
            Self::AacLc => 6,
            Self::HeAac => 7,
        }
    }

    /// Whether the codec loses nothing, so the stream states a bit depth.
    #[must_use]
    pub const fn lossless(self) -> bool {
        matches!(self, Self::Flac | Self::Alac)
    }
}

/// The containers the module demultiplexes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Container {
    /// A native FLAC stream.
    Flac,
    /// An MPEG audio elementary stream.
    Mp3,
    /// Ogg.
    Ogg,
    /// ISO base media: MP4 and M4A.
    Mp4,
    /// AAC in Audio Data Transport Stream frames.
    Adts,
    /// Matroska whose document type is `webm`.
    Webm,
    /// Matroska.
    Matroska,
}

impl Container {
    /// The code the ABI carries.
    #[must_use]
    pub const fn code(self) -> u32 {
        match self {
            Self::Flac => 1,
            Self::Mp3 => 2,
            Self::Ogg => 3,
            Self::Mp4 => 4,
            Self::Adts => 5,
            Self::Webm => 6,
            Self::Matroska => 7,
        }
    }
}

/// What the stream states of where its channels belong.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StatedLayout {
    /// The speakers, as `WAVE_FORMAT_EXTENSIBLE`'s `dwChannelMask` names
    /// them; the decoded channels are in the mask's bit order. One channel
    /// alone is the front centre.
    Speakers(u32),
    /// Ambisonics of this order, the channels in ACN order.
    Ambisonic(u8),
    /// No layout: the channels are discrete, or the stream states one that no
    /// speaker mask holds.
    Unstated,
}

/// What a decode session says of the stream it decodes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StreamDescription {
    /// The codec of the default audio track.
    pub codec: Codec,
    /// The container it is carried in.
    pub container: Container,
    /// Frames a second, as decoded: the stream's own rate, never resampled.
    pub sample_rate: u32,
    /// Channels, as decoded.
    pub channel_count: u32,
    /// Where the channels belong, where the stream says.
    pub layout: StatedLayout,
    /// The frames the session will answer, priming and padding excluded,
    /// where the file states it.
    pub total_frames: Option<u64>,
    /// The encoder's leading frames the session trims, where the file
    /// states them.
    pub priming: Option<u64>,
    /// The encoder's trailing frames the session trims, where the file
    /// states them.
    pub padding: Option<u64>,
    /// The bit rate in bits a second, where the stream states one.
    pub bit_rate: Option<u32>,
    /// The bits of each sample of a lossless stream.
    pub bits_per_sample: Option<u32>,
    /// Whether the module decodes the codec. HE-AAC is described, so the
    /// browser's decoder can be offered it, but never decoded here.
    pub decodable: bool,
}
