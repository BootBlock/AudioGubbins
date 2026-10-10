//! Opus encoded by the module, written into Ogg as RFC 7845 asks and decoded
//! by the module, returns every frame given, aligned, within a stated error
//! (ADR-0091: lossy round trips within a stated error against the source).

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    reason = "test signals and files of small, known ranges"
)]

mod common;

use audiogubbins_codecs::{
    Codec, CodecFailure, Container, OpusApplication, OpusEncoder, OpusFrameDuration,
    OpusRateControl, OpusSettings, StatedLayout,
};
use common::{ogg_opus, open_and_decode, sine};

/// The signal-to-noise ratio a tone keeps through the encoder at 64 kbps a
/// channel, measured over the whole decoded stream against the source,
/// sample for sample: the pre-skip and end trimming must align them exactly
/// for it to hold.
const SNR_FLOOR_DB: f64 = 25.0;

/// The floor of the LFE, which Opus codes at a narrow bandwidth with few
/// bits.
const LFE_SNR_FLOOR_DB: f64 = 20.0;

fn stereo(rate: u32) -> OpusSettings {
    OpusSettings {
        sample_rate: rate,
        channels: 2,
        bit_rate: 128_000,
        application: OpusApplication::Audio,
        frame_duration: OpusFrameDuration::Ms20,
        complexity: 10,
        rate_control: OpusRateControl::Variable,
        input_sample_rate: 44_100,
    }
}

fn snr_db(source: &[f32], decoded: &[f32]) -> f64 {
    let signal: f64 = source.iter().map(|&sample| f64::from(sample).powi(2)).sum();
    let noise: f64 = source
        .iter()
        .zip(decoded)
        .map(|(&a, &b)| (f64::from(a) - f64::from(b)).powi(2))
        .sum();
    10.0 * (signal / noise.max(f64::MIN_POSITIVE)).log10()
}

#[test]
fn a_stereo_tone_returns_every_frame_aligned_above_the_floor() {
    let frames = 48_000 + 123;
    let planes = vec![
        sine(frames, 997.0, 48_000.0, 0.5),
        sine(frames, 440.0, 48_000.0, 0.4),
    ];
    let (session, decoded) = open_and_decode(ogg_opus(stereo(48_000), &planes)).expect("decodable");
    let description = session.description();
    assert_eq!(description.codec, Codec::Opus);
    assert_eq!(description.container, Container::Ogg);
    assert_eq!(description.sample_rate, 48_000);
    assert_eq!(description.layout, StatedLayout::Speakers(0b11));
    assert_eq!(description.priming, Some(312));
    assert_eq!(description.total_frames, Some(frames as u64));
    for (source, plane) in planes.iter().zip(&decoded) {
        assert_eq!(plane.len(), frames);
        let snr = snr_db(source, plane);
        assert!(snr > SNR_FLOOR_DB, "{snr} dB");
    }
}

#[test]
fn audio_at_a_lower_opus_rate_decodes_at_48_khz() {
    let frames = 24_000;
    let planes = vec![sine(frames, 500.0, 24_000.0, 0.5)];
    let settings = OpusSettings {
        sample_rate: 24_000,
        channels: 1,
        bit_rate: 64_000,
        ..stereo(24_000)
    };
    let (session, decoded) = open_and_decode(ogg_opus(settings, &planes)).expect("decodable");
    assert_eq!(session.description().sample_rate, 48_000);
    assert_eq!(session.description().layout, StatedLayout::Speakers(0b100));
    assert_eq!(decoded[0].len(), frames * 2);
    let expected = sine(frames * 2, 500.0, 48_000.0, 0.5);
    let snr = snr_db(&expected, &decoded[0]);
    assert!(snr > SNR_FLOOR_DB, "{snr} dB");
}

/// The tone each surround channel carries, so its place can be told after:
/// below 120 Hz for the LFE, which Opus codes at a narrow bandwidth.
fn tone_of(channel: usize) -> f64 {
    if channel == 3 {
        60.0
    } else {
        300.0 + 250.0 * channel as f64
    }
}

