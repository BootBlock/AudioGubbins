//! The one import of the module: the host's synchronous ranged read of a file
//! (ADR-0090's `SyncAudioBytes`), and the [`ByteSource`] over it.
//!
//! In WebAssembly the host gives the import `ag_codec_read` from the module
//! `audiogubbins_codecs`: it copies the bytes of the file it registered as
//! `source` from `offset` into the module's memory at `destination`, at most
//! `length` of them, and answers how many, or a negative number where it
//! cannot read the file. It must not call the module while it runs.
//!
//! Built natively, for `cargo test`, the module has no host, so it reads the
//! files a test registers with [`register_host_file`] instead.

use audiogubbins_codecs::{ByteSource, ReadFailure};

/// The largest whole number the ABI carries exactly in an `f64`.
const LAST_EXACT: f64 = 9_007_199_254_740_992.0;

/// `value` as a whole number, if it is one from 0 to 2⁵³.
pub fn whole_number(value: f64) -> Option<u64> {
    if !((0.0..=LAST_EXACT).contains(&value) && value.fract() == 0.0) {
        return None;
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a whole number from 0 to 2^53, checked above"
    )]
    Some(value as u64)
}

/// `value` as the ABI's `f64`, if it is at most 2⁵³, below which it is exact.
pub fn exact_f64(value: u64) -> Option<f64> {
    #[allow(clippy::cast_precision_loss, reason = "compared with 2^53 at once")]
    let carried = value as f64;
    (carried <= LAST_EXACT).then_some(carried)
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "audiogubbins_codecs")]
unsafe extern "C" {
    fn ag_codec_read(source: u32, offset: f64, destination: u32, length: u32) -> i32;
}

/// Asks the host for the bytes of `source` at `offset`.
#[cfg(target_arch = "wasm32")]
fn host_read(source: u32, offset: f64, into: &mut [u8]) -> Result<usize, ReadFailure> {
    // A 32-bit memory's addresses and lengths fit a u32.
    let destination =
        u32::try_from(into.as_mut_ptr().addr()).map_err(|_| ReadFailure::Unreadable)?;
    let length = u32::try_from(into.len()).map_err(|_| ReadFailure::Unreadable)?;
    // SAFETY: `into` is memory this module owns and lends the host for the
    // call alone, as `length` bytes from `destination`; nothing else reads or
    // writes it until the call returns, and the host writes nowhere else.
    let copied = unsafe { ag_codec_read(source, offset, destination, length) };
    usize::try_from(copied)
        .ok()
        .filter(|&copied| copied <= into.len())
        .ok_or(ReadFailure::Unreadable)
}

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use std::cell::RefCell;

    use audiogubbins_codecs::ReadFailure;
    use audiogubbins_handle_table::Table;

    use super::whole_number;

    thread_local! {
        static FILES: RefCell<Table<Vec<u8>>> = const { RefCell::new(Table::new()) };
    }

    /// Registers `bytes` as a file the native build's reads answer from,
    /// answering the source that names it.
    #[must_use]
    pub fn register_host_file(bytes: Vec<u8>) -> u32 {
        FILES.with_borrow_mut(|files| files.insert(bytes))
    }

    pub fn host_read(source: u32, offset: f64, into: &mut [u8]) -> Result<usize, ReadFailure> {
        FILES.with_borrow_mut(|files| {
            let bytes = files.get_mut(source).ok_or(ReadFailure::Unreadable)?;
            let start = whole_number(offset)
                .and_then(|offset| usize::try_from(offset).ok())
                .ok_or(ReadFailure::Unreadable)?;
            let available = bytes.get(start..).unwrap_or(&[]);
            let count = available.len().min(into.len());
            into[..count].copy_from_slice(&available[..count]);
            Ok(count)
        })
    }
}

#[cfg(not(target_arch = "wasm32"))]
use native::host_read;
#[cfg(not(target_arch = "wasm32"))]
pub use native::register_host_file;

/// A file the host registered, read through the import.
pub struct HostFile {
    source: u32,
    size: u64,
}

impl HostFile {
    /// The file the host registered as `source`, of `size` bytes, or `None`
    /// for a size the ABI cannot carry exactly.
    pub fn new(source: u32, size: f64) -> Option<Self> {
        Some(Self {
            source,
            size: whole_number(size)?,
        })
    }
}

impl ByteSource for HostFile {
    fn size(&self) -> u64 {
        self.size
    }

    fn read_at(&mut self, offset: u64, into: &mut [u8]) -> Result<usize, ReadFailure> {
        let offset = exact_f64(offset).ok_or(ReadFailure::Unreadable)?;
        host_read(self.source, offset, into)
    }
}
