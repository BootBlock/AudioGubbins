//! The codec module's own FLAC frame encoder (RFC 9639), for the depths
//! `flacenc` does not encode: 32 bits a sample, which `libFLAC` 1.4 and
//! later write, and every depth from 4 to 31 other than 8, 12, 16, 20 and 24
//! (ADR-0091, amended).
//!
//! Each frame is of a fixed block size and carries its number: a header with
//! its CRC-8, a subframe per channel, and the frame's CRC-16. Stereo is
//! decorrelated (left/side, side/right or mid/side, whichever is smallest)
//! only below 32 bits: the side channel takes one bit more than the
//! samples, and a side channel of 33 bits is one many decoders, Symphonia
//! among them, cannot read, so at 32 bits every channel is coded
//! independently.

mod bits;
mod lpc;
mod residual;
mod subframe;

use bits::{BitWriter, crc8, crc16};
use subframe::{Search, SubframeCoder, SubframePlan};

use crate::failure::CodecFailure;

/// The widest side channel a decoder reads: one bit more than the samples.
const MAX_SIDE_BITS: u32 = 32;

/// Where a stereo pair's mid and side signals follow its two channels.
const MID: usize = 2;
const SIDE: usize = 3;

/// The signals of independent channels, in order.
const CHANNELS: [usize; 8] = [0, 1, 2, 3, 4, 5, 6, 7];

/// What a compression level searches, after `libFLAC`'s levels 0 to 8:
/// the highest linear prediction order, the finest partition order and
/// whether stereo is decorrelated. From level 6, where `libFLAC` tries
/// several windows, every prediction order is tried instead.
const fn search_of(level: u8) -> (Search, bool) {
    let (lpc_limit, partition_limit, stereo) = match level {
        0 => (0, 3, false),
        1 | 2 => (0, 3, true),
        3 => (6, 4, false),
        4 => (8, 4, true),
        5 => (8, 5, true),
        6 => (8, 6, true),
        _ => (12, 6, true),
    };
    (
        Search {
            lpc_limit,
            every_lpc: level >= 6,
            partition_limit,
        },
        stereo,
    )
}

/// The frame header's code for a block of `frames`, and the bits that
/// follow the frame number to state it where the code does not.
const fn block_code(frames: usize) -> (u64, Option<(u64, u32)>) {
    let code = match frames {
        192 => 1,
        576 => 2,
        1_152 => 3,
        2_304 => 4,
        4_608 => 5,
        256 => 8,
        512 => 9,
        1_024 => 10,
        2_048 => 11,
        4_096 => 12,
        8_192 => 13,
        16_384 => 14,
        32_768 => 15,
        _ => 0,
    };
    if code != 0 {
        return (code, None);
    }
    let stated = frames as u64 - 1;
    if frames <= 256 {
        (6, Some((stated, 8)))
    } else {
        (7, Some((stated, 16)))
    }
}

/// The frame header's code for `rate`, and the bits that state it where the
/// code does not; `None` for a rate no frame header names.
const fn rate_code(rate: u32) -> Option<(u64, Option<(u64, u32)>)> {
    let code = match rate {
        88_200 => 1,
        176_400 => 2,
        192_000 => 3,
        8_000 => 4,
        16_000 => 5,
        22_050 => 6,
        24_000 => 7,
        32_000 => 8,
        44_100 => 9,
        48_000 => 10,
        96_000 => 11,
        _ => 0,
    };
    if code != 0 {
        return Some((code, None));
    }
    let rate = rate as u64;
    if rate % 1_000 == 0 && rate <= 255_000 {
        Some((12, Some((rate / 1_000, 8))))
    } else if rate <= 65_535 {
        Some((13, Some((rate, 16))))
    } else if rate % 10 == 0 && rate <= 655_350 {
        Some((14, Some((rate / 10, 16))))
    } else {
        None
    }
}

/// The frame header's code for samples of `bits` bits; 0 for a depth it
/// names only through STREAMINFO.
const fn depth_code(bits: u32) -> u64 {
    match bits {
        8 => 1,
        12 => 2,
        16 => 4,
        20 => 5,
        24 => 6,
        32 => 7,
        _ => 0,
    }
}

