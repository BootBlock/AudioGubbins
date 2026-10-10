//! The blocks of one track of a Matroska file, `WebM` among them, read by
//! the module itself.
//!
//! Symphonia's Matroska reader reads a block group's `DiscardPadding` and a
//! track's `CodecDelay` but applies neither to what it gives: the padding is
//! dropped, and the delay only shifts timestamps. So once Symphonia has read
//! the file's tracks, the session takes its stream back and reads the
//! track's blocks here, each frame of a block a packet carrying the block's
//! padding, and the track's codec delay is stated beside them (RFC 9559).
//!
//! `SeekPreRoll` is not read: it governs decoding resumed after a seek, and
//! a session decodes from the first block on.
//!
//! The file is untrusted, so every element read whole is bounded, an
//! element that overruns its parent is malformed, and only a cluster or the
//! segment may be of unknown size, as RFC 9559 allows.

use std::collections::VecDeque;
use std::io::{Seek, SeekFrom};

use symphonia::core::io::{MediaSourceStream, ReadBytes};
use symphonia::core::packet::Packet;
use symphonia::core::units::{Duration, Timestamp};

use crate::ebml::{
    Header, MAX_VINT_LENGTH, failure_of_io, read_header, read_signed, read_unsigned, read_vint,
    skip, vint_in,
};
use crate::failure::CodecFailure;
use crate::track_packets::{BlockTrim, Timing, TrackPacket};

const EBML: u32 = 0x1a45_dfa3;
const SEGMENT: u32 = 0x1853_8067;
const INFO: u32 = 0x1549_a966;
const TIMESTAMP_SCALE: u32 = 0x002a_d7b1;
const TRACKS: u32 = 0x1654_ae6b;
const TRACK_ENTRY: u32 = 0xae;
const TRACK_NUMBER: u32 = 0xd7;
const CODEC_DELAY: u32 = 0x56aa;
const DEFAULT_DURATION: u32 = 0x0023_e383;
const CLUSTER: u32 = 0x1f43_b675;
const SIMPLE_BLOCK: u32 = 0xa3;
const BLOCK_GROUP: u32 = 0xa0;
const BLOCK: u32 = 0xa1;
const BLOCK_DURATION: u32 = 0x9b;
const DISCARD_PADDING: u32 = 0x75a2;

/// The elements a cluster may hold, with the two EBML allows anywhere
/// (`Void` and `CRC-32`). Any other ends a cluster of unknown size.
const CLUSTER_CHILDREN: [u32; 9] = [
    0xe7,   // Timestamp
    0x5854, // SilentTracks
    0xa7,   // Position
    0xab,   // PrevSize
    SIMPLE_BLOCK,
    BLOCK_GROUP,
    0xaf, // EncryptedBlock
    0xec, // Void
    0xbf, // CRC-32
];

/// The segment's elements visited before the first cluster, and the
/// children of `Info` or `Tracks` visited, before a file is refused.
const MAX_ELEMENTS: usize = 4_096;

/// The largest block of the track read whole: far past any block of audio.
const MAX_BLOCK: u64 = 8 * 1024 * 1024;

/// Matroska's default timestamp scale: a tick is a millisecond.
const DEFAULT_TIMESTAMP_SCALE: u64 = 1_000_000;

/// What the file states of the track outside its blocks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MatroskaTrack {
    /// The track's `CodecDelay`, in nanoseconds, where the file states one.
    pub codec_delay: Option<u64>,
    /// Its `DefaultDuration`, in nanoseconds, where stated.
    default_duration: Option<u64>,
}

/// Where in the file the reader is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Level {
    /// Among the segment's children.
    Segment,
    /// Inside a cluster, which ends there, or of unknown size.
    Cluster { end: Option<u64> },
}

/// Reads one track's blocks, in file order.
pub struct MatroskaBlocks {
    stream: MediaSourceStream<'static>,
    /// The track's number in its blocks, and Symphonia's identifier of it.
    track: u64,
    track_id: u32,
    facts: MatroskaTrack,
    timestamp_scale: u64,
    segment_end: u64,
    level: Level,
    frames: VecDeque<TrackPacket>,
}

