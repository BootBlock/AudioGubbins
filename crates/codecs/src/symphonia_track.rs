//! A track decoded by one of Symphonia's decoders: FLAC, ALAC, MP3, Vorbis
//! and AAC-LC.

use symphonia::core::codecs::audio::{AudioCodecParameters, AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error;
use symphonia::core::packet::Packet;

use crate::byte_source::read_failure_of;
use crate::failure::CodecFailure;
use crate::track_decoder::{Decoded, TrackDecoder};

/// What a Symphonia error means to a session.
pub fn failure_of(error: &Error) -> CodecFailure {
    match error {
        Error::IoError(io) => {
            read_failure_of(io).map_or(CodecFailure::Malformed, CodecFailure::from)
        }
        Error::Unsupported(_) => CodecFailure::Unsupported,
        // A stream that changes its parameters part way, a seek, or a limit
        // a hostile file reaches are each the file failing to decode.
        _ => CodecFailure::Malformed,
    }
}

/// A track Symphonia decodes, with its decoder's gapless trimming on.
pub struct SymphoniaTrack {
    decoder: Box<dyn AudioDecoder>,
    channels: usize,
    planes: Vec<Vec<f32>>,
}

impl SymphoniaTrack {
    /// A decoder of the track whose parameters are `params`.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Unsupported`] where no decoder in the module serves
    /// the track's codec or form of it, and [`CodecFailure::Malformed`]
    /// where its headers state no channels.
    pub fn new(params: &AudioCodecParameters) -> Result<Self, CodecFailure> {
        // Gapless decoding trims the delay and padding a packet states.
        let options = AudioDecoderOptions::default().gapless(true);
        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(params, &options)
            .map_err(|error| failure_of(&error))?;
        let channels = decoder
            .codec_params()
            .channels
            .as_ref()
            .map_or(0, symphonia::core::audio::Channels::count);
        if channels == 0 {
            return Err(CodecFailure::Malformed);
        }
        Ok(Self {
            decoder,
            channels,
            planes: Vec::with_capacity(channels),
        })
    }

    /// The track's parameters, as the decoder completed them from the
    /// codec's own headers.
    #[must_use]
    pub fn params(&self) -> &AudioCodecParameters {
        self.decoder.codec_params()
    }
}

impl TrackDecoder for SymphoniaTrack {
    fn decode(&mut self, packet: &Packet) -> Result<Decoded<'_>, CodecFailure> {
        let decoded = self
            .decoder
            .decode(packet)
            .map_err(|error| failure_of(&error))?;
        // A stream whose channel count changes part way is not one stream.
        if decoded.num_planes() != self.channels {
            return Err(CodecFailure::Malformed);
        }
        let frames = decoded.frames();
        decoded.copy_to_vecs_planar::<f32>(&mut self.planes);
        Ok(Decoded {
            planes: &self.planes,
            frames: 0..frames,
        })
    }
}
