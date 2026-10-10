//! The Opus identification header, `OpusHead` (RFC 7845, section 5.1),
//! read from an Ogg stream's first packet or a Matroska track's private data,
//! and written for an encoder's stream.

use crate::failure::CodecFailure;
use crate::vorbis_order::vorbis_layout;

/// The header's signature.
const MAGIC: &[u8; 8] = b"OpusHead";

/// The length of a header of mapping family 0, which has no mapping table.
const FAMILY_ZERO_LENGTH: usize = 19;

/// The mapping families the module decodes and encodes: 0, one stream of one
/// or two channels, and 1, the Vorbis order of one to eight channels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MappingFamily {
    /// RTP mapping: mono or stereo in one stream.
    Single,
    /// The Vorbis channel order, in several streams.
    Vorbis,
}

impl MappingFamily {
    /// The family's number in the header.
    #[must_use]
    pub const fn number(self) -> u8 {
        match self {
            Self::Single => 0,
            Self::Vorbis => 1,
        }
    }
}

/// What an Opus stream's identification header states.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpusHead {
    /// The output channels.
    pub channel_count: u8,
    /// Frames at 48 kHz to discard from the decoded start.
    pub pre_skip: u16,
    /// The rate of the audio before it was encoded, for information only.
    pub input_sample_rate: u32,
    /// The gain to apply to the decoded output, in Q7.8 decibels.
    pub output_gain: i16,
    /// How the channels are coded.
    pub family: MappingFamily,
    /// The Opus streams in each packet.
    pub stream_count: u8,
    /// How many of those streams are coupled stereo pairs.
    pub coupled_count: u8,
    /// For each output channel, the decoded stream channel it takes, or 255
    /// for silence.
    pub mapping: Vec<u8>,
}

/// The byte order of a header's fields: little-endian in Ogg and Matroska,
/// big-endian in MP4's `dOps` box, which Symphonia gives after the signature.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldOrder {
    /// RFC 7845's own header.
    Little,
    /// The `dOps` box of Opus in ISO base media.
    Big,
}

impl FieldOrder {
    fn two(self, bytes: [u8; 2]) -> u16 {
        match self {
            Self::Little => u16::from_le_bytes(bytes),
            Self::Big => u16::from_be_bytes(bytes),
        }
    }

    fn two_signed(self, bytes: [u8; 2]) -> i16 {
        match self {
            Self::Little => i16::from_le_bytes(bytes),
            Self::Big => i16::from_be_bytes(bytes),
        }
    }

    fn four(self, bytes: [u8; 4]) -> u32 {
        match self {
            Self::Little => u32::from_le_bytes(bytes),
            Self::Big => u32::from_be_bytes(bytes),
        }
    }
}

impl OpusHead {
    /// The header in `bytes`, its fields in `order`.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Malformed`] where the header breaks RFC 7845, and
    /// [`CodecFailure::Unsupported`] for a mapping family other than 0 and 1
    /// or an encapsulation version of another major number.
    pub fn read(bytes: &[u8], order: FieldOrder) -> Result<Self, CodecFailure> {
        if bytes.len() < FAMILY_ZERO_LENGTH || &bytes[..8] != MAGIC {
            return Err(CodecFailure::Malformed);
        }
        // Versions 0 to 15 share the layout; a later major version may not.
        if bytes[8] > 15 {
            return Err(CodecFailure::Unsupported);
        }
        let channel_count = bytes[9];
        let pre_skip = order.two([bytes[10], bytes[11]]);
        let input_sample_rate = order.four([bytes[12], bytes[13], bytes[14], bytes[15]]);
        let output_gain = order.two_signed([bytes[16], bytes[17]]);
        let head = match bytes[18] {
            0 => {
                if !(1..=2).contains(&channel_count) {
                    return Err(CodecFailure::Malformed);
                }
                Self {
                    channel_count,
                    pre_skip,
                    input_sample_rate,
                    output_gain,
                    family: MappingFamily::Single,
                    stream_count: 1,
                    coupled_count: channel_count - 1,
                    mapping: (0..channel_count).collect(),
                }
            }
            1 => {
                let table = bytes
                    .get(FAMILY_ZERO_LENGTH..)
                    .ok_or(CodecFailure::Malformed)?;
                let (&stream_count, rest) = table.split_first().ok_or(CodecFailure::Malformed)?;
                let (&coupled_count, rest) = rest.split_first().ok_or(CodecFailure::Malformed)?;
                let mapping = rest
                    .get(..usize::from(channel_count))
                    .ok_or(CodecFailure::Malformed)?
                    .to_vec();
                let coded = u16::from(stream_count) + u16::from(coupled_count);
                let valid = vorbis_layout(usize::from(channel_count)).is_some()
                    && stream_count > 0
                    && coupled_count <= stream_count
                    && coded <= 255
                    && mapping
                        .iter()
                        .all(|&index| index == 255 || u16::from(index) < coded);
                if !valid {
                    return Err(CodecFailure::Malformed);
                }
                Self {
                    channel_count,
                    pre_skip,
                    input_sample_rate,
                    output_gain,
                    family: MappingFamily::Vorbis,
                    stream_count,
                    coupled_count,
                    mapping,
                }
            }
            _ => return Err(CodecFailure::Unsupported),
        };
        Ok(head)
    }

