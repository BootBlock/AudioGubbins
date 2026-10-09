//! The feature extractors the detectors read (ADR-0062): clicks, hum, noise
//! floor, clipping, DC offset and transients for restoration, and silence for
//! trimming it.
//!
//! Each reads planar samples and writes a stated series of records, one per
//! frame or one per event, each `record_width` values, enough for a detector
//! to find what it looks for; deciding what is a finding is the detector's.
//! Samples are pushed in any chunks, and records computed as they are
//! pulled, from samples already pushed, so the chunking changes no bit.

mod clicks;
mod clipping;
mod dc_offset;
mod hum;
mod noise_floor;
mod silence;
mod transients;

use crate::error::AnalysisError;

pub use clicks::{ClickFeatures, PREDICTOR_ORDER};
pub use clipping::ClippingFeatures;
pub use dc_offset::DcOffsetFeatures;
pub use hum::{HUM_FREQUENCIES, HumFeatures};
pub use noise_floor::NoiseFloorFeatures;
pub use silence::SilenceFeatures;
pub use transients::TransientFeatures;

/// What a detector looks for; the codes are the ABI's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectorKind {
    /// Code 0: [`ClickFeatures`].
    Clicks,
    /// Code 1: [`HumFeatures`].
    Hum,
    /// Code 2: [`NoiseFloorFeatures`].
    NoiseFloor,
    /// Code 3: [`ClippingFeatures`].
    Clipping,
    /// Code 4: [`DcOffsetFeatures`].
    DcOffset,
    /// Code 5: [`TransientFeatures`].
    Transients,
    /// Code 6: [`SilenceFeatures`].
    Silence,
}

impl DetectorKind {
    /// The kind an ABI code names, or `None`.
    #[must_use]
    pub const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Clicks),
            1 => Some(Self::Hum),
            2 => Some(Self::NoiseFloor),
            3 => Some(Self::Clipping),
            4 => Some(Self::DcOffset),
            5 => Some(Self::Transients),
            6 => Some(Self::Silence),
            _ => None,
        }
    }
}

/// A detector's settings: sizes in samples, widths in hertz.
#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(missing_docs, reason = "each variant documents its fields together")]
pub enum DetectorSettings {
    /// Blocks of `block` samples, from 64 to [`crate::MOST_FRAME_SAMPLES`];
    /// an event where a residual deviates more than `sensitivity`, above
    /// zero, times the block's median absolute deviation.
    Clicks { block: usize, sensitivity: f64 },
    /// An STFT of `size`, a power of two from 2 to 65 536, `hop` apart; the
    /// peak searched for within `search_width` hertz of each hum frequency,
    /// above zero, and the floor read within `floor_width`, wider.
    Hum {
        size: usize,
        hop: usize,
        search_width: f64,
        floor_width: f64,
    },
    /// Frames of `frame` samples `hop` apart; the floor the `percentile`, in
    /// `[0, 1]`, of the last `history` frames' levels.
    NoiseFloor {
        frame: usize,
        hop: usize,
        percentile: f64,
        history: usize,
    },
    /// Blocks of `block` samples; a run is at least `minimum_run` samples
    /// within `epsilon`, zero or more, of the block's largest magnitude.
    Clipping {
        block: usize,
        epsilon: f64,
        minimum_run: usize,
    },
    /// Means over `window` samples, `hop` apart.
    DcOffset { window: usize, hop: usize },
    /// An STFT of `size`, `hop` apart; the threshold `offset` plus
    /// `multiplier` times the median of the last `history` frames' flux.
    Transients {
        size: usize,
        hop: usize,
        history: usize,
        multiplier: f64,
        offset: f64,
    },
    /// Blocks of `block` samples; a frame quiet where every channel's
    /// magnitude is at most `threshold`, zero or more.
    Silence { block: usize, threshold: f64 },
}