#[test]
fn surround_keeps_each_channel_in_its_speaker_mask_place() {
    let frames = 24_000;
    let planes: Vec<Vec<f32>> = (0..6)
        .map(|channel| sine(frames, tone_of(channel), 48_000.0, 0.4))
        .collect();
    let settings = OpusSettings {
        channels: 6,
        bit_rate: 6 * 64_000,
        ..stereo(48_000)
    };
    let (session, decoded) = open_and_decode(ogg_opus(settings, &planes)).expect("decodable");
    assert_eq!(
        session.description().layout,
        StatedLayout::Speakers(0b11_1111)
    );
    for (channel, plane) in decoded.iter().enumerate() {
        assert_eq!(plane.len(), frames);
        let best = (0..6)
            .map(|candidate| snr_db(&planes[candidate], plane))
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(candidate, _)| candidate);
        assert_eq!(best, Some(channel));
        let snr = snr_db(&planes[channel], plane);
        let floor = if channel == 3 {
            LFE_SNR_FLOOR_DB
        } else {
            SNR_FLOOR_DB
        };
        assert!(snr > floor, "{channel}: {snr} dB");
    }
}

#[test]
fn every_frame_duration_and_application_returns_every_frame() {
    let frames = 10_000;
    let planes = vec![sine(frames, 1_000.0, 16_000.0, 0.5)];
    for duration in [
        OpusFrameDuration::Ms2_5,
        OpusFrameDuration::Ms5,
        OpusFrameDuration::Ms10,
        OpusFrameDuration::Ms40,
        OpusFrameDuration::Ms60,
        OpusFrameDuration::Ms80,
        OpusFrameDuration::Ms100,
        OpusFrameDuration::Ms120,
    ] {
        for application in [
            OpusApplication::Audio,
            OpusApplication::Voip,
            OpusApplication::RestrictedLowDelay,
        ] {
            for rate_control in [
                OpusRateControl::Constant,
                OpusRateControl::ConstrainedVariable,
            ] {
                let settings = OpusSettings {
                    sample_rate: 16_000,
                    channels: 1,
                    bit_rate: 32_000,
                    application,
                    frame_duration: duration,
                    complexity: 5,
                    rate_control,
                    input_sample_rate: 0,
                };
                let (_, decoded) = open_and_decode(ogg_opus(settings, &planes)).expect("decodable");
                assert_eq!(decoded[0].len(), frames * 3, "{duration:?} {application:?}");
            }
        }
    }
}

#[test]
fn encodes_the_same_samples_to_the_same_bytes() {
    let planes = vec![
        sine(9_600, 997.0, 48_000.0, 0.5),
        sine(9_600, 440.0, 48_000.0, 0.4),
    ];
    assert_eq!(
        ogg_opus(stereo(48_000), &planes),
        ogg_opus(stereo(48_000), &planes)
    );
}

#[test]
fn refuses_settings_opus_cannot_encode_and_samples_after_the_end() {
    for refused in [
        OpusSettings {
            sample_rate: 44_100,
            ..stereo(48_000)
        },
        OpusSettings {
            channels: 9,
            ..stereo(48_000)
        },
        OpusSettings {
            channels: 0,
            ..stereo(48_000)
        },
        OpusSettings {
            complexity: 11,
            ..stereo(48_000)
        },
        OpusSettings {
            bit_rate: 600,
            ..stereo(48_000)
        },
        OpusSettings {
            bit_rate: 700_000,
            ..stereo(48_000)
        },
    ] {
        assert_eq!(
            OpusEncoder::new(refused).err(),
            Some(CodecFailure::Refused),
            "{refused:?}"
        );
    }
    let mut encoder = OpusEncoder::new(stereo(48_000)).expect("valid");
    let quiet = vec![0.0f32; 960];
    assert_eq!(encoder.push(&[&quiet], 960), Err(CodecFailure::Refused));
    assert_eq!(
        encoder.push(&[&quiet, &quiet], 961),
        Err(CodecFailure::Refused)
    );
    assert_eq!(encoder.push(&[&quiet, &quiet], 960), Ok(()));
    assert_eq!(encoder.finish(), Ok(()));
    assert_eq!(
        encoder.push(&[&quiet, &quiet], 960),
        Err(CodecFailure::Refused)
    );
    assert_eq!(encoder.end_granule(), 312 + 960);
}