    /// The header's bytes, encapsulation version 1.
    #[must_use]
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(FAMILY_ZERO_LENGTH + 2 + self.mapping.len());
        bytes.extend_from_slice(MAGIC);
        bytes.push(1);
        bytes.push(self.channel_count);
        bytes.extend_from_slice(&self.pre_skip.to_le_bytes());
        bytes.extend_from_slice(&self.input_sample_rate.to_le_bytes());
        bytes.extend_from_slice(&self.output_gain.to_le_bytes());
        bytes.push(self.family.number());
        if self.family == MappingFamily::Vorbis {
            bytes.push(self.stream_count);
            bytes.push(self.coupled_count);
            bytes.extend_from_slice(&self.mapping);
        }
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::{FieldOrder, MappingFamily, OpusHead};
    use crate::failure::CodecFailure;

    fn surround() -> OpusHead {
        OpusHead {
            channel_count: 6,
            pre_skip: 312,
            input_sample_rate: 44_100,
            output_gain: -256,
            family: MappingFamily::Vorbis,
            stream_count: 4,
            coupled_count: 2,
            mapping: vec![0, 4, 1, 2, 3, 5],
        }
    }

    #[test]
    fn reads_what_it_writes() {
        let head = surround();
        assert_eq!(
            OpusHead::read(&head.to_bytes(), FieldOrder::Little),
            Ok(head)
        );
        let stereo = OpusHead {
            channel_count: 2,
            pre_skip: 3840,
            input_sample_rate: 48_000,
            output_gain: 0,
            family: MappingFamily::Single,
            stream_count: 1,
            coupled_count: 1,
            mapping: vec![0, 1],
        };
        assert_eq!(stereo.to_bytes().len(), 19);
        assert_eq!(
            OpusHead::read(&stereo.to_bytes(), FieldOrder::Little),
            Ok(stereo.clone())
        );
        let mut big = stereo.to_bytes();
        big[10..12].copy_from_slice(&3840u16.to_be_bytes());
        big[12..16].copy_from_slice(&48_000u32.to_be_bytes());
        big[16..18].copy_from_slice(&(-256i16).to_be_bytes());
        let quieter = OpusHead {
            output_gain: -256,
            ..stereo
        };
        assert_eq!(OpusHead::read(&big, FieldOrder::Big), Ok(quieter));
    }

    #[test]
    fn refuses_what_rfc_7845_forbids() {
        let mut bytes = surround().to_bytes();
        bytes[21] = 11; // A mapping index past the coded channels.
        assert_eq!(
            OpusHead::read(&bytes, FieldOrder::Little),
            Err(CodecFailure::Malformed)
        );
        let mut family = surround().to_bytes();
        family[18] = 2;
        assert_eq!(
            OpusHead::read(&family, FieldOrder::Little),
            Err(CodecFailure::Unsupported)
        );
        assert_eq!(
            OpusHead::read(&surround().to_bytes()[..22], FieldOrder::Little),
            Err(CodecFailure::Malformed)
        );
        assert_eq!(
            OpusHead::read(b"OpusHea", FieldOrder::Little),
            Err(CodecFailure::Malformed)
        );
    }
}
