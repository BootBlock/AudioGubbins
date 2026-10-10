//! FLAC frames encoded one at a time by `flacenc` (ADR-0091), at the depths
//! it encodes: 8, 12, 16, 20 and 24 bits a sample.

use flacenc::bitsink::ByteSink;
use flacenc::component::{BitRepr, StreamInfo};
use flacenc::config;
use flacenc::error::{Verified, Verify};
use flacenc::source::{Fill, FrameBuf};

use crate::failure::CodecFailure;
use crate::flac_frames::FlacSettings;

/// The depths `flacenc` encodes, which FLAC's frame header names.
pub const DEPTHS: [u8; 5] = [8, 12, 16, 20, 24];

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

/// Encodes one FLAC stream's frames through `flacenc`.
pub struct FlacencFrames {
    config: Verified<config::Encoder>,
    stream_info: StreamInfo,
    frame: FrameBuf,
    interleaved: Vec<i32>,
    encoded: ByteSink,
}

impl FlacencFrames {
    /// An encoder for a stream of these settings, whose depth is one of
    /// [`DEPTHS`] and whose other fields are checked.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] for a rate no frame header names.
    pub fn new(settings: FlacSettings) -> Result<Self, CodecFailure> {
        let FlacSettings {
            channels,
            bits_per_sample,
            sample_rate,
            block_size,
            level,
        } = settings;
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

    /// Encodes the frame numbered `number` from the first `frames` samples of
    /// each plane, answering its bytes. The caller has checked the planes
    /// and the count.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] for a sample outside the stream's bits.
    pub fn encode<P: AsRef<[i32]>>(
        &mut self,
        planes: &[P],
        frames: usize,
        number: u32,
    ) -> Result<&[u8], CodecFailure> {
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