/// The integer element `header` holds, checked to be of integer width.
fn unsigned_of(
    stream: &mut MediaSourceStream<'static>,
    header: Header,
) -> Result<u64, CodecFailure> {
    read_unsigned(stream, header.size.ok_or(CodecFailure::Malformed)?)
}

impl MatroskaBlocks {
    /// The blocks of the track `track_id` of the Matroska file `stream`
    /// holds, of `size` bytes, read from its first cluster.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Malformed`] where the file is not one segment of
    /// well-formed elements stating the track, or a read failure.
    pub fn open(
        mut stream: MediaSourceStream<'static>,
        track_id: u32,
        size: u64,
    ) -> Result<Self, CodecFailure> {
        stream
            .seek(SeekFrom::Start(0))
            .map_err(|error| failure_of_io(&error))?;
        let ebml = read_header(&mut stream)?;
        if ebml.id != EBML {
            return Err(CodecFailure::Malformed);
        }
        skip(&mut stream, ebml.size.ok_or(CodecFailure::Malformed)?)?;
        let segment = read_header(&mut stream)?;
        if segment.id != SEGMENT {
            return Err(CodecFailure::Malformed);
        }
        let mut blocks = Self {
            stream,
            track: u64::from(track_id),
            track_id,
            facts: MatroskaTrack::default(),
            timestamp_scale: DEFAULT_TIMESTAMP_SCALE,
            segment_end: segment.end().map_or(size, |end| end.min(size)),
            level: Level::Segment,
            frames: VecDeque::new(),
        };
        blocks.read_head()?;
        Ok(blocks)
    }

    /// What the file states of the track outside its blocks.
    #[must_use]
    pub const fn track(&self) -> MatroskaTrack {
        self.facts
    }

    /// Reads the segment's `Info` and `Tracks`, then returns to its first
    /// cluster.
    fn read_head(&mut self) -> Result<(), CodecFailure> {
        let mut first_cluster = None;
        let mut found_track = false;
        for _ in 0..MAX_ELEMENTS {
            let at = self.stream.pos();
            if at >= self.segment_end {
                break;
            }
            let header = read_header(&mut self.stream)?;
            match header.id {
                INFO => self.read_info(header)?,
                TRACKS => found_track |= self.read_tracks(header)?,
                CLUSTER => {
                    first_cluster.get_or_insert(at);
                    if found_track {
                        break;
                    }
                    // `Tracks` may follow the clusters, where a seek head
                    // points to it.
                    self.pass_cluster(header)?;
                }
                _ => skip(
                    &mut self.stream,
                    header.size.ok_or(CodecFailure::Malformed)?,
                )?,
            }
        }
        if !found_track {
            return Err(CodecFailure::Malformed);
        }
        let start = first_cluster.unwrap_or(self.segment_end);
        self.stream
            .seek(SeekFrom::Start(start))
            .map_err(|error| failure_of_io(&error))?;
        Ok(())
    }

    /// The children of the master element `header`, each read by `visit`,
    /// which reads or passes over its content.
    fn children(
        &mut self,
        header: Header,
        mut visit: impl FnMut(&mut Self, Header) -> Result<(), CodecFailure>,
    ) -> Result<(), CodecFailure> {
        let end = header.end().ok_or(CodecFailure::Malformed)?;
        for _ in 0..MAX_ELEMENTS {
            if self.stream.pos() >= end {
                return Ok(());
            }
            let child = read_header(&mut self.stream)?;
            if child.end().is_none_or(|child_end| child_end > end) {
                return Err(CodecFailure::Malformed);
            }
            visit(self, child)?;
            // Whatever `visit` left of the child is passed over.
            let left = child
                .end()
                .map_or(0, |child_end| child_end.saturating_sub(self.stream.pos()));
            skip(&mut self.stream, left)?;
        }
        Err(CodecFailure::Malformed)
    }