impl DetectorSettings {
    /// The settings of `kind` from the values the ABI carries, in the order
    /// each variant names its fields.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::SettingRefused`] for the wrong number of values, or
    /// a size, count or hop that is not a whole number.
    pub fn from_values(kind: DetectorKind, values: &[f64]) -> Result<Self, AnalysisError> {
        let refused = AnalysisError::SettingRefused;
        Ok(match (kind, values) {
            (DetectorKind::Clicks, [block, sensitivity]) => Self::Clicks {
                block: whole(*block)?,
                sensitivity: *sensitivity,
            },
            (DetectorKind::Hum, [size, hop, search, floor]) => Self::Hum {
                size: whole(*size)?,
                hop: whole(*hop)?,
                search_width: *search,
                floor_width: *floor,
            },
            (DetectorKind::NoiseFloor, [frame, hop, percentile, history]) => Self::NoiseFloor {
                frame: whole(*frame)?,
                hop: whole(*hop)?,
                percentile: *percentile,
                history: whole(*history)?,
            },
            (DetectorKind::Clipping, [block, epsilon, run]) => Self::Clipping {
                block: whole(*block)?,
                epsilon: *epsilon,
                minimum_run: whole(*run)?,
            },
            (DetectorKind::DcOffset, [window, hop]) => Self::DcOffset {
                window: whole(*window)?,
                hop: whole(*hop)?,
            },
            (DetectorKind::Transients, [size, hop, history, multiplier, offset]) => {
                Self::Transients {
                    size: whole(*size)?,
                    hop: whole(*hop)?,
                    history: whole(*history)?,
                    multiplier: *multiplier,
                    offset: *offset,
                }
            }
            (DetectorKind::Silence, [block, threshold]) => Self::Silence {
                block: whole(*block)?,
                threshold: *threshold,
            },
            _ => return Err(refused),
        })
    }
}

/// `value` as a count, if it is a whole number from 0 to 2³².
fn whole(value: f64) -> Result<usize, AnalysisError> {
    if !(0.0..=4_294_967_296.0).contains(&value) || value.fract() != 0.0 {
        return Err(AnalysisError::SettingRefused);
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a whole number from 0 to 2^32, checked above"
    )]
    Ok(value as usize)
}

/// Whether `value` is a whole count from `low` to `high`.
pub(crate) fn within(value: usize, low: usize, high: usize) -> Result<(), AnalysisError> {
    if (low..=high).contains(&value) {
        Ok(())
    } else {
        Err(AnalysisError::SettingRefused)
    }
}

/// One detector's feature extractor.
#[derive(Debug, Clone)]
#[allow(
    missing_docs,
    reason = "each variant is its kind's extractor, documented there"
)]
pub enum DetectorFeatures {
    Clicks(ClickFeatures),
    Hum(HumFeatures),
    NoiseFloor(NoiseFloorFeatures),
    Clipping(ClippingFeatures),
    DcOffset(DcOffsetFeatures),
    Transients(TransientFeatures),
    Silence(SilenceFeatures),
}

impl DetectorFeatures {
    /// The extractor `settings` describe, for `channels` channels at
    /// `sample_rate` hertz.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ChannelsRefused`] for no channels or more than
    /// [`crate::MOST_CHANNELS`], [`AnalysisError::RateRefused`] for a rate
    /// the extractor cannot measure at, and [`AnalysisError::SettingRefused`]
    /// for a setting out of its stated range.
    pub fn new(
        channels: usize,
        sample_rate: u32,
        settings: DetectorSettings,
    ) -> Result<Self, AnalysisError> {
        if channels == 0 || channels > crate::MOST_CHANNELS {
            return Err(AnalysisError::ChannelsRefused);
        }
        if sample_rate == 0 {
            return Err(AnalysisError::RateRefused);
        }
        Ok(match settings {
            DetectorSettings::Clicks { block, sensitivity } => {
                Self::Clicks(ClickFeatures::new(channels, block, sensitivity)?)
            }
            DetectorSettings::Hum {
                size,
                hop,
                search_width,
                floor_width,
            } => Self::Hum(HumFeatures::new(
                channels,
                sample_rate,
                (size, hop),
                (search_width, floor_width),
            )?),
            DetectorSettings::NoiseFloor {
                frame,
                hop,
                percentile,
                history,
            } => Self::NoiseFloor(NoiseFloorFeatures::new(
                channels,
                (frame, hop),
                percentile,
                history,
            )?),
            DetectorSettings::Clipping {
                block,
                epsilon,
                minimum_run,
            } => Self::Clipping(ClippingFeatures::new(
                channels,
                block,
                epsilon,
                minimum_run,
            )?),
            DetectorSettings::DcOffset { window, hop } => {
                Self::DcOffset(DcOffsetFeatures::new(channels, window, hop)?)
            }
            DetectorSettings::Transients {
                size,
                hop,
                history,
                multiplier,
                offset,
            } => Self::Transients(TransientFeatures::new(
                channels,
                (size, hop),
                history,
                (multiplier, offset),
            )?),
            DetectorSettings::Silence { block, threshold } => {
                Self::Silence(SilenceFeatures::new(channels, block, threshold)?)
            }
        })
    }

