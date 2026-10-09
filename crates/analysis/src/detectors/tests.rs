#![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

use audiogubbins_dsp_core::sine_of_turns;

use super::{DetectorFeatures, DetectorKind, DetectorSettings};
use crate::error::AnalysisError;
use crate::fingerprint;
use crate::signals::{Noise, golden};

/// The features `values` describe for `kind`.
fn features(kind: DetectorKind, values: &[f64], channels: usize, rate: u32) -> DetectorFeatures {
    let settings = DetectorSettings::from_values(kind, values).expect("whole settings");
    DetectorFeatures::new(channels, rate, settings).expect("valid settings")
}

/// Every record of `features` over `planar`, pushed whole.
fn records_of(mut features: DetectorFeatures, planar: &[f32]) -> Vec<f64> {
    let frames = planar.len() / features.channels();
    features.push(planar, frames).expect("planar");
    let width = features.record_width();
    let mut records = vec![0.0; width * 64];
    let mut all = Vec::new();
    loop {
        let count = features.pull(&mut records);
        all.extend_from_slice(&records[..count * width]);
        if count < 64 {
            return all;
        }
    }
}

/// A sample of `amplitude · sin(2π · turns · n)`, rounded once to `f32`.
fn sine(n: usize, turns: f64, amplitude: f64) -> f32 {
    #[allow(clippy::cast_possible_truncation, reason = "a sample")]
    let sample = (amplitude * sine_of_turns(crate::exact(n) * turns)) as f32;
    sample
}

#[test]
fn refuses_settings_out_of_range() {
    let refused = Err(AnalysisError::SettingRefused);
    assert_eq!(
        DetectorSettings::from_values(DetectorKind::Clicks, &[512.0]),
        refused
    );
    assert_eq!(
        DetectorSettings::from_values(DetectorKind::DcOffset, &[1.5, 1.0]),
        refused
    );
    assert_eq!(
        DetectorSettings::from_values(DetectorKind::DcOffset, &[-1.0, 1.0]),
        refused
    );
    let cases: [(DetectorKind, &[f64]); 15] = [
        (DetectorKind::Clicks, &[63.0, 3.0]),
        (DetectorKind::Clicks, &[512.0, 0.0]),
        (DetectorKind::Hum, &[8.0, 4.0, 2.0, 10.0]),
        (DetectorKind::Hum, &[4_096.0, 1_024.0, 2.0, 2.0]),
        (DetectorKind::Hum, &[4_000.0, 1_000.0, 2.0, 10.0]),
        (DetectorKind::NoiseFloor, &[256.0, 257.0, 0.1, 10.0]),
        (DetectorKind::NoiseFloor, &[256.0, 128.0, 1.5, 10.0]),
        (DetectorKind::NoiseFloor, &[256.0, 128.0, 0.1, 0.0]),
        (DetectorKind::Clipping, &[256.0, -0.1, 2.0]),
        (DetectorKind::Clipping, &[256.0, 0.0, 257.0]),
        (DetectorKind::DcOffset, &[0.0, 0.0]),
        (
            DetectorKind::Transients,
            &[256.0, 128.0, 8.0, f64::NAN, 0.0],
        ),
        (DetectorKind::Silence, &[0.0, 0.001]),
        (DetectorKind::Silence, &[256.0, -0.001]),
        (DetectorKind::Silence, &[256.0, f64::INFINITY]),
    ];
    for (kind, values) in cases {
        let settings = DetectorSettings::from_values(kind, values).expect("whole");
        assert_eq!(
            DetectorFeatures::new(2, 48_000, settings).unwrap_err(),
            AnalysisError::SettingRefused,
            "{kind:?} {values:?}"
        );
    }
    let hum = DetectorSettings::from_values(DetectorKind::Hum, &[256.0, 128.0, 2.0, 10.0]);
    assert_eq!(
        DetectorFeatures::new(1, 200, hum.expect("whole")).unwrap_err(),
        AnalysisError::RateRefused
    );
    let dc = DetectorSettings::DcOffset { window: 4, hop: 4 };
    assert_eq!(
        DetectorFeatures::new(0, 48_000, dc).unwrap_err(),
        AnalysisError::ChannelsRefused
    );
    assert_eq!(
        DetectorFeatures::new(1, 0, dc).unwrap_err(),
        AnalysisError::RateRefused
    );
    assert_eq!(DetectorKind::from_code(6), Some(DetectorKind::Silence));
    assert_eq!(DetectorKind::from_code(7), None);
}

