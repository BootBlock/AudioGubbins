//! The decoder of one track's packets, whichever codec serves it.

use std::ops::Range;

use symphonia::core::packet::Packet;

use crate::failure::CodecFailure;

/// What one packet decoded to: planes of `f32`, one per channel in the
/// session's channel order, and the frames of them to present once the
/// packet's own trimming is applied.
pub struct Decoded<'a> {
    /// One plane per channel.
    pub planes: &'a [Vec<f32>],
    /// The frames of each plane to present.
    pub frames: Range<usize>,
}

/// Decodes one track's packets in order.
pub trait TrackDecoder {
    /// Decodes `packet`.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Malformed`] where the packet will not decode, which
    /// ends the session.
    fn decode(&mut self, packet: &Packet) -> Result<Decoded<'_>, CodecFailure>;
}