/// Writes a frame number as FLAC codes it, in the form of UTF-8 extended to
/// 31 bits.
fn put_number(number: u32, writer: &mut BitWriter) {
    let value = u64::from(number);
    let continuation_bytes = match number {
        0..=0x7f => {
            writer.put(value, 8);
            return;
        }
        0x80..=0x7ff => 1,
        0x800..=0xffff => 2,
        0x1_0000..=0x1f_ffff => 3,
        0x20_0000..=0x3ff_ffff => 4,
        _ => 5,
    };
    let lead_bits = 6 - continuation_bytes;
    let marker = (0xff00u64 >> (continuation_bytes + 1)) & 0xff;
    writer.put(marker | (value >> (6 * continuation_bytes)), 8);
    for index in (0..continuation_bytes).rev() {
        writer.put(0x80 | ((value >> (6 * index)) & 0x3f), 8);
    }
    debug_assert!(value >> (6 * continuation_bytes) < 1 << lead_bits);
}

/// How the channels of a frame are coded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Assignment {
    Independent,
    LeftSide,
    SideRight,
    MidSide,
}

/// Encodes one stream's frames.
pub struct NativeFrames {
    channels: usize,
    bits: u32,
    rate: (u64, Option<(u64, u32)>),
    search: Search,
    stereo: bool,
    coder: SubframeCoder,
    /// One signal per channel, then the mid and side of a stereo pair.
    signals: Vec<Vec<i64>>,
    plans: Vec<SubframePlan>,
    writer: BitWriter,
}

impl NativeFrames {
    /// An encoder of `channels` channels of `bits` bits at `rate`, searching
    /// as compression `level` does.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] for a rate no frame header names.
    pub fn new(channels: u8, bits: u8, rate: u32, level: u8) -> Result<Self, CodecFailure> {
        let rate = rate_code(rate).ok_or(CodecFailure::Refused)?;
        let (search, stereo) = search_of(level);
        let channels = usize::from(channels);
        let bits = u32::from(bits);
        Ok(Self {
            channels,
            bits,
            rate,
            search,
            stereo: stereo && channels == 2 && bits < MAX_SIDE_BITS,
            coder: SubframeCoder::default(),
            signals: vec![Vec::new(); channels + 2],
            plans: Vec::with_capacity(channels + 2),
            writer: BitWriter::default(),
        })
    }

    /// The bytes of the frame last encoded.
    #[must_use]
    pub fn last_frame(&self) -> &[u8] {
        self.writer.bytes()
    }

    /// Encodes the frame numbered `number` from the first `frames` samples
    /// of each plane, answering its bytes. The caller has checked the planes
    /// and the count.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] for a sample outside the stream's bits.
    pub fn encode<P: AsRef<[i32]>>(
        &mut self,
        planes: &[P],
        frames: usize,
        number: u32,
    ) -> Result<&[u8], CodecFailure> {
        let low = -(1i64 << (self.bits - 1));
        let high = (1i64 << (self.bits - 1)) - 1;
        for (signal, plane) in self.signals.iter_mut().zip(planes) {
            signal.clear();
            signal.extend(
                plane.as_ref()[..frames]
                    .iter()
                    .map(|&sample| i64::from(sample)),
            );
            if signal.iter().any(|sample| !(low..=high).contains(sample)) {
                return Err(CodecFailure::Refused);
            }
        }
        let assignment = self.plan(frames);
        self.write_header(frames, number, assignment);
        let (first, second) = match assignment {
            Assignment::Independent => (0, 1),
            Assignment::LeftSide => (0, SIDE),
            Assignment::SideRight => (SIDE, 1),
            Assignment::MidSide => (MID, SIDE),
        };
        let pair = [first, second];
        let coded = if assignment == Assignment::Independent {
            &CHANNELS[..self.channels]
        } else {
            &pair[..]
        };
        for &index in coded {
            // The side channel takes one bit more; with no decorrelation,
            // signal 3 is the fourth channel.
            let side = assignment != Assignment::Independent && index == SIDE;
            let bits = if side { self.bits + 1 } else { self.bits };
            self.coder.write(
                &self.plans[index],
                &self.signals[index],
                bits,
                &mut self.writer,
            );
        }
        self.writer.align();
        let crc = crc16(self.writer.bytes());
        self.writer.put(u64::from(crc), 16);
        Ok(self.writer.bytes())
    }

