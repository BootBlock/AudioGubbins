//! FLAC frames encoded one at a time by `flacenc` (ADR-0091).
//!
//! The module encodes frames and nothing else: the application's own FLAC
//! writer (in `@audiogubbins/codecs`) writes the stream around them, and
//! computes the STREAMINFO block (the smallest and largest block and frame,
//! the total samples and the MD5 of the samples) from what it sends and
//! receives. Each frame of a stream of fixed block size carries its number,
//! so frames may be encoded in any order.
//!
//! What `flacenc` encodes, and so what this accepts: one to eight channels,
//! 8, 12, 16, 20 or 24 bits a sample (FLAC's own frame codes, without 32,
//! which `flacenc` refuses), blocks of 32 to 32 767 frames, and any rate a
//! frame header can name (to 65 535 Hz, then multiples of 10 Hz to
//! 655 350 Hz).

use flacenc::bitsink::ByteSink;
use flacenc::component::{BitRepr, StreamInfo};
use flacenc::config;
use flacenc::error::{Verified, Verify};
use flacenc::source::{Fill, FrameBuf};

use crate::failure::CodecFailure;

/// The bits a sample may have.
const DEPTHS: [u8; 5] = [8, 12, 16, 20, 24];

/// The block sizes `flacenc` encodes.
const BLOCK_SIZES: std::ops::RangeInclusive<u32> = 32..=32_767;

/// The highest compression level.
pub const MAX_LEVEL: u8 = 8;

/// What a FLAC stream is encoded with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FlacSettings {
    /// Channels, one to eight, in FLAC's own order, which is the speaker
    /// mask's.
    pub channels: u8,
    /// Bits a sample: 8, 12, 16, 20 or 24.
    pub bits_per_sample: u8,
    /// Frames a second.
    pub sample_rate: u32,
    /// Frames in every block but the last, 32 to 32 767.
    pub block_size: u32,
    /// How hard the encoder searches, 0 to 8, after `libFLAC`'s levels: up
    /// to 2 the fixed predictors alone, from 3 linear prediction of order 6,
    /// 8 and from 7 of 12; stereo decorrelation at every level but 0 and 3.
    pub level: u8,
}

/// The encoder configuration of a compression level.
fn configuration(level: u8, block_size: usize) -> Result<Verified<config::Encoder>, CodecFailure> {
    let mut encoder = config::Encoder::default();
    encoder.block_size = block_size;
    // The module has one thread; a worker pool could not start.
    encoder.multithread = false;
    let stereo = !matches!(level, 0 | 3);
    encoder.stereo_coding.use_leftside = stereo;
    encoder.stereo_coding.use_rightside = stereo;
    encoder.stereo_coding.use_midside = stereo;
    encoder.subframe_coding.use_lpc = level >= 3;
    encoder.subframe_coding.qlpc.lpc_order = match level {
        0..=3 => 6,
        4..=6 => 8,
        _ => 12,
    };
    encoder.into_verified().map_err(|_| CodecFailure::Refused)
}

/// Encodes one FLAC stream's frames.
pub struct FlacFrameEncoder {
    settings: FlacSettings,
    config: Verified<config::Encoder>,
    stream_info: StreamInfo,
    frame: FrameBuf,
    interleaved: Vec<i32>,
    encoded: ByteSink,
}

impl FlacFrameEncoder {
    /// An encoder for a stream of these settings.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] for settings outside what `flacenc` encodes.
    pub fn new(settings: FlacSettings) -> Result<Self, CodecFailure> {
        let FlacSettings {
            channels,
            bits_per_sample,
            sample_rate,
            block_size,
            level,
        } = settings;
        let usable = (1..=8).contains(&channels)
            && DEPTHS.contains(&bits_per_sample)
            && BLOCK_SIZES.contains(&block_size)
            && level <= MAX_LEVEL
            && sample_rate > 0;
        if !usable {
            return Err(CodecFailure::Refused);
        }
        let block = usize::try_from(block_size).map_err(|_| CodecFailure::Refused)?;
        let channel_count = usize::from(channels);
        let rate = usize::try_from(sample_rate).map_err(|_| CodecFailure::Refused)?;
        let stream_info = StreamInfo::new(rate, channel_count, usize::from(bits_per_sample))
            .map_err(|_| CodecFailure::Refused)?;
        // A frame header names the rate, so a rate it cannot name is refused
        // here rather than at the first frame.
        flacenc::component::FrameHeader::new(
            block,
            flacenc::component::ChannelAssignment::Independent(channels),
            usize::from(bits_per_sample),
            rate,
            flacenc::component::FrameOffset::Frame(0),
        )
        .map_err(|_| CodecFailure::Refused)?;
        Ok(Self {
            settings,
            config: configuration(level, block)?,
            stream_info,
            frame: FrameBuf::with_size(channel_count, block).map_err(|_| CodecFailure::Refused)?,
            interleaved: Vec::with_capacity(block * channel_count),
            encoded: ByteSink::new(),
        })
    }

    /// The bytes of the frame last encoded.
    #[must_use]
    pub fn last_frame(&self) -> &[u8] {
        self.encoded.as_slice()
    }

    /// The settings the encoder was made with.
    #[must_use]
    pub const fn settings(&self) -> FlacSettings {
        self.settings
    }

    /// Encodes the frame numbered `number` from the first `frames` samples of
    /// each plane, answering its bytes. Only a stream's last frame may hold
    /// fewer frames than the block size.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] for a plane per channel missing or short, a
    /// frame count of none or past the block size, a number past 2³¹ − 1, or
    /// a sample outside the stream's bits.
    pub fn encode<P: AsRef<[i32]>>(
        &mut self,
        planes: &[P],
        frames: usize,
        number: u32,
    ) -> Result<&[u8], CodecFailure> {
        let channels = usize::from(self.settings.channels);
        let usable = planes.len() == channels
            && frames > 0
            && frames <= self.frame.size()
            && planes.iter().all(|plane| plane.as_ref().len() >= frames);
        if !usable {
            return Err(CodecFailure::Refused);
        }
        self.interleaved.clear();
        for index in 0..frames {
            self.interleaved
                .extend(planes.iter().map(|plane| plane.as_ref()[index]));
        }
        self.frame
            .fill_interleaved(&self.interleaved)
            .map_err(|_| CodecFailure::Refused)?;
        let number = usize::try_from(number).map_err(|_| CodecFailure::Refused)?;
        let frame =
            flacenc::encode_fixed_size_frame(&self.config, &self.frame, number, &self.stream_info)
                .map_err(|_| CodecFailure::Refused)?;
        self.encoded.clear();
        frame
            .write(&mut self.encoded)
            .map_err(|_| CodecFailure::Refused)?;
        Ok(self.encoded.as_slice())
    }
}
