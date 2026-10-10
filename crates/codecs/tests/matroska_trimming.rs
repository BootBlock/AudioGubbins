//! Matroska and `WebM` state a codec's delay in the track's `CodecDelay` and
//! the padding of a block in its group's `DiscardPadding`, neither of which
//! Symphonia's reader applies. The session reads both itself, so a decoded
//! stream has exactly the length the file states (ADR-0091, amended).
//!
//! Each file is written here by a minimal muxer around packets of the
//! module's own encoders, and the Opus decoded from it is held to the Ogg
//! Opus of the same packets, which the session trims by RFC 7845.

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_precision_loss,
    reason = "test signals and files of small, known ranges"
)]

mod common;

use audiogubbins_codecs::{
    Codec, CodecFailure, Container, FlacSettings, OpusApplication, OpusFrameDuration,
    OpusRateControl, OpusSettings,
};
use common::{
    EncodedOpus, MatroskaLayout, encode_opus, flac_stream, integer_signal, matroska, nanoseconds,
    ogg_of, open_and_decode, sine,
};

const OPUS_RATE: u32 = 48_000;

fn settings(channels: u8) -> OpusSettings {
    OpusSettings {
        sample_rate: OPUS_RATE,
        channels,
        bit_rate: 64_000 * u32::from(channels),
        application: OpusApplication::Audio,
        frame_duration: OpusFrameDuration::Ms20,
        complexity: 5,
        rate_control: OpusRateControl::Variable,
        input_sample_rate: OPUS_RATE,
    }
}

fn encoded(channels: u8, frames: usize) -> EncodedOpus {
    let planes: Vec<Vec<f32>> = (0..channels)
        .map(|channel| sine(frames, 440.0 + 110.0 * f64::from(channel), 48_000.0, 0.4))
        .collect();
    encode_opus(settings(channels), &planes)
}

/// The `WebM` layout of `encoded` that states its delay and its end exactly.
fn webm_layout(encoded: &EncodedOpus, channels: u8) -> MatroskaLayout<'static> {
    let padding = encoded.decoded_length() - encoded.pre_skip - encoded.stated_length();
    MatroskaLayout {
        doc_type: "webm",
        codec_id: "A_OPUS",
        rate: OPUS_RATE,
        channels,
        codec_delay: Some(nanoseconds(encoded.pre_skip, OPUS_RATE)),
        first_padding: None,
        last_padding: Some(nanoseconds(padding, OPUS_RATE) as i64),
        last_block_packets: 1,
        unknown_sizes: false,
    }
}

fn file_of(layout: MatroskaLayout<'_>, encoded: &EncodedOpus) -> Vec<u8> {
    let packets: Vec<(&[u8], u64)> = encoded
        .packets
        .iter()
        .map(|packet| (packet.bytes.as_slice(), u64::from(packet.frames)))
        .collect();
    matroska(layout, &encoded.head, &packets)
}

/// What the session decodes from the Ogg Opus of the same packets.
fn from_ogg(encoded: &EncodedOpus) -> Vec<Vec<f32>> {
    open_and_decode(ogg_of(encoded)).expect("decodable Ogg").1
}

#[test]
fn webm_opus_has_exactly_the_stated_length_in_mono_and_stereo() {
    for (channels, frames) in [(1u8, 48_000 + 123), (2, 10_007), (2, 961)] {
        let encoded = encoded(channels, frames);
        assert_eq!(encoded.stated_length(), frames as u64);
        let (session, decoded) =
            open_and_decode(file_of(webm_layout(&encoded, channels), &encoded)).expect("decodable");
        let description = session.description();
        assert_eq!(description.codec, Codec::Opus);
        assert_eq!(description.container, Container::Webm);
        assert_eq!(description.priming, Some(encoded.pre_skip));
        for plane in &decoded {
            assert_eq!(plane.len(), frames, "{channels} channels of {frames}");
        }
        assert_eq!(decoded, from_ogg(&encoded));
    }
}

