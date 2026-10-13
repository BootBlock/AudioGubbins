//! The narrow C ABI through which the TypeScript codec runtime reaches the
//! codec module (ADR-0091, under ADR-0031's rules).
//!
//! Every object, a buffer as much as a decode session, is named by an integer
//! handle into a table this module owns, so no pointer to a Rust object
//! crosses the boundary. The addresses the TypeScript side is given are of
//! bytes or samples it reads or writes through a typed-array view: a buffer
//! it made, which never reallocates; or what an object last gave, a frame,
//! a packet or a description, which holds until the next call on that
//! object.
//!
//! Every call answers an `i32`: a handle or a count, never negative, or one of
//! the negative failures below, so no input from the other side can make the
//! module panic, which in WebAssembly would trap and lose the instance.
//!
//! The module has one import, the host's synchronous read of a file
//! (`host_file.rs`). The tables are the state of one instance, which the codec
//! worker alone instantiates, so nothing is shared between threads.

// ADR-0031, amended by ADR-0091: exporting an unmangled symbol and calling
// the import are unsafe, and this crate exists to do both. Each `unsafe`
// block states the invariant it relies on.
#![allow(unsafe_code)]

mod decoding;
mod flac;
mod host_file;
mod opus;

use std::cell::RefCell;

use audiogubbins_codecs::CodecFailure;
use audiogubbins_handle_table::Table;

#[cfg(not(target_arch = "wasm32"))]
pub use host_file::register_host_file;

/// The ABI's version. The TypeScript side refuses a module of another.
pub const ABI_VERSION: u32 = 1;

/// The call did what it was asked.
pub const DONE: i32 = 0;
/// A handle named nothing.
pub const BAD_HANDLE: i32 = -1;
/// A buffer named holds fewer elements than the call reads or writes.
pub const TOO_SMALL: i32 = -2;
/// The host could not read the file.
pub const UNREADABLE: i32 = -3;
/// The file changed while it was read.
pub const CHANGED: i32 = -4;
/// No container the module reads was found in the file.
pub const UNRECOGNISED: i32 = -5;
/// The container holds no audio track.
pub const NO_AUDIO_TRACK: i32 = -6;
/// The audio is in a codec, or a form of one, the module does not decode.
pub const UNSUPPORTED: i32 = -7;
/// The file breaks its format's rules, or a packet would not decode.
pub const MALFORMED: i32 = -8;
/// An encoder was given settings or samples it cannot encode, or a call came
/// out of its order.
pub const REFUSED: i32 = -9;
/// The module could not make the object: its handles are spent.
pub const EXHAUSTED: i32 = -10;

/// The failure a [`CodecFailure`] is answered as.
const fn code_of(failure: CodecFailure) -> i32 {
    match failure {
        CodecFailure::Unreadable => UNREADABLE,
        CodecFailure::Changed => CHANGED,
        CodecFailure::Unrecognised => UNRECOGNISED,
        CodecFailure::NoAudioTrack => NO_AUDIO_TRACK,
        CodecFailure::Unsupported => UNSUPPORTED,
        CodecFailure::Malformed => MALFORMED,
        CodecFailure::Refused => REFUSED,
    }
}

/// A count answered as the ABI's `i32`, or [`TOO_SMALL`] where it is past
/// what one carries, which no buffer in a 32-bit memory reaches.
fn count(value: usize) -> i32 {
    i32::try_from(value).unwrap_or(TOO_SMALL)
}

/// A handle a table answered, or [`EXHAUSTED`] for its 0.
fn handle(value: u32) -> i32 {
    match value {
        0 => EXHAUSTED,
        made => i32::try_from(made).unwrap_or(EXHAUSTED),
    }
}

/// Where a slice starts in the module's memory; an address in a 32-bit
/// memory always fits.
fn address_of<T>(slice: &[T]) -> u32 {
    u32::try_from(slice.as_ptr().addr()).unwrap_or(0)
}