#[test]
fn finds_a_known_dc_offset() {
    // A sine of 48 samples a period plus 0.25: every window of whole periods
    // has a mean of 0.25, to within the rounding of the samples to f32.
    let planar: Vec<f32> = (0..4_800)
        .map(|n| sine(n, 1.0 / 48.0, 0.5) + 0.25)
        .collect();
    let records = records_of(
        features(DetectorKind::DcOffset, &[480.0, 240.0], 1, 48_000),
        &planar,
    );
    assert_eq!(records.len(), 19);
    for mean in records {
        assert!((mean - 0.25).abs() < 1.0e-7, "{mean}");
    }
}

#[test]
fn reads_the_level_of_noise_and_keeps_its_floor_under_a_burst() {
    // Uniform noise of ±0.01 has an RMS of 0.01/√3, −44.77 dBFS; a second of
    // loud tone in the middle raises the level but not the tenth percentile.
    let mut noise = Noise::new(3);
    let planar: Vec<f32> = (0..48_000 * 5)
        .map(|n| {
            let tone = if (96_000..144_000).contains(&n) {
                sine(n, 0.01, 0.5)
            } else {
                0.0
            };
            #[allow(clippy::cast_possible_truncation, reason = "a sample")]
            let hiss = (0.01 * noise.next()) as f32;
            tone + hiss
        })
        .collect();
    let settings = [4_800.0, 4_800.0, 0.1, 50.0];
    let records = records_of(
        features(DetectorKind::NoiseFloor, &settings, 1, 48_000),
        &planar,
    );
    assert_eq!(records.len(), 2 * 50);
    let expected = 20.0 * (0.01_f64 / 3.0_f64.sqrt()).log10();
    for frame in 0..50 {
        let (level, floor) = (records[2 * frame], records[2 * frame + 1]);
        assert!(
            (floor - expected).abs() < 0.3,
            "frame {frame}: floor {floor}"
        );
        if (20..30).contains(&frame) {
            assert!(level > -10.0, "frame {frame}: level {level}");
        } else {
            assert!(
                (level - expected).abs() < 0.3,
                "frame {frame}: level {level}"
            );
        }
    }
}

#[test]
fn finds_the_runs_of_a_clipped_sine() {
    // 1.5 sin(2πn/48) clipped to ±1: |sin| ≥ 2/3 from n = 6 to 18 of each
    // half period, so every half period holds one run of 13 at magnitude 1.
    let planar: Vec<f32> = (0..960)
        .map(|n| sine(n, 1.0 / 48.0, 1.5).clamp(-1.0, 1.0))
        .collect();
    let records = records_of(
        features(DetectorKind::Clipping, &[480.0, 0.0, 2.0], 1, 48_000),
        &planar,
    );
    let runs: Vec<[f64; 4]> = records
        .chunks_exact(4)
        .map(|e| [e[0], e[1], e[2], e[3]])
        .collect();
    let expected: Vec<[f64; 4]> = (0..40)
        .map(|half| [0.0, crate::exact(24 * half + 6), 13.0, 1.0])
        .collect();
    assert_eq!(runs, expected);
}

