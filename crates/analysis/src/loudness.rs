//! Loudness by ITU-R BS.1770-4 and EBU R 128: momentary and short-term
//! series, integrated loudness and loudness range (EBU Tech 3342).
//!
//! Each channel is K-weighted ([`k_weighting`]) and its squares summed over
//! 100 ms steps: step `j` is the samples from `⌊j · rate / 10⌋` to before
//! `⌊(j + 1) · rate / 10⌋`, exact at every rate. A step's weighted sum is
//! `W = Σ Gᵢ · Sᵢ`, channel by channel from the first, with `Gᵢ` channel `i`'s
//! weight and `Sᵢ` its sum of squares, summed sample by sample. The mean
//! square of a window of steps is `(Σ W) / (Σ length)`, the sums oldest step
//! first, and its loudness `−0.691 + 10 · log10(mean)`, in LUFS.
//!
//! - **Momentary**: the last 4 steps, a 400 ms block; one value a step, from
//!   the fourth step on. These blocks, overlapping by 75 %, are the gating
//!   blocks of integrated loudness.
//! - **Short-term**: the last 30 steps, 3 s, or every step so far where fewer
//!   have been measured; one value a step, beside the momentary value.
//! - **Integrated**: the blocks above the absolute gate of −70 LUFS; their
//!   mean square, in block order, sets the relative gate 10 LU below its
//!   loudness; the loudness of the mean square of the blocks above both
//!   gates. −∞ where no block passes.
//! - **Loudness range**: the short-term values of full 3 s windows, gated
//!   at −70 LUFS and then 20 LU below the loudness of the gated values'
//!   mean square; the value at 95 % of the way through those left, in
//!   ascending order, less the value at 10 %, each by nearest rank
//!   (`⌊(n − 1) · share + 0.5⌋`), found by [`select`]. 0 where none is left.
//!
//! A gate passes a value strictly above it. The channel weights come from the
//! engine, which derives them from the channels' roles (`loudness-weights.ts`
//! in `packages/audio-engine`), so the rule has one home. The one memory that
//! grows is the history the integrated loudness and the range read: 32 bytes
//! a step, about a megabyte an hour.

use audiogubbins_dsp_core::log10;

use crate::error::AnalysisError;
use crate::framing::check_planar;
use crate::k_weighting::{Biquad, LOWEST_RATE, k_weighting};
use crate::selection::{rank_at, select};

/// The absolute gate, in LUFS.
const ABSOLUTE_GATE: f64 = -70.0;
/// The relative gates of integrated loudness and of the range, in LU.
const INTEGRATED_RELATIVE_GATE: f64 = -10.0;
const RANGE_RELATIVE_GATE: f64 = -20.0;
/// The steps of a momentary and of a short-term window.
const MOMENTARY_STEPS: usize = 4;
const SHORT_TERM_STEPS: usize = 30;

/// The loudness of a mean square: `−0.691 + 10 · log10(mean)`.
fn loudness_of(mean_square: f64) -> f64 {
    -0.691 + 10.0 * log10(mean_square)
}

/// A loudness meter of one stream.
#[derive(Debug, Clone)]
pub struct LoudnessMeter {
    rate: u32,
    stages: [Biquad; 2],
    weights: Vec<f64>,
    /// Per channel, each stage's state.
    states: Vec<[[f64; 2]; 2]>,
    /// Per channel, the current step's sum of squares.
    sums: Vec<f64>,
    step: u64,
    filled: u64,
    length: u64,
    /// The last [`SHORT_TERM_STEPS`] steps' weighted sums and lengths, a ring.
    recent: [(f64, u64); SHORT_TERM_STEPS],
    recent_count: usize,
    /// Every gating block's mean square and loudness.
    blocks: Vec<(f64, f64)>,
    /// Every full short-term window's mean square and loudness.
    short_terms: Vec<(f64, f64)>,
    /// Momentary and short-term pairs not yet pulled.
    series: Vec<f64>,
    scratch: Vec<f64>,
}

impl LoudnessMeter {
    /// A meter at `sample_rate` hertz of one channel per weight in `weights`.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ChannelsRefused`] for no weights or more than
    /// [`crate::MOST_CHANNELS`], [`AnalysisError::RateRefused`] for a rate
    /// below [`LOWEST_RATE`], and [`AnalysisError::SettingRefused`] for a
    /// weight that is not finite and at least zero.
    pub fn new(sample_rate: u32, weights: &[f64]) -> Result<Self, AnalysisError> {
        if weights.is_empty() || weights.len() > crate::MOST_CHANNELS {
            return Err(AnalysisError::ChannelsRefused);
        }
        if sample_rate < LOWEST_RATE {
            return Err(AnalysisError::RateRefused);
        }
        if weights
            .iter()
            .any(|weight| !(weight.is_finite() && *weight >= 0.0))
        {
            return Err(AnalysisError::SettingRefused);
        }
        let channels = weights.len();
        Ok(Self {
            rate: sample_rate,
            stages: k_weighting(sample_rate),
            weights: weights.to_vec(),
            states: vec![[[0.0; 2]; 2]; channels],
            sums: vec![0.0; channels],
            step: 0,
            filled: 0,
            length: step_length(sample_rate, 0),
            recent: [(0.0, 0); SHORT_TERM_STEPS],
            recent_count: 0,
            blocks: Vec::new(),
            short_terms: Vec::new(),
            series: Vec::new(),
            scratch: Vec::new(),
        })
    }

