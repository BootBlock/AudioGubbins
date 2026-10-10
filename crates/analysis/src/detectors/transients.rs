//! Transients: spectral flux, half-wave rectified, and an adaptive threshold.
//!
//! Each frame of the [`Stft`] (`size` samples, `hop` apart) is one record of
//! two values a channel: `[flux, threshold]`. With bin `k`'s magnitude
//! `mₖ = (4 · √(re · re + im · im)) / N`, so a sine centred on a bin reads its
//! peak, the flux is `Σ max(mₖ − m′ₖ, 0)` over the bins from 0, `m′` the
//! previous frame's magnitudes (zero before the first frame), counting only
//! what rose. The threshold is `offset + multiplier · median`, the median of
//! the last `history` frames' flux, the current one included, or every
//! frame's so far where fewer have been read, by [`select`] at nearest rank
//! one half over the flux copied oldest first. An onset is where the flux
//! rises above its threshold, which follows the music's own activity.

use crate::detectors::within;
use crate::error::AnalysisError;
use crate::selection::{rank_at, select};
use crate::stft::{Stft, StftWindow};

/// Each channel's spectral flux and its threshold.
#[derive(Debug, Clone)]
pub struct TransientFeatures {
    stft: Stft,
    multiplier: f64,
    offset: f64,
    history: usize,
    real: Vec<f64>,
    imaginary: Vec<f64>,
    /// Per channel, the previous frame's magnitudes.
    previous: Vec<f64>,
    /// Per channel, the last `history` frames' flux, a ring.
    fluxes: Vec<f64>,
    next: usize,
    held: usize,
    scratch: Vec<f64>,
}

impl TransientFeatures {
    /// An STFT of `size`, `hop` apart, as [`Stft::new`] takes them; the
    /// median of the last `history` frames' flux, from 1 to
    /// [`crate::MOST_HISTORY_FRAMES`]; a `multiplier` and an `offset` finite
    /// and at least zero.
    pub(crate) fn new(
        channels: usize,
        (size, hop): (usize, usize),
        history: usize,
        (multiplier, offset): (f64, f64),
    ) -> Result<Self, AnalysisError> {
        let stft = Stft::new(channels, size, hop, StftWindow::Hann)?;
        within(history, 1, crate::MOST_HISTORY_FRAMES)?;
        let finite = |value: f64| value.is_finite() && value >= 0.0;
        if !(finite(multiplier) && finite(offset)) {
            return Err(AnalysisError::SettingRefused);
        }
        let bins = stft.bins();
        Ok(Self {
            stft,
            multiplier,
            offset,
            history,
            real: vec![0.0; channels * bins],
            imaginary: vec![0.0; channels * bins],
            previous: vec![0.0; channels * bins],
            fluxes: vec![0.0; channels * history],
            next: 0,
            held: 0,
            scratch: vec![0.0; history],
        })
    }

    pub(crate) fn channels(&self) -> usize {
        self.stft.channels()
    }

    pub(crate) fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError> {
        self.stft.push(planar, frames)
    }

    pub(crate) fn pull(&mut self, records: &mut [f64]) -> usize {
        let bins = self.stft.bins();
        let size = crate::exact(self.stft.size());
        let mut written = 0;
        for record in records.chunks_exact_mut(2 * self.channels()) {
            if !matches!(
                self.stft.pull_complex(&mut self.real, &mut self.imaginary),
                Ok(true)
            ) {
                break;
            }
            self.held = (self.held + 1).min(self.history);
            for (channel, pair) in record.chunks_exact_mut(2).enumerate() {
                let span = channel * bins..(channel + 1) * bins;
                let mut flux = 0.0;
                let parts = self.real[span.clone()]
                    .iter()
                    .zip(&self.imaginary[span.clone()]);
                for ((re, im), previous) in parts.zip(&mut self.previous[span]) {
                    let magnitude = (4.0 * (re * re + im * im).sqrt()) / size;
                    let rise = magnitude - *previous;
                    flux += if rise > 0.0 { rise } else { 0.0 };
                    *previous = magnitude;
                }
                let ring = &mut self.fluxes[channel * self.history..(channel + 1) * self.history];
                ring[self.next] = flux;
                let oldest = (self.next + self.history + 1 - self.held) % self.history;
                for (index, into) in self.scratch[..self.held].iter_mut().enumerate() {
                    *into = ring[(oldest + index) % self.history];
                }
                let median = select(&mut self.scratch[..self.held], rank_at(self.held, 0.5));
                pair[0] = flux;
                pair[1] = self.offset + self.multiplier * median;
            }
            self.next = (self.next + 1) % self.history;
            written += 1;
        }
        written
    }
}
