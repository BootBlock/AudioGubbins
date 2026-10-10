//! Streams of the codecs no encoder in the module writes, made bit by bit:
//! MP3 and AAC-LC frames of silence, and AAC whose packets carry SBR, which
//! the module recognises as HE-AAC and does not decode.

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    reason = "test signals and files of small, known ranges"
)]

mod common;

use audiogubbins_codecs::{Codec, CodecFailure, Container, DecodeSession, StatedLayout};
use common::{MemorySource, adts, decode_all, open_and_decode, silent_block, silent_mp3};

#[test]
fn decodes_mp3_silence_to_every_frame() {
    let (session, planes) = open_and_decode(silent_mp3(40)).expect("decodable");
    let description = session.description();
    assert_eq!(description.codec, Codec::Mp3);
    assert_eq!(description.container, Container::Mp3);
    assert_eq!(description.sample_rate, 44_100);
    assert_eq!(description.layout, StatedLayout::Speakers(0b11));
    // No LAME tag, so no length is stated, only estimated.
    assert_eq!(description.total_frames, None);
    assert_eq!(planes.len(), 2);
    assert_eq!(planes[0].len(), 40 * 1_152);
    assert!(planes.iter().flatten().all(|&sample| sample == 0.0));
}

#[test]
fn decodes_aac_lc_silence_in_adts_to_every_frame() {
    let (session, planes) =
        open_and_decode(adts(30, 4, &silent_block(&[(4, 0x1)]))).expect("decodable");
    let description = session.description();
    assert_eq!(description.codec, Codec::AacLc);
    assert_eq!(description.container, Container::Adts);
    assert_eq!(description.sample_rate, 44_100);
    assert!(description.decodable);
    assert_eq!(planes[0].len(), 30 * 1_024);
    assert!(planes.iter().flatten().all(|&sample| sample == 0.0));
}

#[test]
fn recognises_implicit_sbr_as_he_aac_and_gives_its_packets_undecoded() {
    let block = silent_block(&[(9, 0xd)]);
    let mut session = DecodeSession::open(MemorySource(adts(20, 6, &block))).expect("recognised");
    let description = *session.description();
    assert_eq!(description.codec, Codec::HeAac);
    assert!(!description.decodable);
    // SBR doubles the 24 kHz core.
    assert_eq!(description.sample_rate, 48_000);
    assert_eq!(description.channel_count, 2);
    assert_eq!(
        decode_all(&mut session).err(),
        Some(CodecFailure::Unsupported)
    );

    let mut reader = DecodeSession::open(MemorySource(adts(20, 6, &block))).expect("recognised");
    let mut packets = 0;
    while let Some(packet) = reader.read_packet().expect("readable") {
        assert_eq!(&packet.data[..], &block[..]);
        packets += 1;
    }
    assert_eq!(packets, 20);
    assert_eq!(
        reader.decode_into(
            16,
            [&mut [0.0f32; 16][..], &mut [0.0f32; 16][..]].into_iter()
        ),
        Err(CodecFailure::Refused)
    );
}

#[test]
fn takes_a_stream_whose_fill_elements_carry_no_sbr_as_aac_lc() {
    let session = DecodeSession::open(MemorySource(adts(
        20,
        6,
        &silent_block(&[(9, 0x1), (2, 0x0)]),
    )));
    assert_eq!(
        session.map(|session| session.description().codec),
        Ok(Codec::AacLc)
    );
}