    /// The channels it measures.
    #[must_use]
    pub fn channels(&self) -> usize {
        self.weights.len()
    }

    /// Measures `frames` frames of planar samples, channel `c` from
    /// `c · frames`.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ShapeRefused`] unless `planar` is `channels · frames`
    /// long, having measured nothing.
    pub fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError> {
        check_planar(planar, self.channels(), frames)?;
        let mut offset = 0;
        while offset < frames {
            let room = usize::try_from(self.length - self.filled).unwrap_or(usize::MAX);
            let take = room.min(frames - offset);
            for (channel, samples) in planar.chunks_exact(frames).enumerate() {
                let state = &mut self.states[channel];
                let mut sum = self.sums[channel];
                for sample in &samples[offset..offset + take] {
                    let shelved = self.stages[0].run(&mut state[0], f64::from(*sample));
                    let weighted = self.stages[1].run(&mut state[1], shelved);
                    sum += weighted * weighted;
                }
                self.sums[channel] = sum;
            }
            offset += take;
            self.filled += take as u64;
            if self.filled == self.length {
                self.close_step();
            }
        }
        Ok(())
    }

    /// Ends the current step: its weighted sum joins the ring, and the
    /// windows ending with it are measured.
    fn close_step(&mut self) {
        let mut weighted = 0.0;
        for (weight, sum) in self.weights.iter().zip(&mut self.sums) {
            weighted += weight * *sum;
            *sum = 0.0;
        }
        self.recent.copy_within(1.., 0);
        self.recent[SHORT_TERM_STEPS - 1] = (weighted, self.length);
        self.recent_count = (self.recent_count + 1).min(SHORT_TERM_STEPS);
        self.step += 1;
        self.filled = 0;
        self.length = step_length(self.rate, self.step);
        if self.recent_count < MOMENTARY_STEPS {
            return;
        }
        let momentary = self.mean_square(MOMENTARY_STEPS);
        let momentary_loudness = loudness_of(momentary);
        self.blocks.push((momentary, momentary_loudness));
        let short_term = self.mean_square(self.recent_count);
        let short_term_loudness = loudness_of(short_term);
        if self.recent_count == SHORT_TERM_STEPS {
            self.short_terms.push((short_term, short_term_loudness));
        }
        self.series
            .extend([momentary_loudness, short_term_loudness]);
    }

    /// The mean square of the last `steps` steps: their weighted sums over
    /// their lengths, each summed oldest first.
    fn mean_square(&self, steps: usize) -> f64 {
        let mut weighted = 0.0;
        let mut length: u64 = 0;
        for (sum, samples) in &self.recent[SHORT_TERM_STEPS - steps..] {
            weighted += sum;
            length += samples;
        }
        weighted / crate::exact_u64(length)
    }

    /// Writes the momentary and short-term pairs not yet pulled, oldest
    /// first, as many as `into` holds pairs, and answers how many.
    pub fn pull_series(&mut self, into: &mut [f64]) -> usize {
        let values = (into.len() / 2 * 2).min(self.series.len());
        into[..values].copy_from_slice(&self.series[..values]);
        self.series.drain(..values);
        values / 2
    }

    /// The integrated loudness of everything measured, in LUFS.
    #[must_use]
    pub fn integrated(&self) -> f64 {
        let Some(mean) = gated_mean(&self.blocks, ABSOLUTE_GATE) else {
            return f64::NEG_INFINITY;
        };
        let relative = loudness_of(mean) + INTEGRATED_RELATIVE_GATE;
        gated_mean(&self.blocks, relative).map_or(f64::NEG_INFINITY, loudness_of)
    }

    /// The loudness range of everything measured, in LU.
    pub fn loudness_range(&mut self) -> f64 {
        let Some(mean) = gated_mean(&self.short_terms, ABSOLUTE_GATE) else {
            return 0.0;
        };
        let relative = loudness_of(mean) + RANGE_RELATIVE_GATE;
        self.scratch.clear();
        self.scratch.extend(
            self.short_terms
                .iter()
                .filter(|(_, loudness)| *loudness > ABSOLUTE_GATE && *loudness > relative)
                .map(|(_, loudness)| *loudness),
        );
        let count = self.scratch.len();
        if count == 0 {
            return 0.0;
        }
        let low = select(&mut self.scratch, rank_at(count, 0.10));
        let high = select(&mut self.scratch, rank_at(count, 0.95));
        high - low
    }
}

/// The mean of the mean squares whose loudness is above `gate` and above the
/// absolute gate, summed in order, or `None` where none is.
fn gated_mean(windows: &[(f64, f64)], gate: f64) -> Option<f64> {
    let mut sum = 0.0;
    let mut count = 0;
    for (mean_square, loudness) in windows {
        if *loudness > ABSOLUTE_GATE && *loudness > gate {
            sum += mean_square;
            count += 1;
        }
    }
    (count > 0).then(|| sum / crate::exact(count))
}

/// The samples of step `step` at `rate`: `⌊(j + 1) · rate / 10⌋ − ⌊j · rate / 10⌋`.
fn step_length(rate: u32, step: u64) -> u64 {
    let edge = |j: u64| u128::from(j) * u128::from(rate) / 10;
    // A step is at most a tenth of a 32-bit rate, so it fits.
    u64::try_from(edge(step + 1) - edge(step)).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests;
