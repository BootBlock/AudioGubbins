//! FLAC frames encoded one at a time (ADR-0091), at every depth FLAC allows.
//!
//! The module encodes frames and nothing else: the application's own FLAC
//! writer (in `@audiogubbins/codecs`) writes the stream around them, and
//! computes the STREAMINFO block (the smallest and largest block and frame,
//! the total samples and the MD5 of the samples) from what it sends and
//! receives. Each frame of a stream of fixed block size carries its number,
//! so frames may be encoded in any order.
//!
//! `flacenc` encodes the depths it serves, 8, 12, 16, 20 and 24 bits a
//! sample; the module's own encoder (`flac_native`) encodes the rest, 32
//! bits above all, so a caller sees one encoder of every depth from 4 to 32.
//! Either way it accepts one to eight channels, blocks of 32 to 32 767
//! frames, and any rate a frame header can name (to 65 535 Hz, then
//! multiples of 10 Hz to 655 350 Hz).

use crate::failure::CodecFailure;
use crate::flac_native::NativeFrames;
use crate::flacenc_frames::{DEPTHS as FLACENC_DEPTHS, FlacencFrames};

/// The bits a sample may have: FLAC's STREAMINFO names 4 to 32.
const DEPTHS: std::ops::RangeInclusive<u8> = 4..=32;

/// The block sizes encoded.
const BLOCK_SIZES: std::ops::RangeInclusive<u32> = 32..=32_767;

/// The highest compression level.
pub const MAX_LEVEL: u8 = 8;

/// The largest frame number a frame header holds: 31 bits.
const MAX_FRAME_NUMBER: u32 = (1 << 31) - 1;

/// What a FLAC stream is encoded with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FlacSettings {
    /// Channels, one to eight, in FLAC's own order, which is the speaker
    /// mask's.
    pub channels: u8,
    /// Bits a sample, 4 to 32.
    pub bits_per_sample: u8,
    /// Frames a second.
    pub sample_rate: u32,
    /// Frames in every block but the last, 32 to 32 767.
    pub block_size: u32,
    /// How hard the encoder searches, 0 to 8, after `libFLAC`'s levels: up
    /// to 2 the fixed predictors alone, from 3 linear prediction of order 6,
    /// 8 and from 7 of 12; stereo decorrelation at every level but 0 and 3,
    /// and below 32 bits a sample.
    pub level: u8,
}

/// The encoder that serves a stream's depth.
enum Engine {
    Flacenc(FlacencFrames),
    Native(NativeFrames),
}

/// Encodes one FLAC stream's frames.
pub struct FlacFrameEncoder {
    settings: FlacSettings,
    engine: Engine,
}

impl FlacFrameEncoder {
    /// An encoder for a stream of these settings.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] for settings outside what FLAC encodes.
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
        let engine = if FLACENC_DEPTHS.contains(&bits_per_sample) {
            Engine::Flacenc(FlacencFrames::new(settings)?)
        } else {
            Engine::Native(NativeFrames::new(
                channels,
                bits_per_sample,
                sample_rate,
                level,
            )?)
        };
        Ok(Self { settings, engine })
    }

    /// The bytes of the frame last encoded.
    #[must_use]
    pub fn last_frame(&self) -> &[u8] {
        match &self.engine {
            Engine::Flacenc(engine) => engine.last_frame(),
            Engine::Native(engine) => engine.last_frame(),
        }
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
        let block = usize::try_from(self.settings.block_size).map_err(|_| CodecFailure::Refused)?;
        let usable = planes.len() == usize::from(self.settings.channels)
            && frames > 0
            && frames <= block
            && number <= MAX_FRAME_NUMBER
            && planes.iter().all(|plane| plane.as_ref().len() >= frames);
        if !usable {
            return Err(CodecFailure::Refused);
        }
        match &mut self.engine {
            Engine::Flacenc(engine) => engine.encode(planes, frames, number),
            Engine::Native(engine) => engine.encode(planes, frames, number),
        }
    }
}