    /// The channels it reads.
    #[must_use]
    pub fn channels(&self) -> usize {
        match self {
            Self::Clicks(features) => features.channels(),
            Self::Hum(features) => features.channels(),
            Self::NoiseFloor(features) => features.channels(),
            Self::Clipping(features) => features.channels(),
            Self::DcOffset(features) => features.channels(),
            Self::Transients(features) => features.channels(),
            Self::Silence(features) => features.channels(),
        }
    }

    /// The values in each record it writes.
    #[must_use]
    pub fn record_width(&self) -> usize {
        match self {
            Self::Clicks(_) | Self::Clipping(_) | Self::Silence(_) => 4,
            Self::Hum(features) => features.channels() * 3 * HUM_FREQUENCIES.len(),
            Self::NoiseFloor(features) => 2 * features.channels(),
            Self::DcOffset(features) => features.channels(),
            Self::Transients(features) => 2 * features.channels(),
        }
    }

    /// Appends `frames` frames of planar samples, channel `c` from
    /// `c · frames`.
    ///
    /// # Errors
    ///
    /// [`AnalysisError::ShapeRefused`] unless `planar` is `channels · frames`
    /// long, having appended nothing.
    pub fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError> {
        match self {
            Self::Clicks(features) => features.push(planar, frames),
            Self::Hum(features) => features.push(planar, frames),
            Self::NoiseFloor(features) => features.push(planar, frames),
            Self::Clipping(features) => features.push(planar, frames),
            Self::DcOffset(features) => features.push(planar, frames),
            Self::Transients(features) => features.push(planar, frames),
            Self::Silence(features) => features.push(planar, frames),
        }
    }

    /// Writes the records ready, oldest first, as many whole records as
    /// `records` holds, and answers how many.
    pub fn pull(&mut self, records: &mut [f64]) -> usize {
        match self {
            Self::Clicks(features) => features.pull(records),
            Self::Hum(features) => features.pull(records),
            Self::NoiseFloor(features) => features.pull(records),
            Self::Clipping(features) => features.pull(records),
            Self::DcOffset(features) => features.pull(records),
            Self::Transients(features) => features.pull(records),
            Self::Silence(features) => features.pull(records),
        }
    }
}

/// Writes events of four values from `pending`, starting at `*cursor`, into
/// `records` until either runs out, and answers how many it wrote; `refill`
/// is called to make more events whenever the pending ones are spent, and
/// answers whether it could.
pub(crate) fn pull_events(
    records: &mut [f64],
    pending: &mut Vec<f64>,
    cursor: &mut usize,
    mut refill: impl FnMut(&mut Vec<f64>) -> bool,
) -> usize {
    let capacity = records.len() / 4;
    let mut written = 0;
    while written < capacity {
        if *cursor >= pending.len() {
            pending.clear();
            *cursor = 0;
            if !refill(pending) {
                break;
            }
            continue;
        }
        let event = &pending[*cursor..*cursor + 4];
        records[4 * written..4 * written + 4].copy_from_slice(event);
        *cursor += 4;
        written += 1;
    }
    written
}

#[cfg(test)]
mod tests;
