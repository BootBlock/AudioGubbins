//! The ABI of `crates/analysis`: the STFT, the peak and loudness meters and
//! the detector feature extractors, each by handle (ADR-0061).
//!
//! Every object is pushed planar samples from an `f32` buffer, channel `c`
//! from `c · frames`, and writes what it measured to an `f64` buffer, so a
//! measure crosses at the precision it was computed in. A push answers a
//! status; a pull answers a count, or [`COUNT_BAD_HANDLE`] or
//! [`COUNT_TOO_SMALL`].

use audiogubbins_analysis::{
    AnalysisError, DetectorFeatures, DetectorKind, DetectorSettings, LoudnessMeter, PeakMeter, Stft,
};

use crate::table::Table;
use crate::{
    COUNT_BAD_HANDLE, COUNT_TOO_SMALL, Objects, STATUS_BAD_HANDLE, STATUS_DONE, STATUS_REFUSED,
    STATUS_TOO_SMALL, status_of, with_objects,
};

/// The analysis objects of one module instance.
pub struct Analysis {
    stfts: Table<Stft>,
    peak_meters: Table<PeakMeter>,
    loudness_meters: Table<LoudnessMeter>,
    detectors: Table<DetectorFeatures>,
}

impl Analysis {
    pub const fn new() -> Self {
        Self {
            stfts: Table::new(),
            peak_meters: Table::new(),
            loudness_meters: Table::new(),
            detectors: Table::new(),
        }
    }
}

/// An object that reads planar samples.
trait Measures {
    fn channels(&self) -> usize;
    fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError>;
}

macro_rules! measures {
    ($($kind:ty),*) => {
        $(impl Measures for $kind {
            fn channels(&self) -> usize {
                <$kind>::channels(self)
            }
            fn push(&mut self, planar: &[f32], frames: usize) -> Result<(), AnalysisError> {
                <$kind>::push(self, planar, frames)
            }
        })*
    };
}

measures!(Stft, PeakMeter, LoudnessMeter, DetectorFeatures);

/// Pushes `frames` planar frames from the `f32` buffer `buffer` to the object
/// `handle` names in the table `table` picks.
fn push_from<T: Measures>(
    table: fn(&mut Analysis) -> &mut Table<T>,
    handle: u32,
    buffer: u32,
    frames: u32,
) -> u32 {
    with_objects(|objects| {
        let Objects {
            buffers, analysis, ..
        } = objects;
        let (Some(object), Some(samples)) =
            (table(analysis).get_mut(handle), buffers.get_mut(buffer))
        else {
            return STATUS_BAD_HANDLE;
        };
        let Ok(count) = usize::try_from(frames) else {
            return STATUS_TOO_SMALL;
        };
        let Some(planar) = count
            .checked_mul(object.channels())
            .and_then(|length| samples.get(..length))
        else {
            return STATUS_TOO_SMALL;
        };
        match object.push(planar, count) {
            Ok(()) => STATUS_DONE,
            Err(_) => STATUS_REFUSED,
        }
    })
}

/// Runs `work` on the object `handle` names in the table `table` picks and
/// the `f64` buffer `buffer`, answering `bad` where either names nothing.
fn with_output<T>(
    table: fn(&mut Analysis) -> &mut Table<T>,
    handle: u32,
    buffer: u32,
    bad: u32,
    work: impl FnOnce(&mut T, &mut [f64]) -> u32,
) -> u32 {
    with_objects(|objects| {
        let Objects {
            buffers_f64,
            analysis,
            ..
        } = objects;
        match (table(analysis).get_mut(handle), buffers_f64.get_mut(buffer)) {
            (Some(object), Some(values)) => work(object, values),
            _ => bad,
        }
    })
}

/// The first `count` values of `values`, or `None` where it holds fewer.
fn first(values: &mut [f64], count: usize) -> Option<&mut [f64]> {
    values.get_mut(..count)
}

/// `count` as a count the ABI answers; every count fits in a 32-bit memory.
fn answered(count: usize) -> u32 {
    u32::try_from(count).unwrap_or(COUNT_TOO_SMALL)
}

