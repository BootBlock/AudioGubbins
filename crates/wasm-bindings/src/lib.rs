//! The narrow C ABI through which the TypeScript engine reaches the
//! canonical DSP (ADR-0031).
//!
//! Every object, a sample buffer as much as an oscillator, is named by an
//! integer handle into a table this module owns, so no pointer to a Rust object
//! crosses the boundary. The one address the TypeScript side is given is where
//! a buffer's samples start, which it reads and writes through a typed-array
//! view; a buffer never reallocates, so the address holds until the buffer is
//! released. Nothing here is `unsafe`.
//!
//! A creation refused answers handle 0, a call on a handle that names nothing
//! answers [`STATUS_BAD_HANDLE`], and a call naming a buffer too small for it
//! answers [`STATUS_TOO_SMALL`], so no input from the other side can make the
//! module panic, which in WebAssembly would trap and lose the instance.
//!
//! The tables are the state of one module instance. The engine instantiates
//! one per thread that runs DSP, so nothing is shared between threads.

// ADR-0031: exporting an unmangled symbol is an unsafe attribute, and this
// crate exists to export them. No `unsafe` block is written here.
#![allow(unsafe_code)]

mod analysis;
mod table;

use std::cell::RefCell;

use audiogubbins_dsp_core::{
    Fft, SineOscillator, arctangent_turns, cosine_of_turns, decibels_to_gain, exp,
    gain_to_decibels, ln, log2, log10, pow, sine_of_turns, tangent_of_turns,
};
use audiogubbins_resampling::{ResamplingQuality, StreamingResampler};

use table::{Pair, Table};

/// The ABI's version. The TypeScript side refuses a module of another.
///
/// 2 added `ag_resampler_seek`, and [`STATUS_TOO_SMALL`] and
/// [`COUNT_TOO_SMALL`] where 1 answered a bad handle. 3 added
/// `ag_oscillator_seek` with the oscillator's fixed-point phase, a coefficient
/// budget to `ag_resampler_create`, and `ag_resampler_table_bytes`. 4 added the
/// scalar primitives ADR-0061 admits, for the conformance tests (`ag_exp`,
/// `ag_ln`, `ag_log2`, `ag_log10`, `ag_pow`, `ag_decibels_to_gain`,
/// `ag_gain_to_decibels`, `ag_cosine_of_turns`, `ag_tangent_of_turns`,
/// `ag_arctangent_turns`), buffers of `f64` (`ag_buffer_f64_*`), and the real
/// FFT by handle (`ag_fft_*`). 5 added `crates/analysis` by handle: the STFT
/// (`ag_stft_create`, `_push`, `_pull_complex`, `_pull_polar`, `_release`),
/// the peak meter (`ag_peak_meter_create`, `_push`, `_read`, `_release`), the
/// loudness meter (`ag_loudness_meter_create`, `_push`, `_pull_series`,
/// `_read`, `_release`) and the detector feature extractors
/// (`ag_detector_create`, `_record_width`, `_push`, `_pull`, `_release`). 6
/// added the silence extractor, code 6 of `ag_detector_create`, which a module
/// of 5 refuses as an unknown kind. 7 added the STFT's window, the last
/// argument of `ag_stft_create`: 0 the periodic Hann, 1 the four-term
/// Blackman–Harris (ADR-0080).
pub const ABI_VERSION: u32 = 7;

/// The call did what it was asked.
pub const STATUS_DONE: u32 = 0;
/// A handle named nothing.
pub const STATUS_BAD_HANDLE: u32 = 1;
/// The object refused the input.
pub const STATUS_REFUSED: u32 = 2;
/// The buffer named holds fewer samples than the call reads or writes.
pub const STATUS_TOO_SMALL: u32 = 3;

/// What a call that answers a count answers for a handle that names nothing.
pub const COUNT_BAD_HANDLE: u32 = u32::MAX;
/// What a call that answers a count answers for a buffer too small for it.
/// No real count reaches it: that many frames would not fit in a 32-bit
/// memory.
pub const COUNT_TOO_SMALL: u32 = u32::MAX - 1;

