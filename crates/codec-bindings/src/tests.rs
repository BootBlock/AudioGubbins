//! The ABI driven natively: what each call answers, and that nothing a caller
//! passes makes it panic. The TypeScript runtime's tests drive the built
//! module itself.

#![allow(
    clippy::cast_precision_loss,
    clippy::float_cmp,
    reason = "small files whose sizes and counts are exact in an f64"
)]

use audiogubbins_codecs::{FlacFrameEncoder, FlacSettings};

use crate::decoding::{
    ag_decoder_close, ag_decoder_decode, ag_decoder_description, ag_decoder_open,
    ag_decoder_packet_frames, ag_decoder_read_packet,
};
use crate::flac::{ag_flac_encoder_close, ag_flac_encoder_create, ag_flac_encoder_encode};
use crate::opus::{
    ag_opus_decoder_create, ag_opus_decoder_decode, ag_opus_decoder_final_range,
    ag_opus_encoder_close, ag_opus_encoder_create, ag_opus_encoder_end_granule,
    ag_opus_encoder_finish, ag_opus_encoder_head, ag_opus_encoder_next_packet,
    ag_opus_encoder_packet_frames, ag_opus_encoder_push,
};
use crate::{
    ABI_VERSION, BAD_HANDLE, DONE, EXHAUSTED, REFUSED, TOO_SMALL, UNRECOGNISED, UNSUPPORTED,
    ag_codec_abi_version, ag_codec_bytes_create, ag_codec_bytes_release, ag_codec_floats_create,
    ag_codec_floats_release, ag_codec_ints_create, register_host_file, with_objects,
};

/// A handle a call answered, as the `u32` other calls take.
fn made(code: i32) -> u32 {
    u32::try_from(code).unwrap_or(0)
}

/// MPEG-1 Layer III frames of silence: a header, then side information and
/// main data of zeros.
fn silent_mp3(count: usize) -> Vec<u8> {
    let mut frame = vec![0u8; 417];
    frame[..4].copy_from_slice(&[0xff, 0xfb, 0x90, 0x00]);
    frame.repeat(count)
}

#[test]
fn answers_its_version() {
    assert_eq!(ag_codec_abi_version(), ABI_VERSION);
}

#[test]
fn opens_describes_and_decodes_a_file_the_host_registered() {
    let file = silent_mp3(20);
    let size = file.len() as f64;
    let session = made(ag_decoder_open(register_host_file(file), size));
    assert_ne!(session, 0);
    // A native address need not fit the ABI's u32, so the record is read
    // from the table here, as the host reads it from memory.
    let record =
        with_objects(|objects| objects.decoders.get_mut(session).map(|entry| *entry.record));
    let record = record.expect("an open session");
    assert_eq!(&record[..4], &[3.0, 2.0, 44_100.0, 2.0]);
    assert_eq!(&record[4..6], &[1.0, 3.0]);
    assert!(record[6].is_nan());
    assert_eq!(record[11], 1.0);

    let samples = made(ag_codec_floats_create(2 * 1_000));
    assert_eq!(ag_decoder_decode(session, samples, 1_001), TOO_SMALL);
    assert_eq!(ag_decoder_decode(session, samples, 0), REFUSED);
    let mut total = 0;
    loop {
        let frames = ag_decoder_decode(session, samples, 1_000);
        assert!(frames >= 0, "{frames}");
        if frames == 0 {
            break;
        }
        total += frames;
    }
    assert_eq!(total, 20 * 1_152);
    // Decoded, the session reads no packets.
    assert_eq!(ag_decoder_read_packet(session), REFUSED);
    assert_eq!(ag_decoder_close(session), DONE);
    assert_eq!(ag_decoder_close(session), BAD_HANDLE);
    assert_eq!(ag_decoder_description(session), 0);
    assert_eq!(ag_codec_floats_release(samples), DONE);
}

#[test]
fn reads_packets_undecoded() {
    let file = silent_mp3(5);
    let size = file.len() as f64;
    let session = made(ag_decoder_open(register_host_file(file), size));
    assert_eq!(ag_decoder_packet_frames(session), -1.0);
    let mut packets = 0;
    while ag_decoder_read_packet(session) > 0 {
        assert_eq!(ag_decoder_packet_frames(session), 1_152.0);
        packets += 1;
    }
    assert_eq!(packets, 5);
    assert_eq!(ag_decoder_close(session), DONE);
}

#[test]
fn refuses_files_and_sizes_it_cannot_open() {
    assert_eq!(
        ag_decoder_open(register_host_file(vec![0; 4_096]), 4_096.0),
        UNRECOGNISED
    );
    let source = register_host_file(silent_mp3(4));
    for size in [-1.0, 0.5, f64::NAN, 1e300] {
        assert_eq!(ag_decoder_open(source, size), REFUSED);
    }
    // A source the host never registered reads as nothing.
    assert!(ag_decoder_open(9_999, 1_000.0) < 0);
}

