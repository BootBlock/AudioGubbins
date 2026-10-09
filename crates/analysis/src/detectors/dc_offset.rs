//! DC offset: the mean of each channel over a sliding window.
//!
//! One record a frame of `window` samples, `hop` apart, of one value a
//! channel: `(Σ x[n]) / window`, each sample as an `f64`, summed from the
//! frame's first, so a mean never carries a running sum's drift.

use crate::detectors::within;
use crate::error::AnalysisError;
use crate::framing::Framing;

/// The running mean of each channel.
#[derive(Debug, Clone)]
pub struct DcOffsetFeatures {
    framing: Framing,
}

impl DcOffsetFeatures {
    /// Means over `window` samples, from 1 to [`crate::MOST_FRAME_SAMPLES`],
    /// `hop` apart, from 1 to `window`.
    pub(crate) fn new(channels: usize, window: usize, hop: usize) -> Result<Self, AnalysisError> {
        within(window, 1, crate::MOST_FRAME_SAMPLES)?;
        within(hop, 1, window)?;
        Ok(Self {
            framing: Framing::new(channels, window, hop),
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
        let window = crate::exact(self.framing.size());
        let mut written = 0;
        for record in records.chunks_exact_mut(channels) {
            if !self.framing.ready() {
                break;
            }
            for (channel, mean) in record.iter_mut().enumerate() {
                let mut sum = 0.0;
                for sample in self.framing.frame(channel) {
                    sum += f64::from(*sample);
                }
                *mean = sum / window;
            }
            self.framing.advance();
            written += 1;
        }
        written
    }
}