    /// Plans every channel's subframe, and the stereo pair's mid and side
    /// where stereo is decorrelated, answering the smallest assignment.
    fn plan(&mut self, frames: usize) -> Assignment {
        self.plans.clear();
        for signal in &self.signals[..self.channels] {
            let plan = self.coder.plan(signal, self.bits, self.search);
            self.plans.push(plan);
        }
        if !self.stereo {
            return Assignment::Independent;
        }
        let (left_right, mid_side) = self.signals.split_at_mut(2);
        let (mid, side) = mid_side.split_at_mut(1);
        let (mid, side) = (&mut mid[0], &mut side[0]);
        mid.clear();
        side.clear();
        for (&left, &right) in left_right[0][..frames].iter().zip(&left_right[1][..frames]) {
            mid.push((left + right) >> 1);
            side.push(left - right);
        }
        let mid_plan = self.coder.plan(mid, self.bits, self.search);
        let side_plan = self.coder.plan(side, self.bits + 1, self.search);
        self.plans.push(mid_plan);
        self.plans.push(side_plan);
        let bits_of =
            |first: usize, second: usize| self.plans[first].bits + self.plans[second].bits;
        let mut best = (Assignment::Independent, bits_of(0, 1));
        for candidate in [
            (Assignment::LeftSide, bits_of(0, SIDE)),
            (Assignment::SideRight, bits_of(SIDE, 1)),
            (Assignment::MidSide, bits_of(MID, SIDE)),
        ] {
            if candidate.1 < best.1 {
                best = candidate;
            }
        }
        best.0
    }

    fn write_header(&mut self, frames: usize, number: u32, assignment: Assignment) {
        let writer = &mut self.writer;
        writer.clear();
        // The sync code, a reserved zero, and the fixed block size strategy.
        writer.put(0b1111_1111_1111_1000, 16);
        let (block, block_bits) = block_code(frames);
        let (rate, rate_bits) = self.rate;
        writer.put(block, 4);
        writer.put(rate, 4);
        let channels = match assignment {
            Assignment::Independent => self.channels as u64 - 1,
            Assignment::LeftSide => 0b1000,
            Assignment::SideRight => 0b1001,
            Assignment::MidSide => 0b1010,
        };
        writer.put(channels, 4);
        writer.put(depth_code(self.bits), 3);
        writer.put(0, 1);
        put_number(number, writer);
        for (value, width) in [block_bits, rate_bits].into_iter().flatten() {
            writer.put(value, width);
        }
        let crc = crc8(writer.bytes());
        writer.put(u64::from(crc), 8);
    }
}

#[cfg(test)]
mod tests {
    use super::{BitWriter, block_code, put_number, rate_code};

    #[test]
    fn codes_frame_numbers_as_extended_utf8() {
        for (number, expected) in [
            (0x7f, vec![0x7f]),
            (0x80, vec![0xc2, 0x80]),
            (0xffff, vec![0xef, 0xbf, 0xbf]),
            (0x7fff_ffff, vec![0xfd, 0xbf, 0xbf, 0xbf, 0xbf, 0xbf]),
        ] {
            let mut writer = BitWriter::default();
            put_number(number, &mut writer);
            assert_eq!(writer.bytes(), expected.as_slice(), "{number:#x}");
        }
    }

    #[test]
    fn names_block_sizes_and_rates_as_the_header_codes_them() {
        assert_eq!(block_code(4_096), (12, None));
        assert_eq!(block_code(100), (6, Some((99, 8))));
        assert_eq!(block_code(1_000), (7, Some((999, 16))));
        assert_eq!(rate_code(44_100), Some((9, None)));
        assert_eq!(rate_code(64_000), Some((12, Some((64, 8)))));
        assert_eq!(rate_code(11_025), Some((13, Some((11_025, 16)))));
        assert_eq!(rate_code(352_800), Some((14, Some((35_280, 16)))));
        assert_eq!(rate_code(700_001), None);
    }
}