#[test]
fn finds_the_runs_quiet_on_every_channel_block_by_block() {
    // 2⁻¹¹ is under the threshold on both channels but where the first
    // channel holds a half-scale stretch from 100 to 200, or a NaN at 700,
    // which is never quiet.
    let quiet = 1.0 / 2_048.0;
    let mut planar = vec![quiet; 2 * 1_024];
    for sample in &mut planar[100..200] {
        *sample = 0.5;
    }
    planar[700] = f32::NAN;
    let records = records_of(
        features(DetectorKind::Silence, &[256.0, 0.001], 2, 48_000),
        &planar,
    );
    let runs: Vec<[f64; 4]> = records
        .chunks_exact(4)
        .map(|e| [e[0], e[1], e[2], e[3]])
        .collect();
    let run = |first: usize, length: usize| {
        let squares = f64::from(quiet) * f64::from(quiet);
        [
            crate::exact(first),
            crate::exact(length),
            f64::from(quiet),
            crate::exact(2 * length) * squares,
        ]
    };
    assert_eq!(
        runs,
        [
            run(0, 100),
            run(200, 56),
            run(256, 256),
            run(512, 188),
            run(701, 67),
            run(768, 256),
        ]
    );
}

#[test]
fn finds_a_click_within_a_sample() {
    // Two tones and faint noise, with one sample knocked by 0.3.
    let mut noise = Noise::new(5);
    let mut planar: Vec<f32> = (0..8_192)
        .map(|n| {
            #[allow(clippy::cast_possible_truncation, reason = "a sample")]
            let hiss = (0.001 * noise.next()) as f32;
            sine(n, 0.011, 0.4) + sine(n, 0.037, 0.2) + hiss
        })
        .collect();
    planar[5_000] += 0.3;
    let records = records_of(
        features(DetectorKind::Clicks, &[1_024.0, 8.0], 1, 48_000),
        &planar,
    );
    let loudest = records
        .chunks_exact(4)
        .max_by(|a, b| a[2].abs().total_cmp(&b[2].abs()))
        .expect("the click is an event");
    assert!((loudest[1] - 5_000.0).abs() <= 1.0, "{loudest:?}");
    // Every event lies in the click's predictor span: the music has none.
    for event in records.chunks_exact(4) {
        assert!((4_999.0..=5_017.0).contains(&event[1]), "{event:?}");
    }
}

#[test]
fn finds_no_click_in_a_steady_signal() {
    // A tone at −14 dBFS is predicted to within the rounding of its samples
    // to f32, so every deviation is below the least an event has, however
    // many times the block's tiny MAD some of that rounding reaches.
    let planar: Vec<f32> = (0..4_096).map(|n| sine(n, 0.013, 0.2)).collect();
    let records = records_of(
        features(DetectorKind::Clicks, &[512.0, 3.0], 1, 48_000),
        &planar,
    );
    assert_eq!(records, Vec::<f64>::new());
}

#[test]
fn finds_a_hum_of_known_level_and_frequency() {
    // 50 Hz at −40 dBFS under −80 dBFS noise, at 48 kHz.
    let mut noise = Noise::new(9);
    let planar: Vec<f32> = (0..48_000 * 2)
        .map(|n| {
            #[allow(clippy::cast_possible_truncation, reason = "a sample")]
            let hiss = (1.0e-4 * noise.next()) as f32;
            sine(n, 50.0 / 48_000.0, 0.01) + hiss
        })
        .collect();
    let settings = [16_384.0, 8_192.0, 4.0, 20.0];
    let records = records_of(features(DetectorKind::Hum, &settings, 1, 48_000), &planar);
    assert_eq!(records.len(), 12 * 10);
    for record in records.chunks_exact(12) {
        let (frequency, level, floor) = (record[0], record[1], record[2]);
        assert!((frequency - 50.0).abs() < 0.1, "{record:?}");
        assert!((level + 40.0).abs() < 0.5, "{record:?}");
        assert!(floor < -70.0, "{record:?}");
        // Nothing at 60 Hz: its peak is the noise, near its floor.
        assert!(record[7] < -70.0, "{record:?}");
    }
}

