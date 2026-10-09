//! Sample peak and true peak per channel, by ITU-R BS.1770-4 Annex 2.
//!
//! The sample peak is the largest magnitude of any sample pushed. The true
//! peak is the larger of the sample peak and the largest magnitude of the
//! signal oversampled by the recommendation's interpolating filter, which
//! passes a sample through its phase 0 at 0.972 of itself, not whole, so the
//! oversampled signal alone read a full-scale impulse 0.245 dB under its own
//! sample peak; a true peak is the peak of the signal, samples included. The
//! filter is 48 taps, used as four phases of 12,
//! phase `p` writing the sample a quarter `p` of the way from one input sample
//! to the next. Each phase's output at input sample `n` is
//! `Σ P[p][j] · x[n − j]` for `j` from 0 to 11 in that order, in `f64`, with
//! `x` before the first sample taken as zero.
//!
//! The filter is designed for 48 kHz, where four phases oversample to
//! 192 kHz. It is defined in frequency relative to the rate, so at any rate
//! below 96 kHz all four phases are used (44.1 kHz goes to 176.4 kHz, the
//! filter's band scaled with it); from 96 kHz to below 192 kHz phases 0 and 2
//! alone oversample by two, the sample halfway along; and from 192 kHz the
//! signal is already at the oversampled rate, nothing is oversampled, and the
//! true peak is the sample peak. Each reaches at least the 4 × 48 kHz the recommendation's design
//! oversamples to, or the scaled band of it.
//!
//! A reading includes the filter's tail, as if the stream ended in silence
//! where it stands: the samples the last inputs would write as the filter
//! drains, computed on a copy, so a peak in the last samples is found and
//! the stream continues unchanged. Readings are linear and in decibels by
//! [`gain_to_decibels`], −∞ for silence.

use audiogubbins_dsp_core::gain_to_decibels;

use crate::error::AnalysisError;
use crate::framing::check_planar;

/// The taps of each phase.
const TAPS: usize = 12;

/// The interpolating filter of ITU-R BS.1770-4 (10/2015), Annex 2, Table 1:
/// its 48 coefficients as four phases of 12, phase `p`'s tap `j` being the
/// filter's coefficient `4j + p`. Each is a multiple of 2⁻¹³, printed in
/// full, so the decimal is the value exactly.
const PHASES: [[f64; TAPS]; 4] = [
    [
        0.001_708_984_375,
        0.010_986_328_125,
        -0.019_653_320_312_5,
        0.033_203_125,
        -0.059_448_242_187_5,
        0.137_329_101_562_5,
        0.972_167_968_75,
        -0.102_294_921_875,
        0.047_607_421_875,
        -0.026_611_328_125,
        0.014_892_578_125,
        -0.008_300_781_25,
    ],
    [
        -0.029_174_804_687_5,
        0.029_296_875,
        -0.051_757_812_5,
        0.089_111_328_125,
        -0.166_503_906_25,
        0.465_087_890_625,
        0.779_785_156_25,
        -0.200_317_382_812_5,
        0.101_562_5,
        -0.058_227_539_062_5,
        0.033_081_054_687_5,
        -0.018_920_898_437_5,
    ],
    [
        -0.018_920_898_437_5,
        0.033_081_054_687_5,
        -0.058_227_539_062_5,
        0.101_562_5,
        -0.200_317_382_812_5,
        0.779_785_156_25,
        0.465_087_890_625,
        -0.166_503_906_25,
        0.089_111_328_125,
        -0.051_757_812_5,
        0.029_296_875,
        -0.029_174_804_687_5,
    ],
    [
        -0.008_300_781_25,
        0.014_892_578_125,
        -0.026_611_328_125,
        0.047_607_421_875,
        -0.102_294_921_875,
        0.972_167_968_75,
        0.137_329_101_562_5,
        -0.059_448_242_187_5,
        0.033_203_125,
        -0.019_653_320_312_5,
        0.010_986_328_125,
        0.001_708_984_375,
    ],
];

/// The phases used below 96 kHz, from 96 kHz to below 192 kHz, and from
/// 192 kHz, where the sample peak is the true peak.
const FOUR_TIMES: &[usize] = &[0, 1, 2, 3];
const TWICE: &[usize] = &[0, 2];
const ONCE: &[usize] = &[];

/// One channel's peaks, linear and in decibels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PeakReading {
    /// The largest magnitude of any sample.
    pub sample_peak: f64,
    /// [`Self::sample_peak`] in decibels relative to full scale.
    pub sample_peak_decibels: f64,
    /// The largest magnitude of the oversampled signal.
    pub true_peak: f64,
    /// [`Self::true_peak`] in decibels relative to full scale: dBTP.
    pub true_peak_decibels: f64,
}

/// The sample and true peaks of each channel of a stream.
#[derive(Debug, Clone)]
pub struct PeakMeter {
    phases: &'static [usize],
    /// Per channel, the last 12 inputs, the newest first.
    history: Vec<[f64; TAPS]>,
    sample_peaks: Vec<f64>,
    true_peaks: Vec<f64>,
}

