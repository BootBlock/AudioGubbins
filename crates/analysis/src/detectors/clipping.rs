//! Clipping: runs of samples held at a block's largest magnitude.
//!
//! The stream is read in blocks of `block` samples. In each block and
//! channel, `M` is the largest magnitude of a sample, as an `f64`, and a run
//! is consecutive samples whose magnitude is at least `M − epsilon`; a run of
//! at least `minimum_run` samples is an event of four values:
//! `[channel, first sample, length, M]`, the first sample counted from the
//! start of the stream. Events come block by block, and within a block
//! channel by channel and in order. A block whose largest magnitude is zero
//! is silence and has none. A run is cut at a block's edge, so a block of
//! some tenths of a second keeps that rare.

use crate::detectors::{pull_events, within};
use crate::error::AnalysisError;
use crate::framing::Framing;

/// Runs at each block's largest magnitude.
#[derive(Debug, Clone)]
pub struct ClippingFeatures {
    framing: Framing,
    epsilon: f64,
    minimum_run: usize,
    events: Vec<f64>,
    cursor: usize,
}

impl ClippingFeatures {
    /// Blocks of `block` samples, from 1 to [`crate::MOST_FRAME_SAMPLES`];
    /// runs within `epsilon`, finite and at least zero, of at least
    /// `minimum_run` samples, from 1 to `block`.
    pub(crate) fn new(
        channels: usize,
        block: usize,
        epsilon: f64,
        minimum_run: usize,
    ) -> Result<Self, AnalysisError> {
        within(block, 1, crate::MOST_FRAME_SAMPLES)?;
        within(minimum_run, 1, block)?;
        if !(epsilon.is_finite() && epsilon >= 0.0) {
            return Err(AnalysisError::SettingRefused);
        }
        Ok(Self {
            framing: Framing::new(channels, block, block),
            epsilon,
            minimum_run,
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
            epsilon,
            minimum_run,
            events,
            cursor,
        } = self;
        pull_events(records, events, cursor, |pending| {
            if !framing.ready() {
                return false;
            }
            for channel in 0..framing.channels() {
                runs_of(framing, channel, *epsilon, *minimum_run, pending);
            }
            framing.advance();
            true
        })
    }
}

/// Appends the events of `channel`'s next block to `events`.
fn runs_of(framing: &Framing, channel: usize, epsilon: f64, minimum: usize, events: &mut Vec<f64>) {
    let block = framing.frame(channel);
    let mut largest = 0.0;
    for sample in block {
        let magnitude = f64::from(*sample).abs();
        if magnitude > largest {
            largest = magnitude;
        }
    }
    if largest <= 0.0 {
        return;
    }
    let threshold = largest - epsilon;
    let position = crate::exact_u64(framing.position());
    let mut run = 0;
    // One step past the end closes a run that reaches it.
    for index in 0..=block.len() {
        let held = block
            .get(index)
            .is_some_and(|sample| f64::from(*sample).abs() >= threshold);
        if held {
            run += 1;
            continue;
        }
        if run >= minimum {
            let first = crate::exact(index - run);
            events.extend([
                crate::exact(channel),
                position + first,
                crate::exact(run),
                largest,
            ]);
        }
        run = 0;
    }
}
