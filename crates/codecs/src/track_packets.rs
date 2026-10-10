//! The packets of a session's track, in order, from whichever demultiplexer
//! reads its container: Symphonia's readers, or the module's own reader of
//! Matroska blocks, which carries the trimming Symphonia's does not.

use std::collections::VecDeque;

use symphonia::core::formats::FormatReader;
use symphonia::core::packet::Packet;

use crate::failure::CodecFailure;
use crate::matroska_blocks::MatroskaBlocks;
use crate::symphonia_track::failure_of;

/// Nanoseconds in a second, the unit of Matroska's timing.
const NANOSECONDS: u128 = 1_000_000_000;

/// `nanoseconds` in frames at `rate`, rounded to the nearest.
#[must_use]
pub fn frames_of(nanoseconds: u64, rate: u32) -> u64 {
    let frames = (u128::from(nanoseconds) * u128::from(rate) + NANOSECONDS / 2) / NANOSECONDS;
    u64::try_from(frames).unwrap_or(u64::MAX)
}

/// The trimming a Matroska block's `DiscardPadding` states, carried by each
/// packet of the block.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BlockTrim {
    /// The nanoseconds to discard: from the block's end where positive, from
    /// its start where negative.
    pub padding: i64,
    /// Whether the packet is the block's first.
    pub opens: bool,
    /// Whether it is the block's last.
    pub closes: bool,
}

/// What a container states of a packet's timing beyond its bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Timing {
    /// Symphonia's readers: the packet's own duration, in the track's
    /// frames, and nothing to trim.
    Frames,
    /// A frame of a Matroska block, in nanoseconds.
    Matroska {
        /// How long it lasts, where the file states it.
        duration: Option<u64>,
        /// The block's trimming, where it has any.
        trim: Option<BlockTrim>,
    },
}

/// One packet of the track, and its timing.
pub struct TrackPacket {
    /// The packet the decoder decodes.
    pub packet: Packet,
    /// What its container states of its timing.
    pub timing: Timing,
}

impl TrackPacket {
    /// The frames the packet lasts at `rate`, or 0 where its container does
    /// not say.
    #[must_use]
    pub fn frames(&self, rate: u32) -> u64 {
        match self.timing {
            Timing::Frames => self.packet.dur.get(),
            Timing::Matroska { duration, .. } => duration.map_or(0, |time| frames_of(time, rate)),
        }
    }
}

/// What reads the track's packets.
enum Demuxer {
    Symphonia {
        reader: Box<dyn FormatReader>,
        track_id: u32,
    },
    Matroska(MatroskaBlocks),
}

/// The packets of one track, in order, with those read ahead while the
/// track was recognised given first.
pub struct TrackPackets {
    demuxer: Demuxer,
    held: VecDeque<TrackPacket>,
}

impl TrackPackets {
    /// The packets of the track `track_id` as Symphonia's `reader` reads
    /// them.
    #[must_use]
    pub fn symphonia(reader: Box<dyn FormatReader>, track_id: u32) -> Self {
        Self {
            demuxer: Demuxer::Symphonia { reader, track_id },
            held: VecDeque::new(),
        }
    }

    /// The packets the module's own Matroska reader reads.
    #[must_use]
    pub fn matroska(blocks: MatroskaBlocks) -> Self {
        Self {
            demuxer: Demuxer::Matroska(blocks),
            held: VecDeque::new(),
        }
    }

    /// The demultiplexer's next packet of the track.
    fn read(&mut self) -> Result<Option<TrackPacket>, CodecFailure> {
        match &mut self.demuxer {
            Demuxer::Symphonia { reader, track_id } => loop {
                match reader.next_packet() {
                    Ok(Some(packet)) if packet.track_id == *track_id => {
                        return Ok(Some(TrackPacket {
                            packet,
                            timing: Timing::Frames,
                        }));
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => return Ok(None),
                    Err(error) => return Err(failure_of(&error)),
                }
            },
            Demuxer::Matroska(blocks) => blocks.next(),
        }
    }

    /// The next packet: one read ahead first, then the demultiplexer's.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Malformed`] or a read failure.
    pub fn next(&mut self) -> Result<Option<TrackPacket>, CodecFailure> {
        match self.held.pop_front() {
            Some(packet) => Ok(Some(packet)),
            None => self.read(),
        }
    }

    /// Reads the next packet ahead, holding it for [`next`](Self::next),
    /// and answers its bytes, or `None` at the end.
    ///
    /// # Errors
    ///
    /// As [`next`](Self::next).
    pub fn read_ahead(&mut self) -> Result<Option<&[u8]>, CodecFailure> {
        let Some(packet) = self.read()? else {
            return Ok(None);
        };
        self.held.push_back(packet);
        Ok(self.held.back().map(|held| &*held.packet.data))
    }
}

#[cfg(test)]
mod tests {
    use super::frames_of;

    #[test]
    fn converts_nanoseconds_to_the_nearest_frame() {
        // Opus's usual pre-skip of 312 frames is 6.5 ms at 48 kHz.
        assert_eq!(frames_of(6_500_000, 48_000), 312);
        assert_eq!(frames_of(22_675, 44_100), 1);
        assert_eq!(frames_of(11_337, 44_100), 0);
    }
}
