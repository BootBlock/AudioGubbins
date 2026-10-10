//! The codec module (ADR-0091): decoding of the compressed formats the
//! application does not read itself, and FLAC and Opus encoding.
//!
//! A [`DecodeSession`] reads a file through a [`ByteSource`], recognises its
//! container from its bytes, chooses the default audio track, describes it,
//! and decodes it in order into planar `f32` blocks at the stream's own rate,
//! with the encoder's priming and padding trimmed where the file states them
//! (ADR-0090). Symphonia demultiplexes every container and decodes FLAC,
//! ALAC, MP3, Vorbis and AAC-LC; Opus is decoded by the conformant
//! fixed-point port of the reference decoder, `ropus`. A packet that will not
//! decode fails the session: nothing is concealed or repaired.
//!
//! [`FlacFrameEncoder`] encodes FLAC frames for the application's own FLAC
//! writer, and [`OpusEncoder`] encodes Opus packets, with the identification
//! header and granule positions its Ogg writer needs.
//!
//! Every function is safe Rust, and nothing here panics on any input: a file
//! is untrusted, so each failure is a [`CodecFailure`] (REQ-EXEC-136). The
//! C ABI over this crate is `crates/codec-bindings`.

mod aac_signalling;
mod byte_source;
mod decode_session;
mod description;
mod failure;
mod flac_frames;
mod leading_bytes;
mod mp4_gapless;
mod opus_decoding;
mod opus_encoding;
mod opus_head;
mod opus_track;
mod planar_queue;
mod symphonia_track;
mod track_decoder;
mod vorbis_order;

pub use byte_source::{ByteSource, ReadFailure};
pub use decode_session::{DecodeSession, EncodedPacket};
pub use description::{Codec, Container, StatedLayout, StreamDescription};
pub use failure::CodecFailure;
pub use flac_frames::{FlacFrameEncoder, FlacSettings, MAX_LEVEL as MAX_FLAC_LEVEL};
pub use opus_decoding::{
    MAX_PACKET_FRAMES as MAX_OPUS_PACKET_FRAMES, OPUS_RATE, OpusPacketDecoder,
};
pub use opus_encoding::{
    OpusApplication, OpusEncoder, OpusFrameDuration, OpusPacket, OpusRateControl, OpusSettings,
};
pub use opus_head::{MappingFamily, OpusHead};
