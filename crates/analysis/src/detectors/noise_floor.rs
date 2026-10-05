//! Noise floor: each frame's level, and a low percentile of the recent levels.
//!
//! One record a frame of `frame` samples, `hop` apart, of two values a
//! channel: the level, `gain_to_decibels(√((Σ x[n] · x[n]) / frame))` in dBFS,
//! the sum from the frame's first sample, so a full-scale sine reads about
//! −3.01; and the floor, the level at `percentile` of the way through the
//! last `history` frames' levels in ascending order, or every frame's so far
//! where fewer have been read, by nearest rank (`⌊(m − 1) · p + 0.5⌋`), found
//! by [`select`] over the levels copied oldest first. A quiet passage's
//! frames are the low levels, so a floor of the tenth percentile over some
//! seconds follows the noise beneath a programme.

use audiogubbins_dsp_core::gain_to_decibels;

use crate::detectors::within;
use crate::error::AnalysisError;
use crate::framing::Framing;
use crate::selection::{rank_at, select};

/// Each channel's level and noise floor.
#[derive(Debug, Clone)]
pub struct NoiseFloorFeatures {
    framing: Framing,
    percentile: f64,
    history: usize,
    /// Per channel, the last `history` levels, a ring.
    levels: Vec<f64>,
    /// The ring's next slot, and how many levels it holds.
    next: usize,
    held: usize,
    scratch: Vec<f64>,
}

impl NoiseFloorFeatures {
    /// Frames of `frame` samples, from 1 to [`crate::MOST_FRAME_SAMPLES`],
    /// `hop` apart, from 1 to `frame`; a `percentile` in `[0, 1]` of the last
    /// `history` levels, from 1 to [`crate::MOST_HISTORY_FRAMES`].
    pub(crate) fn new(
        channels: usize,
        (frame, hop): (usize, usize),
        percentile: f64,
        history: usize,
    ) -> Result<Self, AnalysisError> {
        within(frame, 1, crate::MOST_FRAME_SAMPLES)?;
        within(hop, 1, frame)?;
        within(history, 1, crate::MOST_HISTORY_FRAMES)?;
        if !(0.0..=1.0).contains(&percentile) {
            return Err(AnalysisError::SettingRefused);
        }
        Ok(Self {
            framing: Framing::new(channels, frame, hop),
            percentile,
            history,
            levels: vec![0.0; channels * history],
            next: 0,
            held: 0,
            scratch: vec![0.0; history],
        })
    }

    pub(crate) fn channels(&self) -> usize {
        self.framing.channels()
    }

    pub(crate) fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError> {
        self.framing.push(planar, frames)
    }

    pub(crate) fn pull(&mut self, records: &mut [f64]) -> usize {
        let channels = self.channels();
        let frame = crate::exact(self.framing.size());
        let mut written = 0;
        for record in records.chunks_exact_mut(2 * channels) {
            if !self.framing.ready() {
                break;
            }
            self.held = (self.held + 1).min(self.history);
            for (channel, pair) in record.chunks_exact_mut(2).enumerate() {
                let mut sum = 0.0;
                for sample in self.framing.frame(channel) {
                    let value = f64::from(*sample);
                    sum += value * value;
                }
                let level = gain_to_decibels((sum / frame).sqrt());
                let ring = &mut self.levels[channel * self.history..(channel + 1) * self.history];
                ring[self.next] = level;
                // Oldest first: the ring's slot after the newest, `held` back.
                let oldest = (self.next + self.history + 1 - self.held) % self.history;
                for (index, into) in self.scratch[..self.held].iter_mut().enumerate() {
                    *into = ring[(oldest + index) % self.history];
                }
                let rank = rank_at(self.held, self.percentile);
                pair[0] = level;
                pair[1] = select(&mut self.scratch[..self.held], rank);
            }
            self.next = (self.next + 1) % self.history;
            self.framing.advance();
            written += 1;
        }
        written
    }
}