/// An STFT of `channels` channels in frames of `size` samples, a power of
/// two from 2 to 65 536, `hop` apart, from 1 to `size`; 0 if refused.
#[unsafe(no_mangle)]
pub extern "C" fn ag_stft_create(channels: u32, size: u32, hop: u32) -> u32 {
    let (Ok(channels), Ok(size), Ok(hop)) = (
        usize::try_from(channels),
        usize::try_from(size),
        usize::try_from(hop),
    ) else {
        return 0;
    };
    Stft::new(channels, size, hop).map_or(0, |stft| {
        with_objects(|objects| objects.analysis.stfts.insert(stft))
    })
}

/// Pushes `frames` planar frames from the `f32` buffer `buffer`.
#[unsafe(no_mangle)]
pub extern "C" fn ag_stft_push(stft: u32, buffer: u32, frames: u32) -> u32 {
    push_from(|analysis| &mut analysis.stfts, stft, buffer, frames)
}

/// Writes the next frame's real parts and then its imaginary parts, each
/// `channels · (N/2 + 1)` long, channel by channel, to the `f64` buffer
/// `output`, if a frame is ready: answers 1 if it wrote one and 0 if none was
/// ready.
#[unsafe(no_mangle)]
pub extern "C" fn ag_stft_pull_complex(stft: u32, output: u32) -> u32 {
    pull_frame(stft, output, Stft::pull_complex)
}

/// As [`ag_stft_pull_complex`], with magnitudes for the real parts and
/// phases in turns for the imaginary parts.
#[unsafe(no_mangle)]
pub extern "C" fn ag_stft_pull_polar(stft: u32, output: u32) -> u32 {
    pull_frame(stft, output, Stft::pull_polar)
}

/// One of the STFT's pulls: the complex form or the polar.
type FramePull = fn(&mut Stft, &mut [f64], &mut [f64]) -> Result<bool, AnalysisError>;

/// Pulls one frame of `stft` by `pull` into the two halves of `output`.
fn pull_frame(stft: u32, output: u32, pull: FramePull) -> u32 {
    let table: fn(&mut Analysis) -> &mut Table<_> = |analysis| &mut analysis.stfts;
    with_output(
        table,
        stft,
        output,
        COUNT_BAD_HANDLE,
        |transform, values| {
            let half = transform.channels() * transform.bins();
            let Some(both) = first(values, 2 * half) else {
                return COUNT_TOO_SMALL;
            };
            let (one, other) = both.split_at_mut(half);
            match pull(transform, one, other) {
                Ok(pulled) => u32::from(pulled),
                Err(_) => COUNT_TOO_SMALL,
            }
        },
    )
}

/// Releases an STFT.
#[unsafe(no_mangle)]
pub extern "C" fn ag_stft_release(stft: u32) -> u32 {
    status_of(with_objects(|objects| objects.analysis.stfts.remove(stft)))
}

/// A peak meter of `channels` channels at `rate` hertz; 0 if refused.
#[unsafe(no_mangle)]
pub extern "C" fn ag_peak_meter_create(channels: u32, rate: u32) -> u32 {
    let Ok(channels) = usize::try_from(channels) else {
        return 0;
    };
    PeakMeter::new(channels, rate).map_or(0, |meter| {
        with_objects(|objects| objects.analysis.peak_meters.insert(meter))
    })
}

/// Measures `frames` planar frames from the `f32` buffer `buffer`.
#[unsafe(no_mangle)]
pub extern "C" fn ag_peak_meter_push(meter: u32, buffer: u32, frames: u32) -> u32 {
    push_from(|analysis| &mut analysis.peak_meters, meter, buffer, frames)
}