/// The largest frame a seek names or answers: every whole number up to it is
/// exact in the `f64` the ABI carries it in.
const LAST_EXACT_FRAME: f64 = 9_007_199_254_740_992.0;

struct Objects {
    buffers: Table<Vec<f32>>,
    /// Buffers of `f64`, for what crosses at full precision: a spectrum, and a
    /// signal an FFT reads, which the reference path may hold as `f64`.
    buffers_f64: Table<Vec<f64>>,
    oscillators: Table<SineOscillator>,
    resamplers: Table<StreamingResampler>,
    ffts: Table<Fft>,
    analysis: analysis::Analysis,
}

thread_local! {
    static OBJECTS: RefCell<Objects> = const {
        RefCell::new(Objects {
            buffers: Table::new(),
            buffers_f64: Table::new(),
            oscillators: Table::new(),
            resamplers: Table::new(),
            ffts: Table::new(),
            analysis: analysis::Analysis::new(),
        })
    };
}

fn with_objects<R>(work: impl FnOnce(&mut Objects) -> R) -> R {
    OBJECTS.with_borrow_mut(work)
}

/// The ABI's version.
#[unsafe(no_mangle)]
pub extern "C" fn ag_abi_version() -> u32 {
    ABI_VERSION
}

/// A buffer of `floats` samples, all zero, or 0 if it cannot be made.
#[unsafe(no_mangle)]
pub extern "C" fn ag_buffer_create(floats: u32) -> u32 {
    let Ok(length) = usize::try_from(floats) else {
        return 0;
    };
    with_objects(|objects| objects.buffers.insert(vec![0.0; length]))
}

/// Where the buffer's samples start in the module's memory, or 0 for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_buffer_address(buffer: u32) -> u32 {
    with_objects(|objects| {
        objects.buffers.get_mut(buffer).map_or(0, |samples| {
            // An address in a 32-bit memory always fits.
            u32::try_from(samples.as_ptr().addr()).unwrap_or(0)
        })
    })
}

/// Releases a buffer.
#[unsafe(no_mangle)]
pub extern "C" fn ag_buffer_release(buffer: u32) -> u32 {
    status_of(with_objects(|objects| objects.buffers.remove(buffer)))
}

/// A buffer of `doubles` `f64`s, all zero, or 0 if it cannot be made.
#[unsafe(no_mangle)]
pub extern "C" fn ag_buffer_f64_create(doubles: u32) -> u32 {
    let Ok(length) = usize::try_from(doubles) else {
        return 0;
    };
    with_objects(|objects| objects.buffers_f64.insert(vec![0.0; length]))
}

/// Where the `f64` buffer's values start in the module's memory, eight-byte
/// aligned, or 0 for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_buffer_f64_address(buffer: u32) -> u32 {
    with_objects(|objects| {
        objects.buffers_f64.get_mut(buffer).map_or(0, |values| {
            u32::try_from(values.as_ptr().addr()).unwrap_or(0)
        })
    })
}

/// Releases an `f64` buffer.
#[unsafe(no_mangle)]
pub extern "C" fn ag_buffer_f64_release(buffer: u32) -> u32 {
    status_of(with_objects(|objects| objects.buffers_f64.remove(buffer)))
}

/// `sin(2π · turns)` by the canonical rule, for the reference path's
/// conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_sine_of_turns(turns: f64) -> f64 {
    sine_of_turns(turns)
}

/// `cos(2π · turns)` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_cosine_of_turns(turns: f64) -> f64 {
    cosine_of_turns(turns)
}

/// `tan(2π · turns)` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_tangent_of_turns(turns: f64) -> f64 {
    tangent_of_turns(turns)
}

/// `atan2(y, x) / 2π` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_arctangent_turns(y: f64, x: f64) -> f64 {
    arctangent_turns(y, x)
}

/// `eˣ` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_exp(x: f64) -> f64 {
    exp(x)
}

