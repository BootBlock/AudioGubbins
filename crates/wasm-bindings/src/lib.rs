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

mod table;

use std::cell::RefCell;

use audiogubbins_dsp_core::{SineOscillator, sine_of_turns};
use audiogubbins_resampling::{ResamplingQuality, StreamingResampler};

use table::Table;

/// The ABI's version. The TypeScript side refuses a module of another.
///
/// 2 added `ag_resampler_seek`, and [`STATUS_TOO_SMALL`] and
/// [`COUNT_TOO_SMALL`] where 1 answered a bad handle.
pub const ABI_VERSION: u32 = 2;

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
    oscillators: Table<SineOscillator>,
    resamplers: Table<StreamingResampler>,
}

thread_local! {
    static OBJECTS: RefCell<Objects> = const {
        RefCell::new(Objects {
            buffers: Table::new(),
            oscillators: Table::new(),
            resamplers: Table::new(),
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

/// `sin(2π · turns)` by the canonical rule, for the reference path's
/// conformance tests.
#[unsafe(no_mangle)]
pub extern "C" fn ag_sine_of_turns(turns: f64) -> f64 {
    sine_of_turns(turns)
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

/// Releases an oscillator.
#[unsafe(no_mangle)]
pub extern "C" fn ag_oscillator_release(oscillator: u32) -> u32 {
    status_of(with_objects(|objects| {
        objects.oscillators.remove(oscillator)
    }))
}

/// A resampler, or 0 if its settings are refused.
#[unsafe(no_mangle)]
pub extern "C" fn ag_resampler_create(from: u32, to: u32, channels: u32, quality: u32) -> u32 {
    let (Some(level), Ok(count)) = (
        ResamplingQuality::from_code(quality),
        usize::try_from(channels),
    ) else {
        return 0;
    };
    StreamingResampler::new(from, to, count, level).map_or(0, |resampler| {
        with_objects(|objects| objects.resamplers.insert(resampler))
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
    if !((0.0..=LAST_EXACT_FRAME).contains(&frame) && frame.fract() == 0.0) {
        return -1.0;
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a whole number from 0 to 2^53, checked above"
    )]
    let whole = frame as u64;
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
        assert_eq!(ag_resampler_create(0, 48_000, 2, 0), 0);
        assert_eq!(ag_resampler_create(44_100, 48_000, 2, 9), 0);
        assert_eq!(ag_resampler_lookahead(12_345), u32::MAX);
    }

    #[test]
    fn converts_planar_channels_through_buffers() {
        let resampler = ag_resampler_create(48_000, 24_000, 2, 2);
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
        let resampler = ag_resampler_create(44_100, 48_000, 1, 2);
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
