//! The file a decoder reads, through a synchronous ranged read (ADR-0090).
//!
//! The codec worker gives the module a file it can read synchronously: in a
//! browser, a `FileReaderSync` over a file's slice or an origin-private file's
//! sync access handle. The module never holds the file whole; Symphonia reads
//! it through [`SourceReader`], which turns its `Read` and `Seek` calls into
//! ranged reads.

use std::io::{self, Read, Seek, SeekFrom};

use symphonia::core::io::MediaSource;

/// Why a ranged read failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadFailure {
    /// The host could not read the file: it was removed, or its permission
    /// was withdrawn.
    Unreadable,
    /// The file answered fewer bytes before its stated end than were asked
    /// for, so it changed after it was opened.
    Changed,
}

/// A file of a known size, read synchronously by range.
pub trait ByteSource {
    /// The size of the file in bytes.
    fn size(&self) -> u64;

    /// Copies the bytes at `offset` into `into`, answering how many: fewer
    /// than `into.len()` only where the file ends.
    ///
    /// # Errors
    ///
    /// [`ReadFailure`] where the host cannot read the file.
    fn read_at(&mut self, offset: u64, into: &mut [u8]) -> Result<usize, ReadFailure>;
}

/// The error a [`SourceReader`] carries through Symphonia's I/O, so the
/// session can tell a failed read from a malformed file once Symphonia
/// returns it.
#[derive(Debug)]
pub struct SourceReadError(pub ReadFailure);

impl std::fmt::Display for SourceReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.0 {
            ReadFailure::Unreadable => f.write_str("the file could not be read"),
            ReadFailure::Changed => f.write_str("the file changed while it was read"),
        }
    }
}

impl std::error::Error for SourceReadError {}

/// What a failed read is when it reaches Symphonia as an I/O error.
fn io_error(failure: ReadFailure) -> io::Error {
    io::Error::other(SourceReadError(failure))
}

/// The [`ReadFailure`] an I/O error carries, if a [`SourceReader`] made it.
#[must_use]
pub fn read_failure_of(error: &io::Error) -> Option<ReadFailure> {
    error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<SourceReadError>())
        .map(|carried| carried.0)
}

/// A [`ByteSource`] read as a stream: Symphonia's `MediaSource`.
pub struct SourceReader<S: ByteSource> {
    source: S,
    position: u64,
}

impl<S: ByteSource> SourceReader<S> {
    /// A reader of `source` from its first byte.
    pub const fn new(source: S) -> Self {
        Self {
            source,
            position: 0,
        }
    }
}

impl<S: ByteSource> Read for SourceReader<S> {
    fn read(&mut self, into: &mut [u8]) -> io::Result<usize> {
        let size = self.source.size();
        if self.position >= size || into.is_empty() {
            return Ok(0);
        }
        // Never asks past the end, so a short answer is the file changing.
        let remaining = size - self.position;
        let wanted = usize::try_from(remaining).map_or(into.len(), |left| left.min(into.len()));
        let target = &mut into[..wanted];
        let copied = self
            .source
            .read_at(self.position, target)
            .map_err(io_error)?;
        if copied != wanted {
            return Err(io_error(ReadFailure::Changed));
        }
        self.position += copied as u64;
        Ok(copied)
    }
}

impl<S: ByteSource> Seek for SourceReader<S> {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let size = self.source.size();
        let target = match to {
            SeekFrom::Start(offset) => Some(offset),
            SeekFrom::End(delta) => size.checked_add_signed(delta),
            SeekFrom::Current(delta) => self.position.checked_add_signed(delta),
        };
        let Some(position) = target else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a seek before the start of the file",
            ));
        };
        self.position = position;
        Ok(position)
    }
}

impl<S: ByteSource + Send + Sync> MediaSource for SourceReader<S> {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.source.size())
    }
}

#[cfg(test)]
pub mod memory {
    //! A [`ByteSource`] over bytes in memory, for the tests.

    use super::{ByteSource, ReadFailure};

    /// Bytes in memory read as a file.
    pub struct MemorySource(pub Vec<u8>);

    impl ByteSource for MemorySource {
        fn size(&self) -> u64 {
            self.0.len() as u64
        }

        fn read_at(&mut self, offset: u64, into: &mut [u8]) -> Result<usize, ReadFailure> {
            let start = usize::try_from(offset).map_err(|_| ReadFailure::Unreadable)?;
            let available = self.0.get(start..).unwrap_or(&[]);
            let count = available.len().min(into.len());
            into[..count].copy_from_slice(&available[..count]);
            Ok(count)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Seek, SeekFrom};

    use super::memory::MemorySource;
    use super::{ByteSource, ReadFailure, SourceReader, read_failure_of};

    /// A file that says it is longer than the bytes it answers.
    struct Shrunk;

    impl ByteSource for Shrunk {
        fn size(&self) -> u64 {
            10
        }

        fn read_at(&mut self, _offset: u64, into: &mut [u8]) -> Result<usize, ReadFailure> {
            Ok(into.len().min(4))
        }
    }

    #[test]
    fn reads_and_seeks_by_range() {
        let mut reader = SourceReader::new(MemorySource((0u8..20).collect()));
        let mut into = [0u8; 4];
        assert_eq!(reader.read(&mut into).ok(), Some(4));
        assert_eq!(into, [0, 1, 2, 3]);
        assert_eq!(reader.seek(SeekFrom::End(-2)).ok(), Some(18));
        assert_eq!(reader.read(&mut into).ok(), Some(2));
        assert_eq!(&into[..2], &[18, 19]);
        assert_eq!(reader.read(&mut into).ok(), Some(0));
        assert!(reader.seek(SeekFrom::Current(-30)).is_err());
    }

    #[test]
    fn a_short_answer_before_the_end_is_the_file_changing() {
        let mut reader = SourceReader::new(Shrunk);
        let mut into = [0u8; 8];
        let error = reader.read(&mut into).err();
        assert_eq!(
            error.as_ref().and_then(read_failure_of),
            Some(ReadFailure::Changed)
        );
    }
}
