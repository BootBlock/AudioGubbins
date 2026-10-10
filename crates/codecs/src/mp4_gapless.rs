//! The encoder's priming and the presented length an MP4 file states for its
//! audio, which Symphonia's MP4 reader reads but does not apply.
//!
//! An encoder states them in one of two places: the track's edit list, whose
//! one edit starts at the priming and lasts the presented length (what
//! most current encoders write), or iTunes' `iTunSMPB` tag,
//! whose fields are the priming, the padding and the presented length (what
//! older iTunes encoders write). The edit list wins where both say something.
//!
//! The boxes are read through the session's [`ByteSource`] before Symphonia
//! takes it, each bounded in number, depth and size: the file is untrusted.

use crate::byte_source::ByteSource;
use crate::failure::CodecFailure;

/// What an MP4 file states of one track's trimming, in the track's frames.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mp4Trim {
    /// The encoder's leading frames.
    pub priming: u64,
    /// The frames presented after them, where stated.
    pub length: Option<u64>,
}

/// What the boxes say of one audio track.
#[derive(Clone, Debug, Default)]
struct TrackBoxes {
    id: Option<u32>,
    audio: bool,
    media_timescale: Option<u32>,
    /// The first edit that presents media: its duration in the movie's
    /// timescale and its start in the media's, and whether it is the only one.
    edit: Option<(u64, i64)>,
    edits_presenting_media: usize,
}

/// What the walk found.
#[derive(Default)]
struct MovieBoxes {
    movie_timescale: Option<u32>,
    tracks: Vec<TrackBoxes>,
    smpb: Option<Mp4Trim>,
}

/// Boxes the walk visits before it gives up on a file.
const MAX_BOXES: usize = 4_096;
/// How deep the walk goes: `moov/udta/meta/ilst/----/data` is the deepest.
const MAX_DEPTH: usize = 7;
/// The largest box whose content the walk reads whole.
const MAX_READ: u64 = 64 * 1024;
/// Tracks the walk keeps.
const MAX_TRACKS: usize = 64;

/// The boxes whose children the walk visits.
const CONTAINERS: [&[u8; 4]; 7] = [
    b"moov", b"trak", b"mdia", b"edts", b"udta", b"ilst", b"----",
];

struct Walk<'s, S: ByteSource> {
    source: &'s mut S,
    visited: usize,
    movie: MovieBoxes,
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn u64_at(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(bytes.get(at..at + 8)?.try_into().ok()?))
}