#[test]
fn encodes_flac_frames_from_integer_buffers() {
    let settings = FlacSettings {
        channels: 2,
        bits_per_sample: 16,
        sample_rate: 48_000,
        block_size: 256,
        level: 5,
    };
    let encoder = made(ag_flac_encoder_create(2, 16, 48_000, 256, 5));
    assert_ne!(encoder, 0);
    let samples = made(ag_codec_ints_create(512));
    let ramp: Vec<i32> = (0..512).map(|index| (index * 37) % 2_000 - 1_000).collect();
    with_objects(|objects| {
        if let Some(buffer) = objects.ints.get_mut(samples) {
            buffer.copy_from_slice(&ramp);
        }
    });
    let length = ag_flac_encoder_encode(encoder, samples, 256, 3);
    let planes = [&ramp[..256], &ramp[256..]];
    let expected = FlacFrameEncoder::new(settings)
        .map(|mut direct| direct.encode(&planes, 256, 3).map(<[u8]>::len));
    assert_eq!(
        usize::try_from(length).ok(),
        expected.ok().and_then(Result::ok)
    );
    assert_eq!(ag_flac_encoder_encode(encoder, samples, 257, 4), TOO_SMALL);
    assert_eq!(ag_flac_encoder_encode(encoder, 999, 256, 4), BAD_HANDLE);
    assert_eq!(ag_flac_encoder_create(2, 32, 48_000, 256, 5), REFUSED);
    assert_eq!(ag_flac_encoder_create(2, 16, 48_000, 256, 300), REFUSED);
    assert_eq!(ag_flac_encoder_close(encoder), DONE);
}

#[test]
fn encodes_opus_packets_with_their_header_and_end_granule() {
    let encoder = made(ag_opus_encoder_create(
        48_000, 2, 96_000, 0, 3, 10, 0, 44_100,
    ));
    assert_ne!(encoder, 0);
    assert_eq!(ag_opus_encoder_head(encoder), 19);
    let samples = made(ag_codec_floats_create(2 * 1_000));
    for _ in 0..5 {
        assert_eq!(ag_opus_encoder_push(encoder, samples, 1_000), DONE);
    }
    assert_eq!(ag_opus_encoder_push(encoder, samples, 1_001), TOO_SMALL);
    assert_eq!(ag_opus_encoder_finish(encoder), DONE);
    assert_eq!(ag_opus_encoder_push(encoder, samples, 10), REFUSED);
    let mut frames = 0;
    while ag_opus_encoder_next_packet(encoder) > 0 {
        frames += ag_opus_encoder_packet_frames(encoder);
    }
    // Every frame and the pre-skip, in whole 20 ms packets.
    assert_eq!(frames, 6 * 960);
    assert_eq!(ag_opus_encoder_end_granule(encoder), 312.0 + 5_000.0);
    assert_eq!(ag_opus_encoder_close(encoder), DONE);
    for refused in [
        ag_opus_encoder_create(44_100, 2, 96_000, 0, 3, 10, 0, 0),
        ag_opus_encoder_create(48_000, 2, 96_000, 3, 3, 10, 0, 0),
        ag_opus_encoder_create(48_000, 2, 96_000, 0, 9, 10, 0, 0),
        ag_opus_encoder_create(48_000, 2, 96_000, 0, 3, 10, 3, 0),
        ag_opus_encoder_create(48_000, 300, 96_000, 0, 3, 10, 0, 0),
    ] {
        assert_eq!(refused, REFUSED);
    }
}

#[test]
fn decodes_opus_packets_and_conceals_a_lost_one() {
    let decoder = made(ag_opus_decoder_create(2));
    let packet = made(ag_codec_bytes_create(4));
    let samples = made(ag_codec_floats_create(2 * 5_760));
    // A TOC byte of a 20 ms CELT frame and no payload decodes to silence.
    with_objects(|objects| {
        if let Some(bytes) = objects.bytes.get_mut(packet) {
            bytes[0] = 0xfc;
        }
    });
    assert_eq!(
        ag_opus_decoder_decode(decoder, packet, 1, samples, 5_760),
        960
    );
    assert!(ag_opus_decoder_final_range(decoder) >= 0.0);
    assert_eq!(
        ag_opus_decoder_decode(decoder, packet, 0, samples, 5_760),
        960
    );
    assert_eq!(
        ag_opus_decoder_decode(decoder, packet, 1, samples, 5_759),
        TOO_SMALL
    );
    assert_eq!(
        ag_opus_decoder_decode(decoder, packet, 5, samples, 5_760),
        TOO_SMALL
    );
    assert_eq!(ag_opus_decoder_create(3), REFUSED);
    assert_eq!(ag_codec_bytes_release(packet), DONE);
    assert_eq!(
        ag_opus_decoder_decode(decoder, packet, 1, samples, 5_760),
        BAD_HANDLE
    );
}

#[test]
fn answers_a_spent_table_and_unsupported_failures_by_their_codes() {
    assert_eq!(crate::handle(0), EXHAUSTED);
    assert_eq!(
        crate::code_of(audiogubbins_codecs::CodecFailure::Unsupported),
        UNSUPPORTED
    );
}