    fn read_info(&mut self, header: Header) -> Result<(), CodecFailure> {
        self.children(header, |blocks, child| {
            if child.id == TIMESTAMP_SCALE {
                blocks.timestamp_scale = unsigned_of(&mut blocks.stream, child)?;
                if blocks.timestamp_scale == 0 {
                    return Err(CodecFailure::Malformed);
                }
            }
            Ok(())
        })
    }

    /// Reads `Tracks`, keeping what the entry of this track states, and
    /// answers whether it has one.
    fn read_tracks(&mut self, header: Header) -> Result<bool, CodecFailure> {
        let mut found = false;
        self.children(header, |blocks, entry| {
            if entry.id != TRACK_ENTRY {
                return Ok(());
            }
            let mut number = None;
            let mut facts = MatroskaTrack::default();
            blocks.children(entry, |blocks, child| {
                match child.id {
                    TRACK_NUMBER => number = Some(unsigned_of(&mut blocks.stream, child)?),
                    CODEC_DELAY => {
                        facts.codec_delay = Some(unsigned_of(&mut blocks.stream, child)?);
                    }
                    DEFAULT_DURATION => {
                        facts.default_duration = Some(unsigned_of(&mut blocks.stream, child)?);
                    }
                    _ => {}
                }
                Ok(())
            })?;
            if number == Some(blocks.track) {
                blocks.facts = facts;
                found = true;
            }
            Ok(())
        })?;
        Ok(found)
    }

    /// Passes over a cluster met before the segment's head was read.
    fn pass_cluster(&mut self, header: Header) -> Result<(), CodecFailure> {
        if let Some(size) = header.size {
            return skip(&mut self.stream, size);
        }
        loop {
            let at = self.stream.pos();
            if at >= self.segment_end {
                return Ok(());
            }
            let child = read_header(&mut self.stream)?;
            if !CLUSTER_CHILDREN.contains(&child.id) {
                return self
                    .stream
                    .seek(SeekFrom::Start(at))
                    .map(|_| ())
                    .map_err(|error| failure_of_io(&error));
            }
            skip(&mut self.stream, child.size.ok_or(CodecFailure::Malformed)?)?;
        }
    }

    /// The track's next packet, or `None` at the segment's end.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Malformed`] for an element that overruns its parent,
    /// a block of the track past [`MAX_BLOCK`] or of bad lacing, or a file
    /// that ends inside an element; or a read failure.
    pub fn next(&mut self) -> Result<Option<TrackPacket>, CodecFailure> {
        loop {
            if let Some(frame) = self.frames.pop_front() {
                return Ok(Some(frame));
            }
            let at = self.stream.pos();
            match self.level {
                Level::Segment => {
                    if at >= self.segment_end {
                        return Ok(None);
                    }
                    let header = read_header(&mut self.stream)?;
                    if header.id == CLUSTER {
                        let end = header.end();
                        if end.is_some_and(|end| end > self.segment_end) {
                            return Err(CodecFailure::Malformed);
                        }
                        self.level = Level::Cluster { end };
                    } else {
                        skip(
                            &mut self.stream,
                            header.size.ok_or(CodecFailure::Malformed)?,
                        )?;
                    }
                }
                Level::Cluster { end } => {
                    if at >= end.unwrap_or(self.segment_end) {
                        self.level = Level::Segment;
                        continue;
                    }
                    let header = read_header(&mut self.stream)?;
                    if end.is_none() && !CLUSTER_CHILDREN.contains(&header.id) {
                        // The element that ends a cluster of unknown size is
                        // the segment's, so it is read again there.
                        self.stream
                            .seek(SeekFrom::Start(at))
                            .map_err(|error| failure_of_io(&error))?;
                        self.level = Level::Segment;
                        continue;
                    }
                    let limit = end.unwrap_or(self.segment_end);
                    let size = header.size.ok_or(CodecFailure::Malformed)?;
                    if header.end().is_none_or(|child_end| child_end > limit) {
                        return Err(CodecFailure::Malformed);
                    }
                    match header.id {
                        SIMPLE_BLOCK => {
                            if let Some(laces) = self.read_block(size)? {
                                self.queue(laces, None, 0);
                            }
                        }
                        BLOCK_GROUP => self.read_group(header)?,
                        _ => skip(&mut self.stream, size)?,
                    }
                }
            }
        }
    }