impl<S: ByteSource> Walk<'_, S> {
    fn read(&mut self, offset: u64, length: u64) -> Result<Vec<u8>, CodecFailure> {
        let length = usize::try_from(length).map_err(|_| CodecFailure::Malformed)?;
        let mut bytes = vec![0u8; length];
        // Every box was checked to lie within the file, so a short answer
        // is the file changing.
        if self.source.read_at(offset, &mut bytes)? != length {
            return Err(CodecFailure::Changed);
        }
        Ok(bytes)
    }

    /// Visits the boxes from `start` to `end`, inside `parent`.
    fn boxes(
        &mut self,
        start: u64,
        end: u64,
        depth: usize,
        name: &str,
    ) -> Result<(), CodecFailure> {
        let mut at = start;
        let mut smpb_name = false;
        while at
            .checked_add(8)
            .is_some_and(|header_end| header_end <= end)
        {
            self.visited += 1;
            if self.visited > MAX_BOXES {
                return Ok(());
            }
            let header = self.read(at, 8)?;
            let mut size = u64::from(u32_at(&header, 0).ok_or(CodecFailure::Malformed)?);
            let kind: [u8; 4] = header[4..8]
                .try_into()
                .map_err(|_| CodecFailure::Malformed)?;
            let mut content = at + 8;
            if size == 1 {
                let large = self.read(at + 8, 8)?;
                size = u64_at(&large, 0).ok_or(CodecFailure::Malformed)?;
                content += 8;
            } else if size == 0 {
                size = end - at;
            }
            let box_end = at.checked_add(size).ok_or(CodecFailure::Malformed)?;
            if size < content - at || box_end > end {
                return Err(CodecFailure::Malformed);
            }
            self.visit(kind, content, box_end, depth, name, &mut smpb_name)?;
            at = box_end;
        }
        Ok(())
    }

    fn visit(
        &mut self,
        kind: [u8; 4],
        content: u64,
        end: u64,
        depth: usize,
        parent: &str,
        smpb_name: &mut bool,
    ) -> Result<(), CodecFailure> {
        let length = end - content;
        if CONTAINERS.contains(&&kind) && depth < MAX_DEPTH {
            if &kind == b"trak" {
                if self.movie.tracks.len() >= MAX_TRACKS {
                    return Ok(());
                }
                self.movie.tracks.push(TrackBoxes::default());
            }
            let name = std::str::from_utf8(&kind).unwrap_or("");
            return self.boxes(content, end, depth + 1, name);
        }
        // `meta` is a full box: four bytes of version and flags before its
        // children.
        if &kind == b"meta" && parent == "udta" && depth < MAX_DEPTH && length >= 4 {
            return self.boxes(content + 4, end, depth + 1, "meta");
        }
        if length > MAX_READ {
            return Ok(());
        }
        let wanted = matches!(
            (parent, &kind),
            ("moov", b"mvhd")
                | ("trak", b"tkhd")
                | ("mdia", b"mdhd" | b"hdlr")
                | ("edts", b"elst")
                | ("----", b"name" | b"data")
        );
        if !wanted {
            return Ok(());
        }
        let bytes = self.read(content, length)?;
        match (parent, &kind) {
            ("moov", b"mvhd") => self.movie.movie_timescale = timescale(&bytes),
            ("trak", b"tkhd") => {
                let version = bytes.first().copied();
                let id = if version == Some(1) {
                    u32_at(&bytes, 20)
                } else {
                    u32_at(&bytes, 12)
                };
                if let Some(track) = self.movie.tracks.last_mut() {
                    track.id = id;
                }
            }
            ("mdia", b"mdhd") => {
                if let Some(track) = self.movie.tracks.last_mut() {
                    track.media_timescale = timescale(&bytes);
                }
            }
            ("mdia", b"hdlr") => {
                if let Some(track) = self.movie.tracks.last_mut() {
                    track.audio = bytes.get(8..12) == Some(b"soun");
                }
            }
            ("edts", b"elst") => {
                if let Some(track) = self.movie.tracks.last_mut() {
                    read_edits(&bytes, track);
                }
            }
            ("----", b"name") => *smpb_name = bytes.get(4..) == Some(b"iTunSMPB"),
            ("----", b"data") if *smpb_name => self.movie.smpb = read_smpb(&bytes),
            _ => {}
        }
        Ok(())
    }
}

/// The timescale of an `mvhd` or `mdhd` box of either version.
fn timescale(bytes: &[u8]) -> Option<u32> {
    let at = if bytes.first() == Some(&1) { 20 } else { 12 };
    u32_at(bytes, at).filter(|&scale| scale > 0)
}

/// The edits of an `elst` box that present media.
fn read_edits(bytes: &[u8], track: &mut TrackBoxes) {
    let version = bytes.first().copied();
    let Some(count) = u32_at(bytes, 4) else {
        return;
    };
    let entry = if version == Some(1) { 20 } else { 12 };
    for index in 0..usize::try_from(count).unwrap_or(0) {
        let at = 8 + index * entry;
        let field = |from: usize, length: usize| bytes.get(at + from..at + from + length);
        let read = if version == Some(1) {
            u64_at(bytes, at)
                .zip(field(8, 8).and_then(|time| Some(i64::from_be_bytes(time.try_into().ok()?))))
        } else {
            u32_at(bytes, at).map(u64::from).zip(
                field(4, 4)
                    .and_then(|time| Some(i64::from(i32::from_be_bytes(time.try_into().ok()?)))),
            )
        };
        let Some((duration, media_time)) = read else {
            return;
        };
        // A media time of -1 is an empty edit: a pause, not media.
        if media_time >= 0 {
            track.edits_presenting_media += 1;
            track.edit.get_or_insert((duration, media_time));
        }
    }
}