/// Writes four values a channel to the `f64` buffer `output`: the sample
/// peak, linear and in dBFS, then the true peak, linear and in dBTP.
#[unsafe(no_mangle)]
pub extern "C" fn ag_peak_meter_read(meter: u32, output: u32) -> u32 {
    let table: fn(&mut Analysis) -> &mut Table<_> = |analysis| &mut analysis.peak_meters;
    with_output(table, meter, output, STATUS_BAD_HANDLE, |meter, values| {
        let Some(into) = first(values, 4 * meter.channels()) else {
            return STATUS_TOO_SMALL;
        };
        for (channel, quad) in into.chunks_exact_mut(4).enumerate() {
            if let Some(reading) = meter.reading(channel) {
                quad.copy_from_slice(&[
                    reading.sample_peak,
                    reading.sample_peak_decibels,
                    reading.true_peak,
                    reading.true_peak_decibels,
                ]);
            }
        }
        STATUS_DONE
    })
}

/// Releases a peak meter.
#[unsafe(no_mangle)]
pub extern "C" fn ag_peak_meter_release(meter: u32) -> u32 {
    status_of(with_objects(|objects| {
        objects.analysis.peak_meters.remove(meter)
    }))
}

/// A loudness meter at `rate` hertz of `channels` channels, weighted by the
/// first `channels` values of the `f64` buffer `weights`; 0 if refused or if
/// the buffer names nothing or holds fewer.
#[unsafe(no_mangle)]
pub extern "C" fn ag_loudness_meter_create(rate: u32, weights: u32, channels: u32) -> u32 {
    let Ok(count) = usize::try_from(channels) else {
        return 0;
    };
    with_objects(|objects| {
        let made = objects
            .buffers_f64
            .get_mut(weights)
            .and_then(|values| values.get(..count))
            .and_then(|given| LoudnessMeter::new(rate, given).ok());
        made.map_or(0, |meter| objects.analysis.loudness_meters.insert(meter))
    })
}

/// Measures `frames` planar frames from the `f32` buffer `buffer`.
#[unsafe(no_mangle)]
pub extern "C" fn ag_loudness_meter_push(meter: u32, buffer: u32, frames: u32) -> u32 {
    push_from(
        |analysis| &mut analysis.loudness_meters,
        meter,
        buffer,
        frames,
    )
}

/// Writes up to `capacity` momentary and short-term pairs not yet pulled to
/// the `f64` buffer `output`, and answers how many.
#[unsafe(no_mangle)]
pub extern "C" fn ag_loudness_meter_pull_series(meter: u32, output: u32, capacity: u32) -> u32 {
    let table: fn(&mut Analysis) -> &mut Table<_> = |analysis| &mut analysis.loudness_meters;
    with_output(table, meter, output, COUNT_BAD_HANDLE, |meter, values| {
        let Some(into) = usize::try_from(capacity)
            .ok()
            .and_then(|pairs| pairs.checked_mul(2))
            .and_then(|count| first(values, count))
        else {
            return COUNT_TOO_SMALL;
        };
        answered(meter.pull_series(into))
    })
}

/// Writes the integrated loudness in LUFS and the loudness range in LU to
/// the `f64` buffer `output`.
#[unsafe(no_mangle)]
pub extern "C" fn ag_loudness_meter_read(meter: u32, output: u32) -> u32 {
    let table: fn(&mut Analysis) -> &mut Table<_> = |analysis| &mut analysis.loudness_meters;
    with_output(table, meter, output, STATUS_BAD_HANDLE, |meter, values| {
        let Some(into) = first(values, 2) else {
            return STATUS_TOO_SMALL;
        };
        into[0] = meter.integrated();
        into[1] = meter.loudness_range();
        STATUS_DONE
    })
}

/// Releases a loudness meter.
#[unsafe(no_mangle)]
pub extern "C" fn ag_loudness_meter_release(meter: u32) -> u32 {
    status_of(with_objects(|objects| {
        objects.analysis.loudness_meters.remove(meter)
    }))
}