/// `ln x` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_ln(x: f64) -> f64 {
    ln(x)
}

/// `log₂ x` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_log2(x: f64) -> f64 {
    log2(x)
}

/// `log₁₀ x` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_log10(x: f64) -> f64 {
    log10(x)
}

/// `xʸ` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_pow(x: f64, y: f64) -> f64 {
    pow(x, y)
}

/// The gain of `decibels` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_decibels_to_gain(decibels: f64) -> f64 {
    decibels_to_gain(decibels)
}

/// The decibels of `gain` by the canonical rule, for the conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_gain_to_decibels(gain: f64) -> f64 {
    gain_to_decibels(gain)
}

/// An oscillator, or 0 if its settings are refused.
#[unsafe(no_mangle)]
pub extern "C" fn ag_oscillator_create(
    frequency: f64,
    sample_rate: u32,
    start_phase: f64,
    amplitude: f64,
) -> u32 {
    SineOscillator::new(frequency, sample_rate, start_phase, amplitude).map_or(0, |oscillator| {
        with_objects(|objects| objects.oscillators.insert(oscillator))
    })
}

/// Writes the oscillator's next `frames` samples to the start of `buffer`.
#[unsafe(no_mangle)]
pub extern "C" fn ag_oscillator_render(oscillator: u32, buffer: u32, frames: u32) -> u32 {
    with_objects(|objects| {
        let Objects {
            buffers,
            oscillators,
            ..
        } = objects;
        let (Some(generator), Some(samples)) =
            (oscillators.get_mut(oscillator), buffers.get_mut(buffer))
        else {
            return STATUS_BAD_HANDLE;
        };
        let Some(target) = usize::try_from(frames)
            .ok()
            .and_then(|count| samples.get_mut(..count))
        else {
            return STATUS_TOO_SMALL;
        };
        generator.render(target);
        STATUS_DONE
    })
}

/// Moves the oscillator to frame `frame` of its run, so its next sample is
/// that frame's; [`STATUS_REFUSED`] when `frame` is not a whole number from 0
/// to 2⁵³.
#[unsafe(no_mangle)]
pub extern "C" fn ag_oscillator_seek(oscillator: u32, frame: f64) -> u32 {
    let Some(whole) = whole_frame(frame) else {
        return STATUS_REFUSED;
    };
    with_objects(|objects| match objects.oscillators.get_mut(oscillator) {
        Some(generator) => {
            generator.seek(whole);
            STATUS_DONE
        }
        None => STATUS_BAD_HANDLE,
    })
}

/// `frame` as a frame count, if it is a whole number from 0 to 2⁵³.
fn whole_frame(frame: f64) -> Option<u64> {
    if !((0.0..=LAST_EXACT_FRAME).contains(&frame) && frame.fract() == 0.0) {
        return None;
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a whole number from 0 to 2^53, checked above"
    )]
    Some(frame as u64)
}

/// Releases an oscillator.
#[unsafe(no_mangle)]
pub extern "C" fn ag_oscillator_release(oscillator: u32) -> u32 {
    status_of(with_objects(|objects| {
        objects.oscillators.remove(oscillator)
    }))
}

/// A resampler, or 0 if its settings are refused. Its filter keeps a table of
/// coefficients if the table fits in `budget` bytes, a whole number or
/// infinity for no measured bound, and computes them as it goes otherwise;
/// a negative or NaN budget is refused.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_create(
    from: u32,
    to: u32,
    channels: u32,
    quality: u32,
    budget: f64,
) -> u32 {
    let (Some(level), Ok(count)) = (
        ResamplingQuality::from_code(quality),
        usize::try_from(channels),
    ) else {
        return 0;
    };
    if budget.is_nan() || budget < 0.0 {
        return 0;
    }
    // Saturating: a budget past the address space is no bound at all.
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "non-negative, and saturating is the meaning"
    )]
    let bytes = budget as usize;
    StreamingResampler::new(from, to, count, level, bytes).map_or(0, |resampler| {
        with_objects(|objects| objects.resamplers.insert(resampler))
    })
}