/// The trimming `iTunSMPB` states: hexadecimal fields, of which the second
/// is the priming, the third the padding and the fourth the presented length.
fn read_smpb(bytes: &[u8]) -> Option<Mp4Trim> {
    // A `data` box: a type and a locale, then the text.
    let text = std::str::from_utf8(bytes.get(8..)?).ok()?;
    let mut fields = text.split_ascii_whitespace().skip(1);
    let priming = u64::from_str_radix(fields.next()?, 16).ok()?;
    let _padding = fields.next()?;
    let length = u64::from_str_radix(fields.next()?, 16).ok()?;
    Some(Mp4Trim {
        priming,
        length: (length > 0).then_some(length),
    })
}

/// `value` in `from` units, in `to` units, rounded to the nearest.
fn rescale(value: u64, from: u32, to: u32) -> Option<u64> {
    let scaled = (u128::from(value) * u128::from(to) + u128::from(from) / 2) / u128::from(from);
    u64::try_from(scaled).ok()
}

/// What an MP4 file's boxes state of its tracks' trimming.
pub struct Mp4Boxes(MovieBoxes);

/// Reads the boxes of the MP4 file `source` that state its trimming.
///
/// # Errors
///
/// [`CodecFailure`] where the file cannot be read, or its boxes overrun
/// their parents.
pub fn read_mp4_boxes<S: ByteSource>(source: &mut S) -> Result<Mp4Boxes, CodecFailure> {
    let size = source.size();
    let mut walk = Walk {
        source,
        visited: 0,
        movie: MovieBoxes::default(),
    };
    walk.boxes(0, size, 0, "")?;
    Ok(Mp4Boxes(walk.movie))
}

impl Mp4Boxes {
    /// What the file states of the trimming of the audio track `track_id`,
    /// whose rate is `rate`; `None` where it states nothing to apply.
    #[must_use]
    pub fn trim(&self, track_id: u32, rate: u32) -> Option<Mp4Trim> {
        let movie = &self.0;
        let audio: Vec<&TrackBoxes> = movie.tracks.iter().filter(|track| track.audio).collect();
        let track = audio
            .iter()
            .find(|track| track.id == Some(track_id))
            .or_else(|| audio.first().filter(|_| audio.len() == 1));
        let from_edit = track.and_then(|track| {
            // Several edits of media splice the stream, which is not trimming.
            if track.edits_presenting_media != 1 {
                return None;
            }
            let (duration, media_time) = track.edit?;
            let media_scale = track.media_timescale?;
            let priming = rescale(u64::try_from(media_time).ok()?, media_scale, rate)?;
            let length = rescale(duration, movie.movie_timescale?, rate)?;
            // An edit from the first frame trims nothing at the start, and
            // the stated length alone is the container's duration again.
            (priming > 0).then_some(Mp4Trim {
                priming,
                length: (length > 0).then_some(length),
            })
        });
        from_edit.or(movie.smpb)
    }
}

#[cfg(test)]
mod tests {
    use super::{Mp4Trim, read_mp4_boxes};
    use crate::byte_source::memory::MemorySource;
    use crate::failure::CodecFailure;

    fn mp4_box(kind: [u8; 4], content: &[u8]) -> Vec<u8> {
        let mut bytes = u32::try_from(content.len() + 8)
            .unwrap_or(0)
            .to_be_bytes()
            .to_vec();
        bytes.extend_from_slice(&kind);
        bytes.extend_from_slice(content);
        bytes
    }

    fn full(version: u8, rest: &[u8]) -> Vec<u8> {
        let mut bytes = vec![version, 0, 0, 0];
        bytes.extend_from_slice(rest);
        bytes
    }

    fn timescale_box(kind: [u8; 4], scale: u32) -> Vec<u8> {
        let mut rest = vec![0u8; 8];
        rest.extend_from_slice(&scale.to_be_bytes());
        rest.extend_from_slice(&[0u8; 4]);
        mp4_box(kind, &full(0, &rest))
    }