impl PeakMeter {
    /// A meter of `channels` channels at `sample_rate` hertz.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ChannelsRefused`] for no channels or more than
    /// [`crate::MOST_CHANNELS`], [`AnalysisError::RateRefused`] for a rate of
    /// zero.
    pub fn new(channels: usize, sample_rate: u32) -> Result<Self, AnalysisError> {
        if channels == 0 || channels > crate::MOST_CHANNELS {
            return Err(AnalysisError::ChannelsRefused);
        }
        let phases = match sample_rate {
            0 => return Err(AnalysisError::RateRefused),
            1..96_000 => FOUR_TIMES,
            96_000..192_000 => TWICE,
            _ => ONCE,
        };
        Ok(Self {
            phases,
            history: vec![[0.0; TAPS]; channels],
            sample_peaks: vec![0.0; channels],
            true_peaks: vec![0.0; channels],
        })
    }

    /// The channels it measures.
    #[must_use]
    pub fn channels(&self) -> usize {
        self.history.len()
    }

    /// Measures `frames` frames of planar samples, channel `c` from
    /// `c · frames`. A magnitude replaces a peak only where it is larger, so a
    /// NaN is never a peak.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ShapeRefused`] unless `planar` is `channels · frames`
    /// long, having measured nothing.
    pub fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError> {
        check_planar(planar, self.channels(), frames)?;
        if frames == 0 {
            return Ok(());
        }
        let channels = planar.chunks_exact(frames).zip(&mut self.history);
        for (channel, (samples, history)) in channels.enumerate() {
            let mut sample_peak = self.sample_peaks[channel];
            let mut true_peak = self.true_peaks[channel];
            for sample in samples {
                let value = f64::from(*sample);
                let magnitude = value.abs();
                if magnitude > sample_peak {
                    sample_peak = magnitude;
                }
                true_peak = step(history, value, self.phases, true_peak);
            }
            self.sample_peaks[channel] = sample_peak;
            self.true_peaks[channel] = true_peak;
        }
        Ok(())
    }

    /// Channel `channel`'s peaks so far, the filter's tail included, or
    /// `None` for a channel it does not have.
    #[must_use]
    pub fn reading(&self, channel: usize) -> Option<PeakReading> {
        let sample_peak = *self.sample_peaks.get(channel)?;
        let mut drained = *self.history.get(channel)?;
        let mut true_peak = self.true_peaks[channel];
        for _ in 1..TAPS {
            true_peak = step(&mut drained, 0.0, self.phases, true_peak);
        }
        true_peak = true_peak.max(sample_peak);
        Some(PeakReading {
            sample_peak,
            sample_peak_decibels: gain_to_decibels(sample_peak),
            true_peak,
            true_peak_decibels: gain_to_decibels(true_peak),
        })
    }
}