/// Every object of one instance, by kind.
struct Objects {
    bytes: Table<Vec<u8>>,
    floats: Table<Vec<f32>>,
    ints: Table<Vec<i32>>,
    decoders: Table<decoding::DecoderEntry>,
    flac_encoders: Table<audiogubbins_codecs::FlacFrameEncoder>,
    opus_encoders: Table<opus::EncoderEntry>,
    opus_decoders: Table<opus::DecoderEntry>,
}

thread_local! {
    static OBJECTS: RefCell<Objects> = const {
        RefCell::new(Objects {
            bytes: Table::new(),
            floats: Table::new(),
            ints: Table::new(),
            decoders: Table::new(),
            flac_encoders: Table::new(),
            opus_encoders: Table::new(),
            opus_decoders: Table::new(),
        })
    };
}

fn with_objects<R>(work: impl FnOnce(&mut Objects) -> R) -> R {
    OBJECTS.with_borrow_mut(work)
}

/// The ABI's version.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_abi_version() -> u32 {
    ABI_VERSION
}

/// The handle of a buffer of `length` zeroed elements in `table`.
fn create<T: Clone + Default>(table: &mut Table<Vec<T>>, length: u32) -> i32 {
    usize::try_from(length).map_or(TOO_SMALL, |length| {
        handle(table.insert(vec![T::default(); length]))
    })
}

/// Where a buffer's elements start, or 0 for a bad handle.
fn address<T>(table: &mut Table<Vec<T>>, buffer: u32) -> u32 {
    table
        .get_mut(buffer)
        .map_or(0, |elements| address_of(elements))
}

fn release<T>(table: &mut Table<T>, handle: u32) -> i32 {
    if table.remove(handle) {
        DONE
    } else {
        BAD_HANDLE
    }
}

/// A buffer of `length` bytes, all zero: a packet the host writes, or a file
/// part a test reads.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_bytes_create(length: u32) -> i32 {
    with_objects(|objects| create(&mut objects.bytes, length))
}

/// Where a byte buffer starts in the module's memory, or 0 for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_bytes_address(buffer: u32) -> u32 {
    with_objects(|objects| address(&mut objects.bytes, buffer))
}

/// Releases a byte buffer.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_bytes_release(buffer: u32) -> i32 {
    with_objects(|objects| release(&mut objects.bytes, buffer))
}

/// A buffer of `count` `f32` samples, all zero.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_floats_create(count: u32) -> i32 {
    with_objects(|objects| create(&mut objects.floats, count))
}

/// Where a sample buffer starts, four-byte aligned, or 0 for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_floats_address(buffer: u32) -> u32 {
    with_objects(|objects| address(&mut objects.floats, buffer))
}

/// Releases a sample buffer.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_floats_release(buffer: u32) -> i32 {
    with_objects(|objects| release(&mut objects.floats, buffer))
}

/// A buffer of `count` `i32` samples, all zero: integer samples for FLAC.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_ints_create(count: u32) -> i32 {
    with_objects(|objects| create(&mut objects.ints, count))
}

/// Where an integer buffer starts, four-byte aligned, or 0 for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_ints_address(buffer: u32) -> u32 {
    with_objects(|objects| address(&mut objects.ints, buffer))
}

/// Releases an integer buffer.
#[unsafe(no_mangle)]
pub extern "C" fn ag_codec_ints_release(buffer: u32) -> i32 {
    with_objects(|objects| release(&mut objects.ints, buffer))
}

/// The first `frames` samples of each of `channels` planes laid one after
/// another in `buffer`, or `None` where it holds fewer.
fn planes<T>(buffer: &[T], channels: usize, frames: usize) -> Option<Vec<&[T]>> {
    if frames == 0 {
        return Some(vec![&buffer[..0]; channels]);
    }
    let samples = buffer.get(..channels.checked_mul(frames)?)?;
    Some(samples.chunks_exact(frames).collect())
}

#[cfg(test)]
mod tests;