/// A detector's feature extractor of the kind `kind` codes, for `channels`
/// channels at `rate` hertz, its settings the first `count` values of the
/// `f64` buffer `settings`, in the order `DetectorSettings` names them; 0 if
/// refused or if the buffer names nothing or holds fewer.
#[unsafe(no_mangle)]
pub extern "C" fn ag_detector_create(
    kind: u32,
    channels: u32,
    rate: u32,
    settings: u32,
    count: u32,
) -> u32 {
    let (Some(kind), Ok(channels), Ok(count)) = (
        DetectorKind::from_code(kind),
        usize::try_from(channels),
        usize::try_from(count),
    ) else {
        return 0;
    };
    with_objects(|objects| {
        let made = objects
            .buffers_f64
            .get_mut(settings)
            .and_then(|values| values.get(..count))
            .and_then(|given| DetectorSettings::from_values(kind, given).ok())
            .and_then(|read| DetectorFeatures::new(channels, rate, read).ok());
        made.map_or(0, |features| objects.analysis.detectors.insert(features))
    })
}

/// The values in each record the detector writes, or `u32::MAX` for a bad
/// handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_detector_record_width(detector: u32) -> u32 {
    with_objects(|objects| {
        objects
            .analysis
            .detectors
            .get_mut(detector)
            .map_or(u32::MAX, |features| answered(features.record_width()))
    })
}

/// Appends `frames` planar frames from the `f32` buffer `buffer`.
#[unsafe(no_mangle)]
pub extern "C" fn ag_detector_push(detector: u32, buffer: u32, frames: u32) -> u32 {
    push_from(|analysis| &mut analysis.detectors, detector, buffer, frames)
}

/// Writes up to `capacity` records to the `f64` buffer `output`, and answers
/// how many.
#[unsafe(no_mangle)]
pub extern "C" fn ag_detector_pull(detector: u32, output: u32, capacity: u32) -> u32 {
    let table: fn(&mut Analysis) -> &mut Table<_> = |analysis| &mut analysis.detectors;
    with_output(
        table,
        detector,
        output,
        COUNT_BAD_HANDLE,
        |features, values| {
            let Some(into) = usize::try_from(capacity)
                .ok()
                .and_then(|records| records.checked_mul(features.record_width()))
                .and_then(|count| first(values, count))
            else {
                return COUNT_TOO_SMALL;
            };
            answered(features.pull(into))
        },
    )
}

