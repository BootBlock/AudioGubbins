//! What a file's first bytes say before Symphonia reads it: whether it is
//! ISO base media, whose trimming the session reads from its boxes, and
//! whether a Matroska file's document type is `webm`, which Symphonia reads
//! alike and does not tell apart.

use crate::byte_source::ByteSource;
use crate::failure::CodecFailure;

/// The bytes read.
const LEADING: usize = 256;

/// The box types an ISO base media file may begin with.
const MP4_FIRST_BOXES: [&[u8; 4]; 6] = [b"ftyp", b"moov", b"mdat", b"free", b"skip", b"wide"];

/// The EBML header's identifier, and its `DocType` element's.
const EBML_HEADER: [u8; 4] = [0x1a, 0x45, 0xdf, 0xa3];
const DOC_TYPE: u32 = 0x4282;

/// What the first bytes say.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Leading {
    /// ISO base media.
    Mp4,
    /// Matroska, and whether its document type is `webm`.
    Ebml {
        /// Whether the EBML header names the `webm` document type.
        webm: bool,
    },
    /// Anything else.
    Other,
}

/// An EBML variable-length integer at `at`: its value, with the length
/// marker removed where `strip` asks, and its length.
fn vint(bytes: &[u8], at: usize, strip: bool) -> Option<(u64, usize)> {
    let first = *bytes.get(at)?;
    let length = usize::try_from(first.leading_zeros()).ok()? + 1;
    if length > 8 {
        return None;
    }
    let mut value = u64::from(if strip {
        first & (0xff >> length)
    } else {
        first
    });
    for index in 1..length {
        value = (value << 8) | u64::from(*bytes.get(at + index)?);
    }
    Some((value, length))
}

/// Whether the EBML header in `bytes` names the `webm` document type.
fn names_webm(bytes: &[u8]) -> bool {
    let Some((size, length)) = vint(bytes, EBML_HEADER.len(), true) else {
        return false;
    };
    let start = EBML_HEADER.len() + length;
    let end = usize::try_from(size).map_or(bytes.len(), |size| (start + size).min(bytes.len()));
    let mut at = start;
    while at < end {
        let Some((id, id_length)) = vint(bytes, at, false) else {
            return false;
        };
        let Some((size, size_length)) = vint(bytes, at + id_length, true) else {
            return false;
        };
        let content = at + id_length + size_length;
        let Some(next) = usize::try_from(size)
            .ok()
            .and_then(|size| content.checked_add(size))
        else {
            return false;
        };
        if id == u64::from(DOC_TYPE) {
            return bytes
                .get(content..next)
                .is_some_and(|name| name.starts_with(b"webm"));
        }
        at = next;
    }
    false
}

/// What the first bytes of `source` say.
///
/// # Errors
///
/// [`CodecFailure`] where the file cannot be read.
pub fn leading<S: ByteSource>(source: &mut S) -> Result<Leading, CodecFailure> {
    let mut bytes = [0u8; LEADING];
    let wanted = usize::try_from(source.size()).map_or(LEADING, |size| size.min(LEADING));
    if source.read_at(0, &mut bytes[..wanted])? != wanted {
        return Err(CodecFailure::Changed);
    }
    let bytes = &bytes[..wanted];
    if bytes
        .get(4..8)
        .is_some_and(|kind| MP4_FIRST_BOXES.iter().any(|first| *first == kind))
    {
        return Ok(Leading::Mp4);
    }
    if bytes.starts_with(&EBML_HEADER) {
        return Ok(Leading::Ebml {
            webm: names_webm(bytes),
        });
    }
    Ok(Leading::Other)
}

#[cfg(test)]
mod tests {
    use super::{Leading, leading};
    use crate::byte_source::memory::MemorySource;

    fn ebml(doc_type: &[u8]) -> Vec<u8> {
        // EBMLVersion 1, then DocType.
        let mut header = vec![0x42, 0x86, 0x81, 0x01, 0x42, 0x82];
        header.push(0x80 | u8::try_from(doc_type.len()).unwrap_or(0));
        header.extend_from_slice(doc_type);
        let mut bytes = vec![
            0x1a,
            0x45,
            0xdf,
            0xa3,
            0x80 | u8::try_from(header.len()).unwrap_or(0),
        ];
        bytes.extend(header);
        bytes.extend_from_slice(&[0x18, 0x53, 0x80, 0x67]);
        bytes
    }

    #[test]
    fn tells_webm_from_matroska_and_finds_iso_base_media() {
        assert_eq!(
            leading(&mut MemorySource(ebml(b"webm"))),
            Ok(Leading::Ebml { webm: true })
        );
        assert_eq!(
            leading(&mut MemorySource(ebml(b"matroska"))),
            Ok(Leading::Ebml { webm: false })
        );
        let mut mp4 = vec![0, 0, 0, 16];
        mp4.extend_from_slice(b"ftypM4A \0\0\0\0");
        assert_eq!(leading(&mut MemorySource(mp4)), Ok(Leading::Mp4));
        assert_eq!(
            leading(&mut MemorySource(b"fLaC".to_vec())),
            Ok(Leading::Other)
        );
        assert_eq!(leading(&mut MemorySource(Vec::new())), Ok(Leading::Other));
    }
}
