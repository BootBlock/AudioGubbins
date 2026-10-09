//! Silence: runs of frames quiet on every channel.
//!
//! The stream is read in blocks of `block` samples. A frame is quiet where the
//! magnitude of every channel's sample, as an `f64`, is at most `threshold`,
//! so a NaN is never quiet. A run is consecutive quiet frames within a block,
//! and each run is an event of four values: `[first sample, length, peak,
//! energy]`, the first sample counted from the start of the stream, `peak` the
//! largest magnitude of any of its samples, and `energy` the sum of the
//! squares of its samples, frame by frame and within a frame channel by
//! channel, each square of the sample as an `f64`. Events come block by block,
//! in order. A run is cut at a block's edge, so a reader joins a run that ends
//! a block to one that starts the next.

use crate::detectors::{pull_events, within};
use crate::error::AnalysisError;
use crate::framing::Framing;

/// Runs of frames quiet on every channel, block by block.
#[derive(Debug, Clone)]
pub struct SilenceFeatures {
    framing: Framing,
    threshold: f64,
    events: Vec<f64>,
    cursor: usize,
}

impl SilenceFeatures {
    /// Blocks of `block` samples, from 1 to [`crate::MOST_FRAME_SAMPLES`]; a
    /// frame quiet at a `threshold`, finite and at least zero.
    pub(crate) fn new(
        channels: usize,
        block: usize,
        threshold: f64,
    ) -> Result<Self, AnalysisError> {
        within(block, 1, crate::MOST_FRAME_SAMPLES)?;
        if !(threshold.is_finite() && threshold >= 0.0) {
            return Err(AnalysisError::SettingRefused);
        }
        Ok(Self {
            framing: Framing::new(channels, block, block),
            threshold,
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
            threshold,
            events,
            cursor,
        } = self;
        pull_events(records, events, cursor, |pending| {
            if !framing.ready() {
                return false;
            }
            runs_of(framing, *threshold, pending);
            framing.advance();
            true
        })
    }
}

/// Whether frame `index` of the next block is quiet on every channel.
fn quiet(framing: &Framing, index: usize, threshold: f64) -> bool {
    (0..framing.channels()).all(|channel| {
        framing
            .frame(channel)
            .get(index)
            .is_some_and(|sample| f64::from(*sample).abs() <= threshold)
    })
}

/// Appends the events of the next block to `events`.
fn runs_of(framing: &Framing, threshold: f64, events: &mut Vec<f64>) {
    let position = crate::exact_u64(framing.position());
    let size = framing.size();
    let mut first = 0;
    let mut run = 0;
    let mut peak = 0.0;
    let mut energy = 0.0;
    // One step past the end closes a run that reaches it.
    for index in 0..=size {
        if index < size && quiet(framing, index, threshold) {
            if run == 0 {
                first = index;
            }
            run += 1;
            for channel in 0..framing.channels() {
                let sample = framing
                    .frame(channel)
                    .get(index)
                    .map_or(0.0, |one| f64::from(*one));
                let magnitude = sample.abs();
                if magnitude > peak {
                    peak = magnitude;
                }
                energy += sample * sample;
            }
            continue;
        }
        if run > 0 {
            events.extend([
                position + crate::exact(first),
                crate::exact(run),
                peak,
                energy,
            ]);
        }
        run = 0;
        peak = 0.0;
        energy = 0.0;
    }
}