/// The bytes the resampler's coefficient table holds; 0 where it computes
/// its taps as it goes, and -1 for a bad handle. A table is never empty, so
/// the answer also says which strategy the resampler took.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_table_bytes(resampler: u32) -> f64 {
    with_objects(|objects| {
        #[allow(
            clippy::cast_precision_loss,
            reason = "a table in a 32-bit memory is far below 2^53 bytes"
        )]
        objects
            .resamplers
            .get_mut(resampler)
            .map_or(-1.0, |r| r.table_bytes() as f64)
    })
}

/// Input frames the resampler needs past an output sample, or `u32::MAX` for a
/// bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_lookahead(resampler: u32) -> u32 {
    with_objects(|objects| {
        objects
            .resamplers
            .get_mut(resampler)
            .map_or(u32::MAX, |r| r.lookahead())
    })
}

/// Pushes `frames` frames of planar input from `buffer`: channel `c` is the
/// samples from `c · frames`.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_push(resampler: u32, buffer: u32, frames: u32) -> u32 {
    with_objects(|objects| {
        let Objects {
            buffers,
            resamplers,
            ..
        } = objects;
        let (Some(converter), Some(samples)) =
            (resamplers.get_mut(resampler), buffers.get_mut(buffer))
        else {
            return STATUS_BAD_HANDLE;
        };
        let Some(planes) = planes(samples, converter.channels(), frames) else {
            return STATUS_TOO_SMALL;
        };
        let input: Vec<&[f32]> = planes.iter().map(|plane| &**plane).collect();
        match converter.push(&input) {
            Ok(()) => STATUS_DONE,
            Err(_) => STATUS_REFUSED,
        }
    })
}

/// Marks the end of the resampler's input.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_finish(resampler: u32) -> u32 {
    with_objects(|objects| match objects.resamplers.get_mut(resampler) {
        Some(converter) => {
            converter.finish();
            STATUS_DONE
        }
        None => STATUS_BAD_HANDLE,
    })
}

/// Writes up to `capacity` frames of planar output into `buffer`, channel `c`
/// from `c · capacity`, and answers how many; [`COUNT_BAD_HANDLE`] for a bad
/// handle and [`COUNT_TOO_SMALL`] for a buffer that cannot hold them.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_pull(resampler: u32, buffer: u32, capacity: u32) -> u32 {
    with_objects(|objects| {
        let Objects {
            buffers,
            resamplers,
            ..
        } = objects;
        let (Some(converter), Some(samples)) =
            (resamplers.get_mut(resampler), buffers.get_mut(buffer))
        else {
            return COUNT_BAD_HANDLE;
        };
        let Some(mut planes) = planes(samples, converter.channels(), capacity) else {
            return COUNT_TOO_SMALL;
        };
        let written = converter.pull(&mut planes);
        // At most `capacity`, a u32, so the fallback is never taken.
        u32::try_from(written).unwrap_or(COUNT_TOO_SMALL)
    })
}

/// 1 once every output frame has been pulled, 0 before, `u32::MAX` for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_drained(resampler: u32) -> u32 {
    with_objects(|objects| {
        objects
            .resamplers
            .get_mut(resampler)
            .map_or(u32::MAX, |r| u32::from(r.is_drained()))
    })
}

/// Moves the resampler so the next frame pulled is output frame `frame`, and
/// answers the input frame the next push must start at; -1 when the handle
/// names nothing, when `frame` is not a whole number from 0 to 2⁵³, or when
/// the input frame would be past 2⁵³.
///
/// Frames cross as `f64` because the engine counts them in JavaScript
/// numbers, and an `f64` holds every whole number up to 2⁵³ exactly.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_seek(resampler: u32, frame: f64) -> f64 {
    let Some(whole) = whole_frame(frame) else {
        return -1.0;
    };
    with_objects(|objects| {
        let Some(converter) = objects.resamplers.get_mut(resampler) else {
            return -1.0;
        };
        #[allow(
            clippy::cast_precision_loss,
            reason = "compared with 2^53 at once, below which it is exact"
        )]
        match converter.seek(whole).map(|start| start as f64) {
            Ok(start) if start <= LAST_EXACT_FRAME => start,
            _ => -1.0,
        }
    })
}

