//! EBML (RFC 8794), as much as the module reads of Matroska itself: element
//! headers, read through a stream, and the integers elements hold.

use std::io;

use symphonia::core::io::ReadBytes;

use crate::byte_source::read_failure_of;
use crate::failure::CodecFailure;

/// The longest element identifier: four bytes.
const MAX_ID_LENGTH: u32 = 4;

/// The longest size, or the longest integer an element holds: eight bytes.
pub const MAX_VINT_LENGTH: u32 = 8;

/// What an I/O error reading an element means: a read the host refused, or
/// a file that ends inside an element.
pub fn failure_of_io(error: &io::Error) -> CodecFailure {
    read_failure_of(error).map_or(CodecFailure::Malformed, CodecFailure::from)
}

/// An element's header.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Header {
    /// The identifier, its length marker kept, as RFC 8794 writes them.
    pub id: u32,
    /// The bytes of content, or `None` for an element of unknown size,
    /// which ends where its parent does or where an element that cannot be
    /// its child begins.
    pub size: Option<u64>,
    /// Where its content begins.
    pub content: u64,
}

impl Header {
    /// Where its content ends, if its size is known.
    #[must_use]
    pub fn end(&self) -> Option<u64> {
        self.size.and_then(|size| self.content.checked_add(size))
    }
}

/// The length of a variable-length integer from its first byte, if it is
/// at most `limit` bytes.
fn vint_length(first: u8, limit: u32) -> Result<u32, CodecFailure> {
    let length = first.leading_zeros() + 1;
    if length > limit {
        return Err(CodecFailure::Malformed);
    }
    Ok(length)
}

/// Reads a variable-length integer: its value, with its length marker
/// removed where `strip`, and its length in bytes.
///
/// # Errors
///
/// [`CodecFailure::Malformed`] for an integer longer than `limit` bytes, or
/// a file that ends inside it.
pub fn read_vint<R: ReadBytes>(
    reader: &mut R,
    limit: u32,
    strip: bool,
) -> Result<(u64, u32), CodecFailure> {
    let first = reader.read_byte().map_err(|error| failure_of_io(&error))?;
    let length = vint_length(first, limit)?;
    let mut value = u64::from(if strip {
        first & u8::MAX.checked_shr(length).unwrap_or(0)
    } else {
        first
    });
    for _ in 1..length {
        let byte = reader.read_byte().map_err(|error| failure_of_io(&error))?;
        value = (value << 8) | u64::from(byte);
    }
    Ok((value, length))
}

/// Reads an element's header at the reader's position.
///
/// # Errors
///
/// [`CodecFailure::Malformed`] for an identifier or size of no valid
/// length, or a file that ends inside the header.
pub fn read_header<R: ReadBytes>(reader: &mut R) -> Result<Header, CodecFailure> {
    let (id, _) = read_vint(reader, MAX_ID_LENGTH, false)?;
    let (size, length) = read_vint(reader, MAX_VINT_LENGTH, true)?;
    // Every bit of the value set is the reserved "unknown" size.
    let unknown = (1u64 << (7 * length)) - 1;
    Ok(Header {
        id: u32::try_from(id).map_err(|_| CodecFailure::Malformed)?,
        size: (size != unknown).then_some(size),
        content: reader.pos(),
    })
}

/// A variable-length integer at the start of `bytes`, with its length
/// marker removed, and its length; `None` where `bytes` holds none.
#[must_use]
pub fn vint_in(bytes: &[u8]) -> Option<(u64, usize)> {
    let first = *bytes.first()?;
    let length = usize::try_from(vint_length(first, MAX_VINT_LENGTH).ok()?).ok()?;
    let mask = u8::MAX
        .checked_shr(u32::try_from(length).ok()?)
        .unwrap_or(0);
    let mut value = u64::from(first & mask);
    for &byte in bytes.get(1..length)? {
        value = (value << 8) | u64::from(byte);
    }
    Some((value, length))
}

/// The unsigned integer an element of `size` bytes holds, read whole.
///
/// # Errors
///
/// [`CodecFailure::Malformed`] for more than eight bytes, or a file that
/// ends inside them.
pub fn read_unsigned<R: ReadBytes>(reader: &mut R, size: u64) -> Result<u64, CodecFailure> {
    if size > u64::from(MAX_VINT_LENGTH) {
        return Err(CodecFailure::Malformed);
    }
    let mut value = 0u64;
    for _ in 0..size {
        let byte = reader.read_byte().map_err(|error| failure_of_io(&error))?;
        value = (value << 8) | u64::from(byte);
    }
    Ok(value)
}

/// The signed integer an element of `size` bytes holds, read whole.
///
/// # Errors
///
/// As [`read_unsigned`].
pub fn read_signed<R: ReadBytes>(reader: &mut R, size: u64) -> Result<i64, CodecFailure> {
    let value = read_unsigned(reader, size)?;
    if size == 0 {
        return Ok(0);
    }
    // Sign-extended from the element's own width.
    let unused = 64 - 8 * u32::try_from(size).map_err(|_| CodecFailure::Malformed)?;
    #[allow(
        clippy::cast_possible_wrap,
        reason = "the bits are a two's complement number, sign-extended at once"
    )]
    let signed = (value << unused) as i64;
    Ok(signed >> unused)
}

/// Passes over `count` bytes.
///
/// # Errors
///
/// A read failure the host answers.
pub fn skip<R: ReadBytes>(reader: &mut R, count: u64) -> Result<(), CodecFailure> {
    reader
        .ignore_bytes(count)
        .map_err(|error| failure_of_io(&error))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};

    use super::{Header, read_header, read_signed, read_unsigned, vint_in};

    fn stream(bytes: &[u8]) -> MediaSourceStream<'static> {
        MediaSourceStream::new(
            Box::new(Cursor::new(bytes.to_vec())),
            MediaSourceStreamOptions::default(),
        )
    }

    #[test]
    fn reads_headers_of_known_and_unknown_size() {
        let mut reader = stream(&[0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x1f, 0x43, 0xb6, 0x75, 0xff]);
        assert_eq!(
            read_header(&mut reader),
            Ok(Header {
                id: 0x1a45_dfa3,
                size: Some(4),
                content: 5
            })
        );
        assert_eq!(
            read_header(&mut reader),
            Ok(Header {
                id: 0x1f43_b675,
                size: None,
                content: 10
            })
        );
    }

    #[test]
    fn reads_sizes_of_eight_bytes() {
        let mut reader = stream(&[0x1a, 0x45, 0xdf, 0xa3, 0x01, 0, 0, 0, 0, 0, 0x01, 0x02]);
        assert_eq!(
            read_header(&mut reader).map(|header| header.size),
            Ok(Some(0x0102))
        );
        assert_eq!(vint_in(&[0x01, 0, 0, 0, 0, 0, 0, 7]), Some((7, 8)));
        let mut unknown = stream(&[0xa3, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
        assert_eq!(
            read_header(&mut unknown).map(|header| header.size),
            Ok(None)
        );
    }

    #[test]
    fn reads_integers_of_any_width() {
        let mut reader = stream(&[0x01, 0x00, 0xff, 0xfe, 0x00, 0x00, 0x7f]);
        assert_eq!(read_unsigned(&mut reader, 2), Ok(256));
        assert_eq!(read_signed(&mut reader, 2), Ok(-2));
        assert_eq!(read_signed(&mut reader, 3), Ok(127));
        assert_eq!(vint_in(&[0x40, 0x02]), Some((2, 2)));
        assert_eq!(vint_in(&[0x40]), None);
        assert_eq!(vint_in(&[0x00]), None);
    }
}