    /// Reads a block of `size` bytes: its frames where it is the track's,
    /// else nothing, having passed over it.
    fn read_block(&mut self, size: u64) -> Result<Option<Vec<Box<[u8]>>>, CodecFailure> {
        let (track, length) = read_vint(&mut self.stream, MAX_VINT_LENGTH, true)?;
        let rest = size
            .checked_sub(u64::from(length))
            .ok_or(CodecFailure::Malformed)?;
        if track != self.track {
            skip(&mut self.stream, rest)?;
            return Ok(None);
        }
        // A relative timestamp and the flags come before the frames.
        if !(3..=MAX_BLOCK).contains(&rest) {
            return Err(CodecFailure::Malformed);
        }
        let mut bytes = vec![0u8; usize::try_from(rest).map_err(|_| CodecFailure::Malformed)?];
        self.stream
            .read_buf_exact(&mut bytes)
            .map_err(|error| failure_of_io(&error))?;
        let lacing = (bytes[2] >> 1) & 0b11;
        laces(&bytes[3..], lacing).map(Some)
    }

    /// Reads a block group: its block, if the track's, with the duration and
    /// padding the group states.
    fn read_group(&mut self, header: Header) -> Result<(), CodecFailure> {
        let mut laces = None;
        let mut other_track = false;
        let mut duration = None;
        let mut padding = 0;
        self.children(header, |blocks, child| {
            let size = child.size.ok_or(CodecFailure::Malformed)?;
            match child.id {
                BLOCK if laces.is_some() || other_track => return Err(CodecFailure::Malformed),
                BLOCK => match blocks.read_block(size)? {
                    Some(read) => laces = Some(read),
                    None => other_track = true,
                },
                BLOCK_DURATION => duration = Some(read_unsigned(&mut blocks.stream, size)?),
                DISCARD_PADDING => padding = read_signed(&mut blocks.stream, size)?,
                _ => {}
            }
            Ok(())
        })?;
        match laces {
            Some(laces) => {
                let duration = duration
                    .map(|ticks| {
                        ticks
                            .checked_mul(self.timestamp_scale)
                            .ok_or(CodecFailure::Malformed)
                    })
                    .transpose()?;
                self.queue(laces, duration, padding);
                Ok(())
            }
            None if other_track => Ok(()),
            // RFC 9559 makes the block mandatory in its group.
            None => Err(CodecFailure::Malformed),
        }
    }

    /// Queues a block's frames as packets: `duration` is the block's, in
    /// nanoseconds, where stated, and `padding` its `DiscardPadding`.
    fn queue(&mut self, laces: Vec<Box<[u8]>>, duration: Option<u64>, padding: i64) {
        let count = laces.len() as u64;
        let mut accumulated = 0u64;
        let last = laces.len() - 1;
        for (index, data) in laces.into_iter().enumerate() {
            // A block's duration is shared out so the frames' sum to it.
            let frame_duration = match duration {
                Some(total) => {
                    let done = u128::from(total) * (index as u128 + 1) / u128::from(count);
                    let done = u64::try_from(done).unwrap_or(total);
                    let share = done - accumulated;
                    accumulated = done;
                    Some(share)
                }
                None => self.facts.default_duration,
            };
            let trim = (padding != 0).then_some(BlockTrim {
                padding,
                opens: index == 0,
                closes: index == last,
            });
            // The decoders read only the bytes; the timing is the packet's
            // `timing`.
            let packet = Packet::new(self.track_id, Timestamp::new(0), Duration::new(0), data);
            self.frames.push_back(TrackPacket {
                packet,
                timing: Timing::Matroska {
                    duration: frame_duration,
                    trim,
                },
            });
        }
    }
}

