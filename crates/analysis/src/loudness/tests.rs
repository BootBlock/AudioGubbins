#![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

use audiogubbins_dsp_core::{decibels_to_gain, sine_of_turns};

use super::{LoudnessMeter, step_length};
use crate::error::AnalysisError;
use crate::fingerprint;
use crate::signals::golden;

/// Segments of a test signal: each channel's level in dBFS, and seconds.
type Segments<'a> = &'a [(&'a [f64], f64)];

/// Feeds `meter` a 1 kHz sine at 48 kHz for each `(levels, seconds)`
/// segment, channel `c` at `levels[c]` dBFS peak, in chunks of 4 800 frames,
/// the sine's phase running on across segments.
fn feed(meter: &mut LoudnessMeter, segments: Segments<'_>) {
    let channels = meter.channels();
    let mut n: usize = 0;
    let mut chunk = vec![0.0_f32; channels * 4_800];
    for (levels, seconds) in segments {
        let gains: Vec<f64> = levels
            .iter()
            .map(|level| decibels_to_gain(*level))
            .collect();
        // Whole numbers of samples: each segment is a whole tenth of a second.
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a whole number of samples"
        )]
        let mut left = (seconds * 48_000.0).round() as usize;
        while left > 0 {
            let frames = left.min(4_800);
            for frame in 0..frames {
                // 1 kHz at 48 kHz is a 48th of a turn a sample, exactly periodic.
                let turns = crate::exact((n + frame) % 48) / 48.0;
                let sine = sine_of_turns(turns);
                for (channel, gain) in gains.iter().enumerate() {
                    #[allow(clippy::cast_possible_truncation, reason = "a sample")]
                    let sample = (gain * sine) as f32;
                    chunk[channel * frames + frame] = sample;
                }
            }
            meter
                .push(&chunk[..channels * frames], frames)
                .expect("planar");
            n += frames;
            left -= frames;
        }
    }
}

fn stereo() -> LoudnessMeter {
    LoudnessMeter::new(48_000, &[1.0, 1.0]).expect("valid")
}

#[test]
fn refuses_settings_and_shapes_out_of_range() {
    assert_eq!(
        LoudnessMeter::new(48_000, &[]).unwrap_err(),
        AnalysisError::ChannelsRefused
    );
    assert_eq!(
        LoudnessMeter::new(7_999, &[1.0]).unwrap_err(),
        AnalysisError::RateRefused
    );
    for weight in [-1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(
            LoudnessMeter::new(48_000, &[1.0, weight]).unwrap_err(),
            AnalysisError::SettingRefused
        );
    }
    let mut meter = stereo();
    assert_eq!(meter.push(&[0.0; 3], 2), Err(AnalysisError::ShapeRefused));
}

#[test]
fn steps_by_exact_tenths_of_a_second_at_any_rate() {
    assert_eq!(step_length(48_000, 0), 4_800);
    assert_eq!(step_length(44_100, 7), 4_410);
    // 1 102.5 samples a step: the edges fall alternately short and long.
    let lengths: Vec<u64> = (0..4).map(|step| step_length(11_025, step)).collect();
    assert_eq!(lengths, [1_102, 1_103, 1_102, 1_103]);
}

#[test]
fn measures_ebu_tech_3341_cases_1_and_2_within_a_tenth() {
    for level in [-23.0, -33.0] {
        let mut meter = stereo();
        feed(&mut meter, &[(&[level, level], 20.0)]);
        let mut series = vec![0.0; 2 * 200];
        let pairs = meter.pull_series(&mut series);
        // One pair a step from the fourth: 200 steps in 20 s.
        assert_eq!(pairs, 197);
        let (momentary, short_term) = (series[2 * 196], series[2 * 196 + 1]);
        assert!(
            (momentary - level).abs() < 0.1,
            "{level}: momentary {momentary}"
        );
        assert!(
            (short_term - level).abs() < 0.1,
            "{level}: short-term {short_term}"
        );
        let integrated = meter.integrated();
        assert!(
            (integrated - level).abs() < 0.1,
            "{level}: integrated {integrated}"
        );
    }
}