    fn audio_track(id: u32, edits: &[(u32, i32)]) -> Vec<u8> {
        let mut tkhd = vec![0u8; 8];
        tkhd.extend_from_slice(&id.to_be_bytes());
        let mut elst = u32::try_from(edits.len())
            .unwrap_or(0)
            .to_be_bytes()
            .to_vec();
        for &(duration, media_time) in edits {
            elst.extend_from_slice(&duration.to_be_bytes());
            elst.extend_from_slice(&media_time.to_be_bytes());
            elst.extend_from_slice(&[0, 1, 0, 0]);
        }
        let mut hdlr = vec![0u8; 4];
        hdlr.extend_from_slice(b"soun");
        let mdia = [
            timescale_box(*b"mdhd", 44_100),
            mp4_box(*b"hdlr", &full(0, &hdlr)),
        ]
        .concat();
        let trak = [
            mp4_box(*b"tkhd", &full(0, &tkhd)),
            mp4_box(*b"edts", &mp4_box(*b"elst", &full(0, &elst))),
            mp4_box(*b"mdia", &mdia),
        ]
        .concat();
        mp4_box(*b"trak", &trak)
    }

    fn file(moov: &[u8]) -> MemorySource {
        let mut bytes = mp4_box(*b"ftyp", b"M4A \0\0\0\0");
        bytes.extend(mp4_box(*b"mdat", &[0u8; 64]));
        bytes.extend(mp4_box(*b"moov", moov));
        MemorySource(bytes)
    }

    #[test]
    fn reads_the_priming_and_length_an_edit_list_states() {
        // A movie timescale of 1000: 1 s presented after 2112 frames of priming.
        let moov = [
            timescale_box(*b"mvhd", 1_000),
            audio_track(1, &[(1_000, 2_112)]),
        ]
        .concat();
        let trim = read_mp4_boxes(&mut file(&moov)).map(|boxes| boxes.trim(1, 44_100));
        assert_eq!(
            trim,
            Ok(Some(Mp4Trim {
                priming: 2_112,
                length: Some(44_100)
            }))
        );
    }

    #[test]
    fn reads_itunsmpb_where_the_edit_list_trims_nothing() {
        let mut name = vec![0u8; 4];
        name.extend_from_slice(b"iTunSMPB");
        let mut data = vec![0, 0, 0, 1, 0, 0, 0, 0];
        data.extend_from_slice(b" 00000000 00000840 000001CA 0000000000003E80 00000000");
        let tag = [mp4_box(*b"name", &name), mp4_box(*b"data", &data)].concat();
        let meta = full(0, &mp4_box(*b"ilst", &mp4_box(*b"----", &tag)));
        let moov = [
            timescale_box(*b"mvhd", 44_100),
            audio_track(1, &[(16_000, 0)]),
            mp4_box(*b"udta", &mp4_box(*b"meta", &meta)),
        ]
        .concat();
        let trim = read_mp4_boxes(&mut file(&moov)).map(|boxes| boxes.trim(1, 44_100));
        assert_eq!(
            trim,
            Ok(Some(Mp4Trim {
                priming: 0x840,
                length: Some(0x3e80)
            }))
        );
    }

    #[test]
    fn states_nothing_for_spliced_edits_and_refuses_overrunning_boxes() {
        let moov = [
            timescale_box(*b"mvhd", 1_000),
            audio_track(1, &[(500, 1_024), (500, 50_000)]),
        ]
        .concat();
        let trim = read_mp4_boxes(&mut file(&moov)).map(|boxes| boxes.trim(1, 44_100));
        assert_eq!(trim, Ok(None));
        let mut bytes = mp4_box(*b"moov", &[0u8; 16]);
        bytes[3] = 200;
        assert_eq!(
            read_mp4_boxes(&mut MemorySource(bytes)).err(),
            Some(CodecFailure::Malformed)
        );
    }
}