/// Releases a resampler.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_release(resampler: u32) -> u32 {
    status_of(with_objects(|objects| objects.resamplers.remove(resampler)))
}

/// An FFT of `size` real samples, or 0 unless `size` is a power of two from
/// 2 to 65 536. Its tables and scratch are made here, so a transform
/// allocates nothing.
#[unsafe(no_mangle)]
pub extern "C" fn ag_fft_create(size: u32) -> u32 {
    usize::try_from(size)
        .ok()
        .and_then(|samples| Fft::new(samples).ok())
        .map_or(0, |fft| with_objects(|objects| objects.ffts.insert(fft)))
}

/// Transforms the `N` samples at the start of the `f64` buffer `input`, and
/// writes the spectrum's `N/2 + 1` real parts and then its `N/2 + 1`
/// imaginary parts to the start of the `f64` buffer `output`, another buffer.
#[unsafe(no_mangle)]
pub extern "C" fn ag_fft_forward_real(fft: u32, input: u32, output: u32) -> u32 {
    with_fft_buffers(fft, input, output, |transform, from, to| {
        let bins = transform.bins();
        let (Some(signal), Some(spectrum)) = (from.get(..transform.size()), to.get_mut(..2 * bins))
        else {
            return STATUS_TOO_SMALL;
        };
        let (real, imaginary) = spectrum.split_at_mut(bins);
        status_of(transform.forward_real(signal, real, imaginary).is_ok())
    })
}

/// Takes a spectrum laid out as [`ag_fft_forward_real`] writes one, at the
/// start of the `f64` buffer `input`, back to `N` samples at the start of the
/// `f64` buffer `output`, another buffer.
#[unsafe(no_mangle)]
pub extern "C" fn ag_fft_inverse_real(fft: u32, input: u32, output: u32) -> u32 {
    with_fft_buffers(fft, input, output, |transform, from, to| {
        let bins = transform.bins();
        let (Some(spectrum), Some(signal)) = (from.get(..2 * bins), to.get_mut(..transform.size()))
        else {
            return STATUS_TOO_SMALL;
        };
        let (real, imaginary) = spectrum.split_at(bins);
        status_of(transform.inverse_real(real, imaginary, signal).is_ok())
    })
}

/// Releases an FFT.
#[unsafe(no_mangle)]
pub extern "C" fn ag_fft_release(fft: u32) -> u32 {
    status_of(with_objects(|objects| objects.ffts.remove(fft)))
}

/// Runs `work` on the FFT and the two `f64` buffers the handles name;
/// [`STATUS_BAD_HANDLE`] where one names nothing, and [`STATUS_REFUSED`]
/// where the two are one buffer, which a transform cannot read and write at
/// once.
fn with_fft_buffers(
    fft: u32,
    input: u32,
    output: u32,
    work: impl FnOnce(&mut Fft, &[f64], &mut [f64]) -> u32,
) -> u32 {
    with_objects(|objects| {
        let Objects {
            buffers_f64, ffts, ..
        } = objects;
        let Some(transform) = ffts.get_mut(fft) else {
            return STATUS_BAD_HANDLE;
        };
        match buffers_f64.pair_mut(input, output) {
            Pair::Both(from, to) => work(transform, from, to),
            Pair::Same => STATUS_REFUSED,
            Pair::Missing => STATUS_BAD_HANDLE,
        }
    })
}

/// The first `channels · frames` samples as one slice per channel, or `None`
/// when the buffer is too small.
fn planes(samples: &mut [f32], channels: usize, frames: u32) -> Option<Vec<&mut [f32]>> {
    let length = usize::try_from(frames).ok()?;
    let used = samples.get_mut(..channels.checked_mul(length)?)?;
    if length == 0 {
        return Some((0..channels).map(|_| <&mut [f32]>::default()).collect());
    }
    Some(used.chunks_mut(length).collect())
}