#[test]
fn gates_ebu_tech_3341_cases_3_to_5_to_minus_23_lufs() {
    let cases: [Segments<'_>; 3] = [
        &[
            (&[-36.0, -36.0], 10.0),
            (&[-23.0, -23.0], 60.0),
            (&[-36.0, -36.0], 10.0),
        ],
        &[
            (&[-72.0, -72.0], 10.0),
            (&[-36.0, -36.0], 10.0),
            (&[-23.0, -23.0], 60.0),
            (&[-36.0, -36.0], 10.0),
            (&[-72.0, -72.0], 10.0),
        ],
        &[
            (&[-26.0, -26.0], 20.0),
            (&[-20.0, -20.0], 20.1),
            (&[-26.0, -26.0], 20.0),
        ],
    ];
    for (index, segments) in cases.iter().enumerate() {
        let mut meter = stereo();
        feed(&mut meter, segments);
        let integrated = meter.integrated();
        assert!(
            (integrated + 23.0).abs() < 0.1,
            "case {}: {integrated}",
            index + 3
        );
    }
}

#[test]
fn weights_the_surround_channels_as_ebu_tech_3341_case_6() {
    // 5.0: left, right, centre, left surround, right surround.
    let mut meter = LoudnessMeter::new(48_000, &[1.0, 1.0, 1.0, 1.41, 1.41]).expect("valid");
    feed(&mut meter, &[(&[-28.0, -28.0, -24.0, -30.0, -30.0], 20.0)]);
    let integrated = meter.integrated();
    assert!((integrated + 23.0).abs() < 0.1, "{integrated}");
}

#[test]
fn measures_the_range_of_ebu_tech_3342_cases_1_to_4_within_one_lu() {
    let cases: [(Segments<'_>, f64); 4] = [
        (&[(&[-20.0, -20.0], 20.0), (&[-30.0, -30.0], 20.0)], 10.0),
        (&[(&[-20.0, -20.0], 20.0), (&[-15.0, -15.0], 20.0)], 5.0),
        (&[(&[-40.0, -40.0], 20.0), (&[-20.0, -20.0], 20.0)], 20.0),
        (
            &[
                (&[-50.0, -50.0], 20.0),
                (&[-35.0, -35.0], 20.0),
                (&[-20.0, -20.0], 20.0),
                (&[-35.0, -35.0], 20.0),
                (&[-50.0, -50.0], 20.0),
            ],
            15.0,
        ),
    ];
    for (index, (segments, expected)) in cases.iter().enumerate() {
        let mut meter = stereo();
        feed(&mut meter, segments);
        let range = meter.loudness_range();
        assert!(
            (range - expected).abs() < 1.0,
            "case {}: {range}",
            index + 1
        );
    }
}

#[test]
fn reads_silence_as_no_loudness() {
    let mut meter = stereo();
    meter.push(&vec![0.0; 2 * 48_000], 48_000).expect("planar");
    assert_eq!(meter.integrated(), f64::NEG_INFINITY);
    assert_eq!(meter.loudness_range(), 0.0);
    let mut series = [0.0; 2];
    assert_eq!(meter.pull_series(&mut series), 1);
    assert_eq!(series, [f64::NEG_INFINITY, f64::NEG_INFINITY]);
}

/// The golden run: three channels of [`golden`], 9 000 frames at 11.025 kHz
/// repeated at gains of 1/4, 1/2, 3/4 and 1, pushed in chunks of 1 237, weights 1, 1.41 and 0;
/// the series, pulled after each chunk, then the integrated loudness and the
/// range.
pub(crate) fn golden_run() -> u64 {
    let planar = golden(3, 9_000);
    let mut meter = LoudnessMeter::new(11_025, &[1.0, 1.41, 0.0]).expect("valid");
    let mut values = Vec::new();
    let mut series = vec![0.0; 64];
    for gain in [0.25_f32, 0.5, 0.75, 1.0] {
        for start in (0..9_000).step_by(1_237) {
            let end = (start + 1_237).min(9_000);
            let mut chunk = Vec::new();
            for channel in 0..3 {
                let from = channel * 9_000;
                chunk.extend(planar[from + start..from + end].iter().map(|s| s * gain));
            }
            meter.push(&chunk, end - start).expect("planar");
            let pairs = meter.pull_series(&mut series);
            values.extend_from_slice(&series[..2 * pairs]);
        }
    }
    values.push(meter.integrated());
    values.push(meter.loudness_range());
    fingerprint::of(&values)
}

#[test]
fn gives_the_golden_bits_the_reference_path_is_held_to() {
    let hash = golden_run();
    assert_eq!(hash, GOLDEN_LOUDNESS, "loudness bits changed: {hash:#x}");
}

/// [`golden_run`]'s series, integrated loudness and range.
const GOLDEN_LOUDNESS: u64 = 0xf32d_d7bd_f3fb_c07c;
