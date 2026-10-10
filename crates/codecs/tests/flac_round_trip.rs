//! FLAC frames from the module's encoder, written into a stream and decoded by
//! the module's decoder, come back bit for bit (ADR-0091: every lossless
//! format round-trips exactly).

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    reason = "test signals and files of small, known ranges"
)]

mod common;

use audiogubbins_codecs::{
    Codec, CodecFailure, Container, FlacFrameEncoder, FlacSettings, StatedLayout,
};
use common::{flac_stream, integer_signal, open_and_decode};

/// Encodes `channels` channels of a signal and decodes it, asserting every
/// sample returns exactly and the description states the stream.
fn round_trip(settings: FlacSettings, frames: usize) {
    let planes: Vec<Vec<i32>> = (0..settings.channels)
        .map(|channel| {
            integer_signal(
                frames,
                3.0 + f64::from(channel),
                settings.bits_per_sample,
                u64::from(channel),
            )
        })
        .collect();
    let (session, decoded) = open_and_decode(flac_stream(settings, &planes)).expect("decodable");
    let description = session.description();
    assert_eq!(description.codec, Codec::Flac);
    assert_eq!(description.container, Container::Flac);
    assert_eq!(description.sample_rate, settings.sample_rate);
    assert_eq!(description.channel_count, u32::from(settings.channels));
    assert_eq!(
        description.bits_per_sample,
        Some(u32::from(settings.bits_per_sample))
    );
    assert_eq!(description.total_frames, Some(frames as u64));
    assert!(description.decodable);
    let scale = f64::from(1u32 << (settings.bits_per_sample - 1));
    for (original, plane) in planes.iter().zip(&decoded) {
        assert_eq!(plane.len(), frames);
        let returned: Vec<i32> = plane
            .iter()
            .map(|&sample| (f64::from(sample) * scale) as i32)
            .collect();
        assert_eq!(&returned, original);
    }
}

#[test]
fn sixteen_bit_stereo_returns_bit_for_bit_with_a_short_last_frame() {
    round_trip(
        FlacSettings {
            channels: 2,
            bits_per_sample: 16,
            sample_rate: 44_100,
            block_size: 4_096,
            level: 5,
        },
        20_000,
    );
}

#[test]
fn every_depth_flacenc_allows_returns_bit_for_bit() {
    for (bits, level) in [(8, 0), (12, 3), (20, 7), (24, 8)] {
        round_trip(
            FlacSettings {
                channels: 1,
                bits_per_sample: bits,
                sample_rate: 48_000,
                block_size: 1_152,
                level,
            },
            5_000,
        );
    }
}

#[test]
fn surround_states_flacs_channel_order_as_a_speaker_mask() {
    let settings = FlacSettings {
        channels: 6,
        bits_per_sample: 24,
        sample_rate: 96_000,
        block_size: 2_048,
        level: 2,
    };
    round_trip(settings, 6_000);
    let planes: Vec<Vec<i32>> = (0..6)
        .map(|channel| integer_signal(300, 1.0, 24, channel))
        .collect();
    let (session, _) = open_and_decode(flac_stream(settings, &planes)).expect("decodable");
    // FLAC's six channels are 5.1: front left, right and centre, LFE, and the
    // back pair.
    assert_eq!(
        session.description().layout,
        StatedLayout::Speakers(0b11_1111)
    );
}

#[test]
fn refuses_what_flac_cannot_encode() {
    let valid = FlacSettings {
        channels: 2,
        bits_per_sample: 16,
        sample_rate: 44_100,
        block_size: 4_096,
        level: 5,
    };
    for refused in [
        FlacSettings {
            bits_per_sample: 3,
            ..valid
        },
        FlacSettings {
            bits_per_sample: 33,
            ..valid
        },
        FlacSettings {
            channels: 9,
            ..valid
        },
        FlacSettings {
            channels: 0,
            ..valid
        },
        FlacSettings {
            block_size: 16,
            ..valid
        },
        FlacSettings {
            block_size: 40_000,
            ..valid
        },
        FlacSettings { level: 9, ..valid },
        FlacSettings {
            sample_rate: 0,
            ..valid
        },
        FlacSettings {
            sample_rate: 700_001,
            ..valid
        },
    ] {
        assert_eq!(
            FlacFrameEncoder::new(refused).err(),
            Some(CodecFailure::Refused),
            "{refused:?}"
        );
    }
    let mut encoder = FlacFrameEncoder::new(valid).expect("valid settings");
    let loud = vec![40_000; 64];
    let quiet = vec![0; 64];
    // A sample past 16 bits, a missing channel, and more frames than a block.
    assert_eq!(
        encoder.encode(&[&loud, &quiet], 64, 0).err(),
        Some(CodecFailure::Refused)
    );
    assert_eq!(
        encoder.encode(&[&quiet], 64, 0).err(),
        Some(CodecFailure::Refused)
    );
    assert_eq!(
        encoder.encode(&[&quiet, &quiet], 5_000, 0).err(),
        Some(CodecFailure::Refused)
    );
    assert_eq!(
        encoder.encode(&[&quiet, &quiet], 0, 0).err(),
        Some(CodecFailure::Refused)
    );
    assert_eq!(
        encoder.encode(&[&quiet, &quiet], 64, u32::MAX).err(),
        Some(CodecFailure::Refused)
    );
}

#[test]
fn encodes_the_same_frame_to_the_same_bytes() {
    let settings = FlacSettings {
        channels: 2,
        bits_per_sample: 24,
        sample_rate: 48_000,
        block_size: 4_096,
        level: 8,
    };
    let planes: Vec<Vec<i32>> = (0..2)
        .map(|channel| integer_signal(4_096, 5.0, 24, channel))
        .collect();
    let slices: Vec<&[i32]> = planes.iter().map(Vec::as_slice).collect();
    let first = FlacFrameEncoder::new(settings)
        .expect("valid")
        .encode(&slices, 4_096, 9)
        .map(<[u8]>::to_vec);
    let second = FlacFrameEncoder::new(settings)
        .expect("valid")
        .encode(&slices, 4_096, 9)
        .map(<[u8]>::to_vec);
    assert_eq!(first, second);
    assert!(first.is_ok());
}