/// Releases a detector's feature extractor.
#[unsafe(no_mangle)]
pub extern "C" fn ag_detector_release(detector: u32) -> u32 {
    status_of(with_objects(|objects| {
        objects.analysis.detectors.remove(detector)
    }))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::float_cmp, reason = "whole numbers and exact readings")]

    use super::*;
    use crate::{ag_buffer_create, ag_buffer_f64_create, ag_buffer_f64_release, ag_buffer_release};

    #[test]
    fn transforms_frames_through_buffers_and_refuses_rather_than_trapping() {
        assert_eq!(ag_stft_create(0, 64, 16), 0);
        assert_eq!(ag_stft_create(1, 48, 16), 0);
        assert_eq!(ag_stft_create(1, 64, 65), 0);
        let stft = ag_stft_create(2, 8, 4);
        let samples = ag_buffer_create(16);
        let spectra = ag_buffer_f64_create(20);
        let short = ag_buffer_f64_create(19);
        assert_ne!(stft, 0);
        assert_eq!(ag_stft_pull_complex(stft, spectra), 0);
        assert_eq!(ag_stft_push(stft, samples, 9), STATUS_TOO_SMALL);
        assert_eq!(ag_stft_push(stft, samples, 8), STATUS_DONE);
        assert_eq!(ag_stft_push(stft + 100, samples, 8), STATUS_BAD_HANDLE);
        assert_eq!(ag_stft_pull_polar(stft, short), COUNT_TOO_SMALL);
        assert_eq!(ag_stft_pull_polar(stft + 100, spectra), COUNT_BAD_HANDLE);
        assert_eq!(ag_stft_pull_polar(stft, spectra), 1);
        assert_eq!(ag_stft_pull_polar(stft, spectra), 0);
        assert_eq!(ag_stft_release(stft), STATUS_DONE);
        assert_eq!(ag_stft_release(stft), STATUS_BAD_HANDLE);
        for buffer in [spectra, short] {
            assert_eq!(ag_buffer_f64_release(buffer), STATUS_DONE);
        }
        assert_eq!(ag_buffer_release(samples), STATUS_DONE);
    }

    #[test]
    fn meters_peaks_and_loudness_through_buffers() {
        assert_eq!(ag_peak_meter_create(0, 48_000), 0);
        let peaks = ag_peak_meter_create(2, 48_000);
        let samples = ag_buffer_create(8);
        let readings = ag_buffer_f64_create(8);
        assert_eq!(ag_peak_meter_push(peaks, samples, 4), STATUS_DONE);
        assert_eq!(ag_peak_meter_read(peaks, readings), STATUS_DONE);
        let short = ag_buffer_f64_create(1);
        assert_eq!(ag_peak_meter_read(peaks, short), STATUS_TOO_SMALL);
        assert_eq!(ag_peak_meter_read(peaks + 100, readings), STATUS_BAD_HANDLE);
        assert_eq!(ag_peak_meter_release(peaks), STATUS_DONE);

        let weights = ag_buffer_f64_create(2);
        assert_eq!(ag_loudness_meter_create(48_000, weights, 3), 0);
        assert_eq!(ag_loudness_meter_create(4_000, weights, 2), 0);
        assert_eq!(ag_loudness_meter_create(48_000, weights + 100, 2), 0);
        let loudness = ag_loudness_meter_create(48_000, weights, 2);
        assert_ne!(loudness, 0);
        assert_eq!(ag_loudness_meter_push(loudness, samples, 4), STATUS_DONE);
        assert_eq!(ag_loudness_meter_pull_series(loudness, readings, 4), 0);
        assert_eq!(
            ag_loudness_meter_pull_series(loudness, readings, 5),
            COUNT_TOO_SMALL
        );
        assert_eq!(ag_loudness_meter_read(loudness, short), STATUS_TOO_SMALL);
        assert_eq!(ag_loudness_meter_read(loudness, readings), STATUS_DONE);
        assert_eq!(ag_loudness_meter_release(loudness), STATUS_DONE);
        for buffer in [readings, short, weights] {
            assert_eq!(ag_buffer_f64_release(buffer), STATUS_DONE);
        }
        assert_eq!(ag_buffer_release(samples), STATUS_DONE);
    }

    #[test]
    fn extracts_detector_features_and_refuses_bad_settings() {
        let settings = ag_buffer_f64_create(2);
        // Zeros are no window: refused, as an unknown kind is.
        assert_eq!(ag_detector_create(4, 1, 48_000, settings, 2), 0);
        assert_eq!(ag_detector_create(9, 1, 48_000, settings, 2), 0);
        assert_eq!(ag_detector_create(4, 1, 48_000, settings, 3), 0);
        assert_eq!(ag_detector_record_width(12_345), u32::MAX);
        let samples = ag_buffer_create(8);
        let records = ag_buffer_f64_create(8);
        // A DC offset extractor of 4-sample windows, 4 apart, over 2 channels.
        let values = ag_buffer_f64_create(2);
        crate::with_objects(|objects| {
            if let Some(held) = objects.buffers_f64.get_mut(values) {
                held.copy_from_slice(&[4.0, 4.0]);
            }
        });
        let detector = ag_detector_create(4, 2, 48_000, values, 2);
        assert_ne!(detector, 0);
        assert_eq!(ag_detector_record_width(detector), 2);
        assert_eq!(ag_detector_push(detector, samples, 4), STATUS_DONE);
        assert_eq!(ag_detector_pull(detector, records, 5), COUNT_TOO_SMALL);
        assert_eq!(ag_detector_pull(detector, records, 4), 1);
        assert_eq!(
            ag_detector_pull(detector + 100, records, 1),
            COUNT_BAD_HANDLE
        );
        assert_eq!(ag_detector_release(detector), STATUS_DONE);
        for buffer in [settings, records, values] {
            assert_eq!(ag_buffer_f64_release(buffer), STATUS_DONE);
        }
        assert_eq!(ag_buffer_release(samples), STATUS_DONE);
    }
}