#[test]
fn raises_the_flux_above_its_threshold_at_an_onset() {
    // Silence, then a tone from sample 16 384: the frame that first holds it
    // rises far above a threshold that silence kept at its offset.
    let planar: Vec<f32> = (0..32_768)
        .map(|n| if n >= 16_384 { sine(n, 0.05, 0.5) } else { 0.0 })
        .collect();
    let settings = [1_024.0, 512.0, 8.0, 1.5, 0.01];
    let records = records_of(
        features(DetectorKind::Transients, &settings, 1, 48_000),
        &planar,
    );
    let pairs: Vec<(f64, f64)> = records.chunks_exact(2).map(|p| (p[0], p[1])).collect();
    let onset = pairs.iter().position(|(flux, threshold)| flux > threshold);
    // Frame 31 spans 15 872 to 16 895, the first to hold the tone.
    assert_eq!(onset, Some(31));
    assert_eq!(pairs[30], (0.0, 0.01));
    assert!(pairs[31].0 > 0.1);
}

/// The golden settings of each kind, as the ABI carries them, and the rate.
pub(crate) const GOLDEN_SETTINGS: [(DetectorKind, &[f64], u32); 7] = [
    (DetectorKind::Clicks, &[512.0, 3.0], 48_000),
    (DetectorKind::Hum, &[1_024.0, 512.0, 20.0, 60.0], 8_000),
    (DetectorKind::NoiseFloor, &[256.0, 100.0, 0.2, 7.0], 48_000),
    (DetectorKind::Clipping, &[300.0, 0.05, 1.0], 48_000),
    (DetectorKind::DcOffset, &[500.0, 123.0], 48_000),
    (
        DetectorKind::Transients,
        &[256.0, 128.0, 5.0, 1.5, 0.01],
        48_000,
    ),
    (DetectorKind::Silence, &[300.0, 0.05], 48_000),
];

/// The golden run of one kind: two channels of [`golden`], 6 000 frames,
/// pushed in chunks of 333, and after each chunk the records pulled three at
/// a time until none is left; the record count and their fingerprint.
pub(crate) fn golden_run(kind: DetectorKind, values: &[f64], rate: u32) -> (usize, u64) {
    let planar = golden(2, 6_000);
    let mut extractor = features(kind, values, 2, rate);
    let width = extractor.record_width();
    let mut records = vec![0.0; 3 * width];
    let mut all = Vec::new();
    for start in (0..6_000).step_by(333) {
        let end = (start + 333).min(6_000);
        let mut chunk = planar[start..end].to_vec();
        chunk.extend_from_slice(&planar[6_000 + start..6_000 + end]);
        extractor.push(&chunk, end - start).expect("planar");
        loop {
            let count = extractor.pull(&mut records);
            all.extend_from_slice(&records[..count * width]);
            if count == 0 {
                break;
            }
        }
    }
    (all.len() / width, fingerprint::of(&all))
}

#[test]
fn gives_the_golden_bits_the_reference_path_is_held_to() {
    let runs: Vec<(usize, u64)> = GOLDEN_SETTINGS
        .iter()
        .map(|(kind, values, rate)| golden_run(*kind, values, *rate))
        .collect();
    assert_eq!(runs, GOLDEN_DETECTORS, "detector bits changed: {runs:#x?}");
}

#[test]
fn writes_the_same_records_however_the_stream_arrives() {
    let planar = golden(2, 6_000);
    for (kind, values, rate) in GOLDEN_SETTINGS {
        let whole = records_of(features(kind, values, 2, rate), &planar);
        assert_eq!(
            fingerprint::of(&whole),
            golden_run(kind, values, rate).1,
            "{kind:?}"
        );
    }
}

/// [`golden_run`] of each of [`GOLDEN_SETTINGS`].
const GOLDEN_DETECTORS: [(usize, u64); 7] = [
    (592, 0xbfe1_aa52_6cca_3f44),
    (10, 0x2cb7_9b35_b9c5_32da),
    (58, 0x6def_323e_a222_3e8b),
    (410, 0xa107_dbcc_ccd7_4af2),
    (45, 0xbbf1_27b9_3ff5_a2c7),
    (45, 0x2a0f_ef68_f76a_fd80),
    (15, 0xbf2b_c432_2fdb_e698),
];
