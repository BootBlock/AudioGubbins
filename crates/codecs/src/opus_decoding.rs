//! Opus packets decoded at 48 kHz by the conformant decoder (ADR-0091).
//!
//! Symphonia demultiplexes Opus but decodes none, so its packets come here.
//! The decoder is `ropus`, a port of the reference fixed-point decoder, which
//! decodes the RFC 6716 and RFC 8251 test vectors within `opus_compare`'s
//! threshold (`pnpm test:opus-conformance`). Its output is 16-bit, as the
//! reference fixed-point decoder's is.

use ropus::OpusMSDecoder;

use crate::failure::CodecFailure;
use crate::opus_head::{MappingFamily, OpusHead};
use crate::vorbis_order::vorbis_layout;

/// The rate every Opus stream decodes at here.
pub const OPUS_RATE: u32 = 48_000;

/// The longest packet: 120 ms at 48 kHz.
pub const MAX_PACKET_FRAMES: usize = 5_760;

/// [`MAX_PACKET_FRAMES`] as the decoder takes it.
const MAX_PACKET_FRAMES_I32: i32 = 5_760;

/// What a lost packet before any other is concealed for: 20 ms.
const CONCEALED_FRAMES: i32 = 960;

/// One Opus stream's packets, decoded in order.
pub struct OpusPacketDecoder {
    decoder: OpusMSDecoder,
    channels: usize,
    /// For each output plane, the decoder's interleaved channel it takes.
    plane_source: Vec<usize>,
    interleaved: Vec<i16>,
}

impl OpusPacketDecoder {
    /// A decoder of the streams `head` describes, applying its output gain.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Malformed`] where the decoder refuses the header's
    /// streams and mapping.
    pub fn new(head: &OpusHead) -> Result<Self, CodecFailure> {
        let channels = usize::from(head.channel_count);
        let mut decoder = OpusMSDecoder::new(
            i32::try_from(OPUS_RATE).map_err(|_| CodecFailure::Malformed)?,
            i32::from(head.channel_count),
            i32::from(head.stream_count),
            i32::from(head.coupled_count),
            &head.mapping,
        )
        .map_err(|_| CodecFailure::Malformed)?;
        if decoder.set_gain(i32::from(head.output_gain)) != 0 {
            return Err(CodecFailure::Malformed);
        }
        // Family 0 is one or two channels in their own order; family 1 is the
        // Vorbis order, answered in speaker-mask order.
        let plane_source = match head.family {
            MappingFamily::Single => (0..channels).collect(),
            MappingFamily::Vorbis => vorbis_layout(channels)
                .ok_or(CodecFailure::Malformed)?
                .vorbis_index
                .to_vec(),
        };
        Ok(Self {
            decoder,
            channels,
            plane_source,
            interleaved: vec![0; MAX_PACKET_FRAMES * channels],
        })
    }

    /// The channels each packet decodes to.
    #[must_use]
    pub const fn channels(&self) -> usize {
        self.channels
    }

    /// Decodes `packet` into the planes, from the start of each, answering
    /// the frames decoded. An empty packet is a lost one, concealed as
    /// RFC 6716 describes; a container never gives one.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Malformed`] where the packet will not decode.
    pub fn decode(
        &mut self,
        packet: &[u8],
        planes: &mut [Vec<f32>],
    ) -> Result<usize, CodecFailure> {
        let length = i32::try_from(packet.len()).map_err(|_| CodecFailure::Malformed)?;
        // A lost packet is concealed for as long as the last one lasted, as
        // the reference's own demonstration decoder does.
        let (data, span) = if packet.is_empty() {
            let last = self.decoder.get_last_packet_duration();
            (None, if last > 0 { last } else { CONCEALED_FRAMES })
        } else {
            (Some(packet), MAX_PACKET_FRAMES_I32)
        };
        let frames = self
            .decoder
            .decode(data, length, &mut self.interleaved, span, false)
            .map_err(|_| CodecFailure::Malformed)?;
        let frames = usize::try_from(frames).map_err(|_| CodecFailure::Malformed)?;
        for (plane, &source) in planes.iter_mut().zip(&self.plane_source) {
            plane.clear();
            plane.extend(
                self.interleaved
                    .iter()
                    .skip(source)
                    .step_by(self.channels)
                    .take(frames)
                    .map(|&sample| f32::from(sample) / 32_768.0),
            );
        }
        Ok(frames)
    }

    /// The range coder's final state after the last packet, which the
    /// conformance vectors state for each packet.
    #[must_use]
    pub fn final_range(&self) -> u32 {
        self.decoder.get_final_range()
    }
}
