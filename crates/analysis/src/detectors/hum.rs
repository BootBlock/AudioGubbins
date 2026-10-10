//! Hum: the level and exact frequency of mains hum and its second harmonic,
//! and the spectral floor around each.
//!
//! Each frame of the [`Stft`] (`size` samples, `hop` apart) is one record of,
//! per channel and per frequency of [`HUM_FREQUENCIES`], three values:
//! `[frequency, level, floor]`. A bin's level is
//! `gain_to_decibels((4 · magnitude) / N)`, so a sine centred on a bin reads
//! its own peak in dBFS. For a hum frequency `f`, with `δ` the search width:
//!
//! - the peak is the bin of largest magnitude, the first of equals, from
//!   `⌊((f − δ) · N) / rate⌋` to `⌈((f + δ) · N) / rate⌉`, kept within
//!   `[1, N/2 − 1]`;
//! - its frequency and level are interpolated by the parabola through the
//!   levels `α`, `β`, `γ` of the bins before, at and after it: with
//!   `d = (α − 2β) + γ`, where all three are finite and `d` below zero,
//!   `p = (0.5 · (α − γ)) / d` held to `[−1/2, 1/2]`, and otherwise `p = 0`;
//!   the frequency is `((k + p) · rate) / N` and the level
//!   `β − (0.25 · (α − γ)) · p`;
//! - the floor is the median, by [`select`] at nearest rank one half, of the
//!   levels of the bins from `⌊((f − w) · N) / rate⌋` to
//!   `⌈((f + w) · N) / rate⌉` within `[1, N/2]`, `w` the floor width, less the
//!   five bins centred on the peak, which the Hann window spreads it over;
//!   −∞ where none is left.
//!
//! A hum stands above its floor at a steady frequency frame after frame,
//! which is what a detector looks for.

use audiogubbins_dsp_core::gain_to_decibels;

use crate::error::AnalysisError;
use crate::selection::{rank_at, select};
use crate::stft::{Stft, StftWindow};

/// The frequencies a hum is sought at: the mains of 50 Hz and its second
/// harmonic, then those of 60 Hz.
pub const HUM_FREQUENCIES: [f64; 4] = [50.0, 100.0, 60.0, 120.0];

/// The smallest STFT the search takes: a peak needs a bin on either side.
const SMALLEST_SIZE: usize = 16;

/// The bins a hum frequency's peak is sought in and its floor read from.
#[derive(Debug, Clone, Copy)]
struct Bands {
    search: (usize, usize),
    floor: (usize, usize),
}

/// Each channel's hum peaks and their floors.
#[derive(Debug, Clone)]
pub struct HumFeatures {
    stft: Stft,
    rate: f64,
    bands: [Bands; 4],
    real: Vec<f64>,
    imaginary: Vec<f64>,
    scratch: Vec<f64>,
}

