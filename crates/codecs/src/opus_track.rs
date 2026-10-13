//! An Opus track demultiplexed by Symphonia and decoded by the conformant
//! decoder.
//!
//! Every packet is given whole. Symphonia's Ogg reader trims Opus packets by
//! its page arithmetic, which ignores the header's pre-skip, so the session
//! trims Opus itself, from the pre-skip and the length the container states
//! (RFC 7845, section 4).

use symphonia::core::packet::Packet;

use crate::failure::CodecFailure;
use crate::opus_decoding::OpusPacketDecoder;
use crate::opus_head::OpusHead;
use crate::track_decoder::{Decoded, TrackDecoder};

/// An Opus track's decoder.
pub struct OpusTrack {
    decoder: OpusPacketDecoder,
    planes: Vec<Vec<f32>>,
}

impl OpusTrack {
    /// A decoder of the streams `head` describes.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Malformed`] where the decoder refuses the header.
    pub fn new(head: &OpusHead) -> Result<Self, CodecFailure> {
        let decoder = OpusPacketDecoder::new(head)?;
        let planes = vec![Vec::new(); decoder.channels()];
        Ok(Self { decoder, planes })
    }
}

impl TrackDecoder for OpusTrack {
    fn decode(&mut self, packet: &Packet) -> Result<Decoded<'_>, CodecFailure> {
        // RFC 6716 gives no packet fewer than one byte; a container that
        // carries one is malformed, never a lost packet to conceal.
        if packet.data.is_empty() {
            return Err(CodecFailure::Malformed);
        }
        let frames = self.decoder.decode(&packet.data, &mut self.planes)?;
        Ok(Decoded {
            planes: &self.planes,
            frames: 0..frames,
        })
    }
}