#[test]
fn padding_across_a_laced_block_is_trimmed_from_its_end() {
    let encoded = encoded(2, 20_000);
    // A last block of three packets whose padding reaches back into the
    // second: the file states a length 1 500 frames short of the signal's.
    let short = 1_500;
    let padding = encoded.decoded_length() - encoded.pre_skip - encoded.stated_length() + short;
    let layout = MatroskaLayout {
        last_padding: Some(nanoseconds(padding, OPUS_RATE) as i64),
        last_block_packets: 3,
        ..webm_layout(&encoded, 2)
    };
    let (_, decoded) = open_and_decode(file_of(layout, &encoded)).expect("decodable");
    let length = 20_000 - short as usize;
    let mut expected = from_ogg(&encoded);
    for plane in &mut expected {
        plane.truncate(length);
    }
    assert_eq!(decoded, expected);
}

#[test]
fn matroska_of_unknown_sizes_without_codec_delay_trims_the_pre_skip() {
    let encoded = encoded(2, 30_000);
    let layout = MatroskaLayout {
        doc_type: "matroska",
        codec_delay: None,
        unknown_sizes: true,
        ..webm_layout(&encoded, 2)
    };
    let (session, decoded) = open_and_decode(file_of(layout, &encoded)).expect("decodable");
    assert_eq!(session.description().container, Container::Matroska);
    assert_eq!(decoded, from_ogg(&encoded));
}

#[test]
fn negative_padding_trims_a_blocks_start_beyond_the_codec_delay() {
    let encoded = encoded(1, 12_000);
    let beyond = 188;
    let layout = MatroskaLayout {
        first_padding: Some(-(nanoseconds(encoded.pre_skip + beyond, OPUS_RATE) as i64)),
        ..webm_layout(&encoded, 1)
    };
    let (_, decoded) = open_and_decode(file_of(layout, &encoded)).expect("decodable");
    let expected: Vec<Vec<f32>> = from_ogg(&encoded)
        .into_iter()
        .map(|plane| plane[beyond as usize..].to_vec())
        .collect();
    assert_eq!(decoded, expected);
}

#[test]
fn padding_past_its_block_is_malformed() {
    let encoded = encoded(1, 5_000);
    let layout = MatroskaLayout {
        last_padding: Some(nanoseconds(5_000, OPUS_RATE) as i64),
        ..webm_layout(&encoded, 1)
    };
    let refused = open_and_decode(file_of(layout, &encoded)).err();
    assert_eq!(refused, Some(CodecFailure::Malformed));
}

#[test]
fn flac_in_matroska_has_its_codec_delay_and_padding_trimmed() {
    let settings = FlacSettings {
        channels: 2,
        bits_per_sample: 16,
        sample_rate: 44_100,
        block_size: 1_152,
        level: 5,
    };
    let frames = 10_000;
    let planes: Vec<Vec<i32>> = (0..2)
        .map(|channel| integer_signal(frames, 4.0 + channel as f64, 16, channel))
        .collect();
    let stream = flac_stream(settings, &planes);
    // The signature and STREAMINFO are the codec's configuration; the frames
    // follow, each a packet.
    let (private, mut rest) = stream.split_at(42);
    let mut packets = Vec::new();
    for start in (0..frames).step_by(1_152) {
        let length = 1_152.min(frames - start);
        let slices: Vec<&[i32]> = planes
            .iter()
            .map(|plane| &plane[start..start + length])
            .collect();
        let size = audiogubbins_codecs::FlacFrameEncoder::new(settings)
            .expect("valid")
            .encode(&slices, length, (start / 1_152) as u32)
            .expect("encodable")
            .len();
        let (frame, after) = rest.split_at(size);
        packets.push((frame, length as u64));
        rest = after;
    }
    let (delay, padding) = (100u64, 50u64);
    let layout = MatroskaLayout {
        doc_type: "matroska",
        codec_id: "A_FLAC",
        rate: 44_100,
        channels: 2,
        codec_delay: Some(nanoseconds(delay, 44_100)),
        first_padding: None,
        last_padding: Some(nanoseconds(padding, 44_100) as i64),
        last_block_packets: 1,
        unknown_sizes: false,
    };
    let (session, decoded) =
        open_and_decode(matroska(layout, private, &packets)).expect("decodable");
    assert_eq!(session.description().codec, Codec::Flac);
    assert_eq!(session.description().priming, Some(delay));
    for (original, plane) in planes.iter().zip(&decoded) {
        let kept = &original[delay as usize..frames - padding as usize];
        let returned: Vec<i32> = plane
            .iter()
            .map(|&sample| (sample * 32_768.0) as i32)
            .collect();
        assert_eq!(returned, kept);
    }
}
