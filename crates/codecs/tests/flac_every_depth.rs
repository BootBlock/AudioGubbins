//! FLAC frames of the depths the module's own encoder serves (32 bits, and
//! every depth from 4 to 31 `flacenc` does not encode), written into a
//! stream and decoded by Symphonia's FLAC decoder to integers, come back bit
//! for bit (ADR-0091, amended). Symphonia's decoder checks every frame
//! header's CRC-8; each frame's CRC-16 is checked here.

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    reason = "test signals and files of small, known ranges"
)]

mod common;

use std::io::Cursor;

use audiogubbins_codecs::{CodecFailure, FlacFrameEncoder, FlacSettings};
use common::{Lcg, flac_stream};
use symphonia::core::codecs::CodecParameters;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;

/// The CRC-16 FLAC ends a frame with, computed bit by bit: polynomial
/// 0x8005, unreflected, from zero.
fn crc16(bytes: &[u8]) -> u16 {
    let mut crc = 0u16;
    for &byte in bytes {
        crc ^= u16::from(byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 == 0 {
                crc << 1
            } else {
                (crc << 1) ^ 0x8005
            };
        }
    }
    crc
}

/// Every sample of a FLAC stream as Symphonia's decoder gives it, one plane
/// per channel, at the stream's own depth.
fn decoded_integers(bytes: Vec<u8>, bits: u8) -> Vec<Vec<i32>> {
    let stream = MediaSourceStream::new(
        Box::new(Cursor::new(bytes)),
        MediaSourceStreamOptions::default(),
    );
    let mut reader = symphonia::default::get_probe()
        .probe(
            &Hint::new(),
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .expect("a FLAC stream");
    let track = reader
        .default_track(TrackType::Audio)
        .cloned()
        .expect("an audio track");
    let Some(CodecParameters::Audio(params)) = track.codec_params else {
        panic!("an audio track's parameters");
    };
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .expect("a FLAC decoder");
    let mut planes: Vec<Vec<i32>> = Vec::new();
    let mut block: Vec<Vec<i32>> = Vec::new();
    while let Some(packet) = reader.next_packet().expect("a readable stream") {
        let frame = decoder.decode(&packet).expect("a decodable frame");
        frame.copy_to_vecs_planar::<i32>(&mut block);
        planes.resize(block.len(), Vec::new());
        for (plane, decoded) in planes.iter_mut().zip(&block) {
            // The decoder gives every depth at the top of 32 bits.
            plane.extend(
                decoded
                    .iter()
                    .map(|&sample| sample >> (32 - u32::from(bits))),
            );
        }
    }
    planes
}

/// Encodes `planes` and asserts the stream decodes to them exactly, and
/// that every frame ends in its CRC-16.
fn round_trip(settings: FlacSettings, planes: &[Vec<i32>]) {
    let stream = flac_stream(settings, planes);
    // Each frame is checked as it is encoded again here.
    let mut encoder = FlacFrameEncoder::new(settings).expect("valid settings");
    let block = settings.block_size as usize;
    for (number, start) in (0..planes[0].len()).step_by(block).enumerate() {
        let end = (start + block).min(planes[0].len());
        let slices: Vec<&[i32]> = planes.iter().map(|plane| &plane[start..end]).collect();
        let frame = encoder
            .encode(&slices, end - start, number as u32)
            .expect("an encodable frame");
        let (body, footer) = frame.split_at(frame.len() - 2);
        assert_eq!(crc16(body).to_be_bytes(), footer, "frame {number}");
    }
    let decoded = decoded_integers(stream, settings.bits_per_sample);
    assert_eq!(decoded.len(), planes.len());
    for (channel, (original, returned)) in planes.iter().zip(&decoded).enumerate() {
        assert_eq!(original.len(), returned.len(), "channel {channel}");
        let first_difference = original
            .iter()
            .zip(returned)
            .position(|(original, returned)| original != returned);
        assert_eq!(first_difference, None, "{settings:?}, channel {channel}");
    }
}

/// The extremes of `bits` bits.
fn extremes(bits: u8) -> (i32, i32) {
    let high = ((1i64 << (bits - 1)) - 1) as i32;
    (-high - 1, high)
}

/// A sine of `cycles` cycles over `frames` at full scale for `bits` bits.
fn full_sine(frames: usize, cycles: f64, bits: u8) -> Vec<i32> {
    let (_, high) = extremes(bits);
    (0..frames)
        .map(|frame| {
            let phase = std::f64::consts::TAU * cycles * frame as f64 / frames as f64;
            (phase.sin() * f64::from(high)).round() as i32
        })
        .collect()
}

/// Uniform noise over every value of `bits` bits.
fn noise(frames: usize, bits: u8, seed: u64) -> Vec<i32> {
    let mut generator = Lcg(seed);
    let unused = 32 - u32::from(bits);
    (0..frames)
        .map(|_| (generator.next_u32() as i32) >> unused)
        .collect()
}

/// A ramp that climbs from the lowest value of `bits` bits to the highest
/// and wraps, in steps of `step`.
fn ramp(frames: usize, bits: u8, step: i64) -> Vec<i32> {
    let (low, high) = extremes(bits);
    let span = i64::from(high) - i64::from(low) + 1;
    (0..frames as i64)
        .map(|frame| (i64::from(low) + (frame * step).rem_euclid(span)) as i32)
        .collect()
}

/// Every kind of signal, for each of `channels` channels, at `bits` bits.
fn signals(frames: usize, bits: u8, channels: usize) -> Vec<Vec<Vec<i32>>> {
    let (low, high) = extremes(bits);
    let alternating: Vec<i32> = (0..frames)
        .map(|frame| if frame % 2 == 0 { low } else { high })
        .collect();
    let bursts: Vec<i32> = (0..frames)
        .map(|frame| match (frame / 97) % 4 {
            0 => low,
            1 => high,
            2 => 0,
            _ => (frame as i32 % 5) - 2,
        })
        .collect();
    let kinds: Vec<Box<dyn Fn(usize) -> Vec<i32>>> = vec![
        Box::new(|_| vec![0; frames]),
        Box::new(|_| vec![high; frames]),
        Box::new(|_| vec![low; frames]),
        Box::new(|channel| noise(frames, bits, channel as u64 + 1)),
        Box::new(|channel| {
            ramp(
                frames,
                bits,
                1 + (1i64 << (bits.max(6) - 6)) * (channel as i64 + 1),
            )
        }),
        Box::new(|channel| full_sine(frames, 3.0 + channel as f64, bits)),
        Box::new(|_| alternating.clone()),
        Box::new(|_| bursts.clone()),
    ];
    kinds
        .iter()
        .map(|kind| (0..channels).map(kind).collect())
        .collect()
}

#[test]
fn thirty_two_bits_return_bit_for_bit_at_every_level() {
    for level in 0..=8 {
        let settings = FlacSettings {
            channels: 2,
            bits_per_sample: 32,
            sample_rate: 48_000,
            block_size: 1_024,
            level,
        };
        for planes in signals(3_000, 32, 2) {
            round_trip(settings, &planes);
        }
    }
}

#[test]
fn thirty_two_bits_return_bit_for_bit_in_one_to_eight_channels() {
    for channels in [1u8, 3, 6, 8] {
        let settings = FlacSettings {
            channels,
            bits_per_sample: 32,
            sample_rate: 96_000,
            block_size: 4_096,
            level: 8,
        };
        for planes in signals(9_000, 32, usize::from(channels)) {
            round_trip(settings, &planes);
        }
    }
}

#[test]
fn every_depth_flacenc_does_not_encode_returns_bit_for_bit() {
    for bits in [4u8, 7, 10, 18, 28, 31] {
        for level in [0, 5, 8] {
            let settings = FlacSettings {
                channels: 2,
                bits_per_sample: bits,
                sample_rate: 44_100,
                block_size: 1_152,
                level,
            };
            for planes in signals(2_500, bits, 2) {
                round_trip(settings, &planes);
            }
        }
    }
}

#[test]
fn odd_rates_and_block_sizes_return_bit_for_bit() {
    for (rate, block) in [(11_025, 100), (64_000, 4_095), (352_800, 32), (7, 1_000)] {
        let settings = FlacSettings {
            channels: 2,
            bits_per_sample: 32,
            sample_rate: rate,
            block_size: block,
            level: 5,
        };
        round_trip(settings, &[noise(2_345, 32, 9), full_sine(2_345, 2.0, 32)]);
    }
}

#[test]
fn compresses_what_predicts_and_encodes_the_same_frame_to_the_same_bytes() {
    let settings = FlacSettings {
        channels: 2,
        bits_per_sample: 32,
        sample_rate: 48_000,
        block_size: 4_096,
        level: 8,
    };
    let sine = full_sine(4_096, 5.0, 32);
    let quiet: Vec<i32> = sine.iter().map(|sample| sample >> 8).collect();
    let planes = [sine.as_slice(), quiet.as_slice()];
    let first = FlacFrameEncoder::new(settings)
        .expect("valid")
        .encode(&planes, 4_096, 9)
        .map(<[u8]>::to_vec)
        .expect("encodable");
    let second = FlacFrameEncoder::new(settings)
        .expect("valid")
        .encode(&planes, 4_096, 9)
        .map(<[u8]>::to_vec)
        .expect("encodable");
    assert_eq!(first, second);
    // Verbatim would take 4 096 × 2 × 4 bytes; a predicted sine takes far
    // fewer.
    assert!(first.len() < 4_096 * 2 * 4 / 2, "{} bytes", first.len());
}

#[test]
fn refuses_samples_outside_the_streams_bits() {
    let settings = FlacSettings {
        channels: 1,
        bits_per_sample: 10,
        sample_rate: 48_000,
        block_size: 64,
        level: 5,
    };
    let mut encoder = FlacFrameEncoder::new(settings).expect("valid settings");
    assert_eq!(
        encoder.encode(&[vec![512; 64]], 64, 0).err(),
        Some(CodecFailure::Refused)
    );
    assert_eq!(
        encoder.encode(&[vec![-513; 64]], 64, 0).err(),
        Some(CodecFailure::Refused)
    );
    assert!(encoder.encode(&[vec![-512; 64]], 64, 0).is_ok());
}