/// Moves `value` into `history`, newest first, and answers `peak` or the
/// largest magnitude any of `phases` writes for it, whichever is larger.
fn step(history: &mut [f64; TAPS], value: f64, phases: &[usize], peak: f64) -> f64 {
    history.copy_within(..TAPS - 1, 1);
    history[0] = value;
    let mut largest = peak;
    for phase in phases {
        let mut sum = 0.0;
        for (coefficient, input) in PHASES[*phase].iter().zip(history.iter()) {
            sum += coefficient * input;
        }
        let magnitude = sum.abs();
        if magnitude > largest {
            largest = magnitude;
        }
    }
    largest
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "the canonical path is held to exact bits")]

    use audiogubbins_dsp_core::{decibels_to_gain, sine_of_turns};

    use super::{PHASES, PeakMeter};
    use crate::error::AnalysisError;
    use crate::fingerprint;
    use crate::signals::golden;

    /// `frames` samples of a sine of `amplitude` at `turns` a sample, from
    /// `phase` turns, rounded once to `f32`.
    fn sine(frames: usize, turns: f64, phase: f64, amplitude: f64) -> Vec<f32> {
        (0..frames)
            .map(|n| {
                #[allow(clippy::cast_possible_truncation, reason = "a sample")]
                let value = (amplitude * sine_of_turns(crate::exact(n) * turns + phase)) as f32;
                value
            })
            .collect()
    }

    #[test]
    fn has_the_filter_the_recommendation_prints() {
        // The 48 taps are symmetric about their middle, and each phase passes
        // a constant within a quarter of a decibel of unity, as the printed
        // filter does: a mistyped coefficient breaks one or the other.
        for (phase, taps) in PHASES.iter().enumerate() {
            for (tap, coefficient) in taps.iter().enumerate() {
                let mirrored = 47 - (4 * tap + phase);
                assert_eq!(*coefficient, PHASES[mirrored % 4][mirrored / 4]);
            }
            let gain: f64 = taps.iter().sum();
            assert!((gain - 1.0).abs() < 0.03, "phase {phase}: {gain}");
        }
    }

    #[test]
    fn refuses_settings_and_shapes_out_of_range() {
        assert_eq!(
            PeakMeter::new(0, 48_000).unwrap_err(),
            AnalysisError::ChannelsRefused
        );
        assert_eq!(
            PeakMeter::new(2, 0).unwrap_err(),
            AnalysisError::RateRefused
        );
        let mut meter = PeakMeter::new(2, 48_000).expect("valid");
        assert_eq!(meter.push(&[0.0; 3], 2), Err(AnalysisError::ShapeRefused));
        assert!(meter.reading(2).is_none());
    }

    #[test]
    fn finds_the_true_peak_between_samples() {
        // EBU Tech 3341 case 16's signal: a quarter-rate sine at −6 dBFS from
        // 45°, so every sample lies 3 dB below the peak between them.
        let amplitude = decibels_to_gain(-6.0);
        let mut meter = PeakMeter::new(1, 48_000).expect("valid");
        meter
            .push(&sine(4_800, 0.25, 0.125, amplitude), 4_800)
            .expect("one channel");
        let reading = meter.reading(0).expect("one channel");
        assert!(
            (reading.sample_peak_decibels + 9.01).abs() < 0.01,
            "{reading:?}"
        );
        assert!(
            (reading.true_peak_decibels + 6.0).abs() < 0.1,
            "{reading:?}"
        );
    }

    #[test]
    fn never_reads_the_true_peak_under_the_sample_peak() {
        // A full-scale impulse: phase 0 writes it at 0.972 of itself and the
        // other phases less, so the oversampled signal alone peaks under it.
        let mut impulse = vec![0.0_f32; 64];
        impulse[20] = -1.0;
        for rate in [44_100, 48_000, 96_000, 192_000] {
            let mut meter = PeakMeter::new(1, rate).expect("valid");
            meter.push(&impulse, 64).expect("one channel");
            let reading = meter.reading(0).expect("one channel");
            assert_eq!(reading.sample_peak, 1.0);
            assert_eq!(reading.true_peak, 1.0, "{rate}");
            assert_eq!(reading.true_peak_decibels, 0.0, "{rate}");
        }
    }

    #[test]
    fn oversamples_by_the_rate_and_drains_its_tail() {
        // Two full-scale samples at the very end: the peak between them is
        // written only as the filter drains, which a reading includes. Each
        // phase writes it as the sum of two neighbouring taps.
        let mut pair = vec![0.0_f32; 32];
        pair[30] = 1.0;
        pair[31] = 1.0;
        for rate in [44_100, 48_000, 96_000, 192_000] {
            let mut meter = PeakMeter::new(1, rate).expect("valid");
            meter.push(&pair, 32).expect("one channel");
            let reading = meter.reading(0).expect("one channel");
            assert_eq!(reading.sample_peak, 1.0);
            let phases: &[usize] = match rate {
                ..96_000 => &[0, 1, 2, 3],
                96_000..192_000 => &[0, 2],
                _ => &[],
            };
            let between = phases
                .iter()
                .flat_map(|phase| {
                    PHASES[*phase]
                        .windows(2)
                        .map(|taps| (taps[0] + taps[1]).abs())
                })
                .fold(1.0, f64::max);
            assert_eq!(reading.true_peak, between, "{rate}");
            assert_eq!(reading.true_peak > 1.0, rate < 192_000, "{rate}");
        }
        let silent = PeakMeter::new(1, 48_000).expect("valid");
        assert_eq!(
            silent.reading(0).expect("one channel").true_peak_decibels,
            f64::NEG_INFINITY
        );
    }

    /// The golden run: three channels of [`golden`] at 44.1 kHz pushed in
    /// chunks of 61 frames, each channel's reading after every chunk.
    pub(crate) fn golden_run(rate: u32) -> u64 {
        let planar = golden(3, 1_000);
        let mut meter = PeakMeter::new(3, rate).expect("valid");
        let mut readings = Vec::new();
        for start in (0..1_000).step_by(61) {
            let end = (start + 61).min(1_000);
            let mut chunk = Vec::new();
            for channel in 0..3 {
                chunk.extend_from_slice(&planar[channel * 1_000 + start..channel * 1_000 + end]);
            }
            meter.push(&chunk, end - start).expect("three channels");
            for channel in 0..3 {
                let reading = meter.reading(channel).expect("three channels");
                readings.extend([
                    reading.sample_peak,
                    reading.sample_peak_decibels,
                    reading.true_peak,
                    reading.true_peak_decibels,
                ]);
            }
        }
        fingerprint::of(&readings)
    }

    #[test]
    fn gives_the_golden_bits_the_reference_path_is_held_to() {
        let hashes = [golden_run(44_100), golden_run(96_000)];
        assert_eq!(hashes, GOLDEN_PEAKS, "peak bits changed: {hashes:#x?}");
    }

    /// [`golden_run`] at 44.1 kHz and at 96 kHz.
    const GOLDEN_PEAKS: [u64; 2] = [0x4e77_5d9b_0dd1_f486, 0x3344_6b50_91b0_97fc];
}