/// The frames of a block's `payload`, laced as `lacing` says (RFC 9559,
/// section 10.4): none, Xiph's, fixed-size or EBML's.
fn laces(payload: &[u8], lacing: u8) -> Result<Vec<Box<[u8]>>, CodecFailure> {
    if lacing == 0 {
        return Ok(vec![payload.into()]);
    }
    let (&count_less_one, mut rest) = payload.split_first().ok_or(CodecFailure::Malformed)?;
    let count = usize::from(count_less_one) + 1;
    let mut sizes = Vec::with_capacity(count);
    match lacing {
        // Xiph: each size but the last as a run of 255s and a final byte.
        1 => {
            for _ in 1..count {
                let mut size = 0usize;
                loop {
                    let (&byte, after) = rest.split_first().ok_or(CodecFailure::Malformed)?;
                    rest = after;
                    size += usize::from(byte);
                    if byte != 255 {
                        break;
                    }
                }
                sizes.push(size);
            }
        }
        // Fixed: every frame the same size.
        2 => {
            if rest.len() % count != 0 {
                return Err(CodecFailure::Malformed);
            }
            sizes.resize(count - 1, rest.len() / count);
        }
        // EBML: the first size, then each the last's plus a signed difference.
        _ => {
            let mut size = 0i64;
            for index in 1..count {
                let (value, length) = vint_in(rest).ok_or(CodecFailure::Malformed)?;
                rest = &rest[length..];
                let value = i64::try_from(value).map_err(|_| CodecFailure::Malformed)?;
                size = if index == 1 {
                    value
                } else {
                    // A signed difference is stored offset by half its range.
                    let bias = (1i64 << (7 * length - 1)) - 1;
                    size.checked_add(value - bias)
                        .ok_or(CodecFailure::Malformed)?
                };
                sizes.push(usize::try_from(size).map_err(|_| CodecFailure::Malformed)?);
            }
        }
    }
    let mut frames = Vec::with_capacity(count);
    for size in sizes {
        let (frame, after) = rest.split_at_checked(size).ok_or(CodecFailure::Malformed)?;
        frames.push(frame.into());
        rest = after;
    }
    frames.push(rest.into());
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::laces;
    use crate::failure::CodecFailure;

    fn sizes(payload: &[u8], lacing: u8) -> Result<Vec<usize>, CodecFailure> {
        laces(payload, lacing).map(|frames| frames.iter().map(|frame| frame.len()).collect())
    }

    #[test]
    fn splits_every_lacing() {
        let mut xiph = vec![2, 255, 45, 3];
        xiph.extend(vec![0u8; 300 + 3 + 7]);
        assert_eq!(sizes(&xiph, 1), Ok(vec![300, 3, 7]));
        assert_eq!(sizes(&[2, 1, 2, 3, 4, 5, 6], 2), Ok(vec![2, 2, 2]));
        // EBML: 300 (a two-byte size), then -297 (a two-byte difference) for 3.
        let mut ebml = vec![2, 0x41, 0x2c, 0x5e, 0xd6];
        ebml.extend(vec![0u8; 300 + 3 + 4]);
        assert_eq!(sizes(&ebml, 3), Ok(vec![300, 3, 4]));
        assert_eq!(sizes(&[9, 9], 0), Ok(vec![2]));
    }

    #[test]
    fn refuses_laces_that_overrun_their_block() {
        assert_eq!(sizes(&[1, 200, 0, 0], 1), Err(CodecFailure::Malformed));
        assert_eq!(sizes(&[2, 1, 2, 3, 4], 2), Err(CodecFailure::Malformed));
        assert_eq!(sizes(&[], 1), Err(CodecFailure::Malformed));
    }
}
