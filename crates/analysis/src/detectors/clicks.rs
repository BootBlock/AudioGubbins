//! Clicks: where a short linear predictor fails by far more than is usual.
//!
//! The stream is read in blocks of `block` samples. In each block and
//! channel, a prediction-error filter of order [`PREDICTOR_ORDER`] is fitted
//! to the block's samples, as `f64`s, by Burg's method ([`Burg::fit`]), and
//! the residual of each sample is `e[n] = Σ a[i] · x[n − i]` for `i` from 0
//! to the order, in that order, the samples before the block its last
//! samples before. The first [`PREDICTOR_ORDER`] samples of the stream have
//! no such history, and their residual is taken as zero, so a stream that
//! starts loud is not a click. A click is a sound no short predictor
//! foresees, so its residual stands out of the music's.
//!
//! The local threshold is robust: with `m` the median of the block's
//! residuals and `MAD` the median of `|e[n] − m|`, each found exactly by
//! [`select`] at nearest rank one half (`⌊(B − 1) / 2 + 0.5⌋`), a sample whose
//! deviation `|e[n] − m|` is above both `sensitivity · MAD` and 2⁻²⁴, the
//! last bit of a full-scale `f32` sample, is an event of four values:
//! `[channel, sample, e[n] − m, MAD]`, the sample counted from the start of
//! the stream. A click's own samples are a few among a block's, so the
//! median and the deviation of the median stay the music's. Events come
//! block by block, and within a block channel by channel and in order.

use crate::burg::Burg;
use crate::detectors::{pull_events, within};
use crate::error::AnalysisError;
use crate::framing::Framing;
use crate::selection::{rank_at, select};

/// The order of the predictor: enough to follow the resonances of music and
/// speech over a block, few enough that a click's few samples cannot be
/// fitted.
pub const PREDICTOR_ORDER: usize = 16;

/// The least deviation an event has: 2⁻²⁴, below which a residual is the
/// rounding of a sample, not a sound.
const LEAST_DEVIATION: f64 = 1.0 / 16_777_216.0;

/// The fewest samples a block holds: four times the order, so the fit
/// rests on many more samples than it has coefficients.
const SMALLEST_BLOCK: usize = 4 * PREDICTOR_ORDER;

/// The scratch of one block's analysis.
#[derive(Debug, Clone)]
struct Scratch {
    burg: Burg,
    coefficients: [f64; PREDICTOR_ORDER + 1],
    samples: Vec<f64>,
    residuals: Vec<f64>,
    ordered: Vec<f64>,
}

/// Residuals and their robust local threshold.
#[derive(Debug, Clone)]
pub struct ClickFeatures {
    framing: Framing,
    sensitivity: f64,
    /// Per channel, the last samples before the next block, newest first.
    before: Vec<[f64; PREDICTOR_ORDER]>,
    scratch: Scratch,
    events: Vec<f64>,
    cursor: usize,
}

impl ClickFeatures {
    /// Blocks of `block` samples, from 64 to [`crate::MOST_FRAME_SAMPLES`],
    /// and a `sensitivity` finite and above zero.
    pub(crate) fn new(
        channels: usize,
        block: usize,
        sensitivity: f64,
    ) -> Result<Self, AnalysisError> {
        within(block, SMALLEST_BLOCK, crate::MOST_FRAME_SAMPLES)?;
        if !(sensitivity.is_finite() && sensitivity > 0.0) {
            return Err(AnalysisError::SettingRefused);
        }
        Ok(Self {
            framing: Framing::new(channels, block, block),
            sensitivity,
            before: vec![[0.0; PREDICTOR_ORDER]; channels],
            scratch: Scratch {
                burg: Burg::new(PREDICTOR_ORDER, block),
                coefficients: [0.0; PREDICTOR_ORDER + 1],
                samples: vec![0.0; block],
                residuals: vec![0.0; block],
                ordered: vec![0.0; block],
            },
            events: Vec::new(),
            cursor: 0,
        })
    }

    pub(crate) fn channels(&self) -> usize {
        self.framing.channels()
    }

    pub(crate) fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError> {
        self.framing.push(planar, frames)
    }

    pub(crate) fn pull(&mut self, records: &mut [f64]) -> usize {
        let Self {
            framing,
            sensitivity,
            before,
            scratch,
            events,
            cursor,
        } = self;
        pull_events(records, events, cursor, |pending| {
            if !framing.ready() {
                return false;
            }
            let start = framing.position();
            for (channel, history) in before.iter_mut().enumerate() {
                let block = framing.frame(channel);
                scratch.analyse(block, history, *sensitivity, (channel, start), pending);
            }
            framing.advance();
            true
        })
    }
}

impl Scratch {
    /// Appends the events of one channel's block to `events`, and moves the
    /// block's last samples into `history`.
    fn analyse(
        &mut self,
        block: &[f32],
        history: &mut [f64; PREDICTOR_ORDER],
        sensitivity: f64,
        (channel, start): (usize, u64),
        events: &mut Vec<f64>,
    ) {
        let position = crate::exact_u64(start);
        for (into, sample) in self.samples.iter_mut().zip(block) {
            *into = f64::from(*sample);
        }
        self.burg.fit(&self.samples, &mut self.coefficients);
        // The residual is zero for the stream's first samples, which no
        // history precedes.
        let unprimed = usize::try_from(start).map_or(0, |at| PREDICTOR_ORDER.saturating_sub(at));
        for n in 0..self.samples.len() {
            if n < unprimed {
                self.residuals[n] = 0.0;
                continue;
            }
            let mut residual = 0.0;
            for (lag, coefficient) in self.coefficients.iter().enumerate() {
                let input = if lag <= n {
                    self.samples[n - lag]
                } else {
                    history[lag - n - 1]
                };
                residual += coefficient * input;
            }
            self.residuals[n] = residual;
        }
        let count = self.residuals.len();
        let rank = rank_at(count, 0.5);
        self.ordered.copy_from_slice(&self.residuals);
        let median = select(&mut self.ordered, rank);
        for (into, residual) in self.ordered.iter_mut().zip(&self.residuals) {
            *into = (residual - median).abs();
        }
        let deviation = select(&mut self.ordered, rank);
        let threshold = sensitivity * deviation;
        for (n, residual) in self.residuals.iter().enumerate() {
            let away = residual - median;
            let magnitude = away.abs();
            if magnitude > threshold && magnitude > LEAST_DEVIATION {
                let at = position + crate::exact(n);
                events.extend([crate::exact(channel), at, away, deviation]);
            }
        }
        for (lag, into) in history.iter_mut().enumerate() {
            *into = self.samples[count - 1 - lag];
        }
    }
}