fn status_of(released: bool) -> u32 {
    if released {
        STATUS_DONE
    } else {
        STATUS_BAD_HANDLE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_an_oscillator_into_a_buffer_it_names() {
        let buffer = ag_buffer_create(64);
        let oscillator = ag_oscillator_create(1_000.0, 48_000, 0.0, 1.0);
        assert_ne!(buffer, 0);
        assert_ne!(oscillator, 0);
        assert_eq!(ag_oscillator_render(oscillator, buffer, 64), STATUS_DONE);
        assert_eq!(
            ag_oscillator_render(oscillator, buffer, 65),
            STATUS_TOO_SMALL
        );
        assert_eq!(
            ag_oscillator_render(oscillator + 100, buffer, 8),
            STATUS_BAD_HANDLE
        );
        assert_eq!(ag_oscillator_release(oscillator), STATUS_DONE);
        assert_eq!(ag_oscillator_release(oscillator), STATUS_BAD_HANDLE);
        assert_eq!(ag_buffer_release(buffer), STATUS_DONE);
    }

    #[test]
    fn refuses_settings_rather_than_trapping() {
        assert_eq!(ag_oscillator_create(30_000.0, 48_000, 0.0, 1.0), 0);
        assert_eq!(ag_resampler_create(0, 48_000, 2, 0, f64::INFINITY), 0);
        assert_eq!(ag_resampler_create(44_100, 48_000, 2, 9, f64::INFINITY), 0);
        assert_eq!(ag_resampler_lookahead(12_345), u32::MAX);
    }

    #[test]
    fn converts_planar_channels_through_buffers() {
        let resampler = ag_resampler_create(48_000, 24_000, 2, 2, f64::INFINITY);
        let input = ag_buffer_create(200);
        let output = ag_buffer_create(400);
        assert_eq!(ag_resampler_push(resampler, input, 100), STATUS_DONE);
        assert_eq!(ag_resampler_push(resampler, input, 101), STATUS_TOO_SMALL);
        assert_eq!(
            ag_resampler_push(resampler + 100, input, 10),
            STATUS_BAD_HANDLE
        );
        assert_eq!(ag_resampler_finish(resampler), STATUS_DONE);
        assert_eq!(ag_resampler_push(resampler, input, 10), STATUS_REFUSED);
        assert_eq!(ag_resampler_pull(resampler, output, 201), COUNT_TOO_SMALL);
        assert_eq!(
            ag_resampler_pull(resampler + 100, output, 1),
            COUNT_BAD_HANDLE
        );
        assert_eq!(ag_resampler_pull(resampler, output, 200), 50);
        assert_eq!(ag_resampler_drained(resampler), 1);
        assert_eq!(ag_resampler_release(resampler), STATUS_DONE);
    }

    #[test]
    fn keeps_a_table_within_the_budget_and_computes_past_it() {
        #![allow(clippy::float_cmp, reason = "whole numbers, exact in an f64")]
        let tabled = ag_resampler_create(44_100, 48_000, 1, 2, f64::INFINITY);
        let bytes = ag_resampler_table_bytes(tabled);
        assert!(bytes > 0.0);
        let computed = ag_resampler_create(44_100, 48_000, 1, 2, bytes - 1.0);
        assert_eq!(ag_resampler_table_bytes(computed), 0.0);
        assert_eq!(ag_resampler_table_bytes(computed + 100), -1.0);
        assert_eq!(ag_resampler_create(44_100, 48_000, 1, 2, -1.0), 0);
        assert_eq!(ag_resampler_create(44_100, 48_000, 1, 2, f64::NAN), 0);
        assert_eq!(ag_resampler_release(tabled), STATUS_DONE);
        assert_eq!(ag_resampler_release(computed), STATUS_DONE);
    }

    #[test]
    fn transforms_between_f64_buffers_and_refuses_rather_than_trapping() {
        assert_eq!(ag_fft_create(0), 0);
        assert_eq!(ag_fft_create(6), 0);
        assert_eq!(ag_fft_create(131_072), 0);
        let fft = ag_fft_create(8);
        let signal = ag_buffer_f64_create(8);
        let spectrum = ag_buffer_f64_create(10);
        let short = ag_buffer_f64_create(9);
        assert_ne!(fft, 0);
        assert_eq!(ag_fft_forward_real(fft, signal, spectrum), STATUS_DONE);
        assert_eq!(ag_fft_inverse_real(fft, spectrum, signal), STATUS_DONE);
        assert_eq!(ag_fft_forward_real(fft, signal, short), STATUS_TOO_SMALL);
        assert_eq!(ag_fft_inverse_real(fft, short, signal), STATUS_TOO_SMALL);
        assert_eq!(ag_fft_inverse_real(fft, spectrum, short), STATUS_DONE);
        assert_eq!(ag_fft_forward_real(fft, spectrum, spectrum), STATUS_REFUSED);
        assert_eq!(
            ag_fft_forward_real(fft + 100, signal, spectrum),
            STATUS_BAD_HANDLE
        );
        assert_eq!(ag_fft_forward_real(fft, signal, 999), STATUS_BAD_HANDLE);
        // An f32 buffer's handle names nothing in the f64 table.
        let samples = ag_buffer_create(64);
        assert_eq!(ag_buffer_f64_release(samples + 100), STATUS_BAD_HANDLE);
        assert_eq!(ag_fft_release(fft), STATUS_DONE);
        assert_eq!(ag_fft_release(fft), STATUS_BAD_HANDLE);
        for buffer in [signal, spectrum, short] {
            assert_eq!(ag_buffer_f64_release(buffer), STATUS_DONE);
        }
        assert_eq!(ag_buffer_release(samples), STATUS_DONE);
    }

    #[test]
    fn seeks_an_oscillator_to_a_whole_frame() {
        let oscillator = ag_oscillator_create(1_000.0, 48_000, 0.0, 1.0);
        assert_eq!(ag_oscillator_seek(oscillator, 12.0), STATUS_DONE);
        assert_eq!(ag_oscillator_seek(oscillator, 0.5), STATUS_REFUSED);
        assert_eq!(ag_oscillator_seek(oscillator + 100, 0.0), STATUS_BAD_HANDLE);
        assert_eq!(ag_oscillator_release(oscillator), STATUS_DONE);
    }

    #[test]
    fn renders_nothing_into_a_buffer_of_nothing() {
        let buffer = ag_buffer_create(0);
        let oscillator = ag_oscillator_create(1_000.0, 48_000, 0.0, 1.0);
        assert_ne!(buffer, 0);
        assert_eq!(ag_oscillator_render(oscillator, buffer, 0), STATUS_DONE);
        assert_eq!(ag_oscillator_release(oscillator), STATUS_DONE);
        assert_eq!(ag_buffer_release(buffer), STATUS_DONE);
    }

    #[test]
    fn seeks_to_a_whole_frame_and_refuses_any_other() {
        #![allow(clippy::float_cmp, reason = "whole numbers, exact in an f64")]
        let resampler = ag_resampler_create(44_100, 48_000, 1, 2, f64::INFINITY);
        let half = f64::from(ag_resampler_lookahead(resampler));
        assert_eq!(ag_resampler_seek(resampler, 160_000.0), 147_000.0 - half);
        assert_eq!(ag_resampler_seek(resampler, 0.5), -1.0);
        assert_eq!(ag_resampler_seek(resampler, -1.0), -1.0);
        assert_eq!(ag_resampler_seek(resampler, f64::NAN), -1.0);
        assert_eq!(ag_resampler_seek(resampler, 2.0_f64.powi(54)), -1.0);
        assert_eq!(ag_resampler_seek(resampler + 100, 0.0), -1.0);
        assert_eq!(ag_resampler_release(resampler), STATUS_DONE);
    }
}