impl HumFeatures {
    /// An STFT of `size`, `hop` apart, as [`Stft::new`] takes them but of
    /// at least 16 samples; a
    /// `search` width finite and above zero, and a `floor` width finite and
    /// above it; a rate above twice 120 Hz plus the floor width.
    pub(crate) fn new(
        channels: usize,
        sample_rate: u32,
        (size, hop): (usize, usize),
        (search, floor): (f64, f64),
    ) -> Result<Self, AnalysisError> {
        if size < SMALLEST_SIZE {
            return Err(AnalysisError::SettingRefused);
        }
        let stft = Stft::new(channels, size, hop, StftWindow::Hann)?;
        if !(search.is_finite() && search > 0.0 && floor.is_finite() && floor > search) {
            return Err(AnalysisError::SettingRefused);
        }
        let rate = f64::from(sample_rate);
        if 2.0 * (120.0 + floor) >= rate {
            return Err(AnalysisError::RateRefused);
        }
        let length = crate::exact(size);
        let last = size / 2;
        let bin = |hertz: f64, round: fn(f64) -> f64, low: usize, high: usize| {
            let position = round((hertz * length) / rate).max(0.0);
            // Clamped to the spectrum, far below 2^32, so the cast is exact.
            #[allow(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "a whole bin within the spectrum"
            )]
            let whole = position.min(crate::exact(high)) as usize;
            whole.clamp(low, high)
        };
        let bands = HUM_FREQUENCIES.map(|frequency| Bands {
            search: (
                bin(frequency - search, f64::floor, 1, last - 1),
                bin(frequency + search, f64::ceil, 1, last - 1),
            ),
            floor: (
                bin(frequency - floor, f64::floor, 1, last),
                bin(frequency + floor, f64::ceil, 1, last),
            ),
        });
        let bins = stft.bins();
        Ok(Self {
            stft,
            rate,
            bands,
            real: vec![0.0; channels * bins],
            imaginary: vec![0.0; channels * bins],
            scratch: Vec::with_capacity(bins),
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
        let width = 3 * HUM_FREQUENCIES.len();
        let mut written = 0;
        for record in records.chunks_exact_mut(self.channels() * width) {
            if !matches!(
                self.stft.pull_complex(&mut self.real, &mut self.imaginary),
                Ok(true)
            ) {
                break;
            }
            for (channel, values) in record.chunks_exact_mut(width).enumerate() {
                let spectrum = Spectrum {
                    real: &self.real[channel * bins..(channel + 1) * bins],
                    imaginary: &self.imaginary[channel * bins..(channel + 1) * bins],
                    size: crate::exact(self.stft.size()),
                };
                for (bands, triple) in self.bands.iter().zip(values.chunks_exact_mut(3)) {
                    let (frequency, level, floor) =
                        spectrum.hum_at(*bands, self.rate, &mut self.scratch);
                    triple.copy_from_slice(&[frequency, level, floor]);
                }
            }
            written += 1;
        }
        written
    }
}

/// One channel's spectrum of one frame.
struct Spectrum<'a> {
    real: &'a [f64],
    imaginary: &'a [f64],
    size: f64,
}

impl Spectrum<'_> {
    /// `√(re · re + im · im)` of bin `bin`.
    fn magnitude(&self, bin: usize) -> f64 {
        let (re, im) = (self.real[bin], self.imaginary[bin]);
        (re * re + im * im).sqrt()
    }

    /// Bin `bin`'s level: `gain_to_decibels((4 · magnitude) / N)`.
    fn level(&self, bin: usize) -> f64 {
        gain_to_decibels((4.0 * self.magnitude(bin)) / self.size)
    }

    /// The interpolated frequency and level of the peak in `bands`, and the
    /// floor around it.
    fn hum_at(&self, bands: Bands, rate: f64, scratch: &mut Vec<f64>) -> (f64, f64, f64) {
        let (low, high) = bands.search;
        let mut peak = low;
        let mut largest = self.magnitude(low);
        for bin in low + 1..=high {
            let magnitude = self.magnitude(bin);
            if magnitude > largest {
                largest = magnitude;
                peak = bin;
            }
        }
        let (alpha, beta, gamma) = (self.level(peak - 1), self.level(peak), self.level(peak + 1));
        let curvature = alpha - 2.0 * beta + gamma;
        let finite = alpha.is_finite() && beta.is_finite() && gamma.is_finite();
        let offset = if finite && curvature < 0.0 {
            ((0.5 * (alpha - gamma)) / curvature).clamp(-0.5, 0.5)
        } else {
            0.0
        };
        let frequency = ((crate::exact(peak) + offset) * rate) / self.size;
        let level = beta - (0.25 * (alpha - gamma)) * offset;
        scratch.clear();
        let (from, to) = bands.floor;
        for bin in from..=to {
            if bin + 2 < peak || bin > peak + 2 {
                scratch.push(self.level(bin));
            }
        }
        let floor = if scratch.is_empty() {
            f64::NEG_INFINITY
        } else {
            let rank = rank_at(scratch.len(), 0.5);
            select(scratch, rank)
        };
        (frequency, level, floor)
    }
}
