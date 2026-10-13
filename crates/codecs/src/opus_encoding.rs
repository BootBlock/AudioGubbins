//! Opus packets encoded by the fixed-point port of the reference encoder
//! (ADR-0091), with what the application's Ogg writer needs around them: the
//! identification header and each packet's duration at 48 kHz, from which it
//! writes granule positions, and the stream's end granule, which trims the
//! padding of the last packet (RFC 7845, section 4).
//!
//! Samples arrive as `f32` and are rounded to 16 bits, the fixed-point
//! encoder's input, by rounding to the nearest even: an integer rule, so the
//! same samples give the same packets on every machine (REQ-ARCH-049).

use std::collections::VecDeque;

use ropus::{
    OPUS_APPLICATION_AUDIO, OPUS_APPLICATION_RESTRICTED_LOWDELAY, OPUS_APPLICATION_VOIP,
    OpusMSEncoder,
};

use crate::failure::CodecFailure;
use crate::opus_decoding::OPUS_RATE;
use crate::opus_head::{MappingFamily, OpusHead};
use crate::vorbis_order::vorbis_layout;

/// What the encoder is tuned for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpusApplication {
    /// Music and general audio, where fidelity matters most.
    Audio,
    /// Speech, where intelligibility matters most.
    Voip,
    /// The least delay the codec allows, with CELT alone.
    RestrictedLowDelay,
}

/// How long each packet's audio lasts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpusFrameDuration {
    /// 2.5 ms.
    Ms2_5,
    /// 5 ms.
    Ms5,
    /// 10 ms.
    Ms10,
    /// 20 ms, the usual.
    Ms20,
    /// 40 ms.
    Ms40,
    /// 60 ms.
    Ms60,
    /// 80 ms.
    Ms80,
    /// 100 ms.
    Ms100,
    /// 120 ms.
    Ms120,
}

impl OpusFrameDuration {
    /// The frames of a packet at `rate`: an exact number at every Opus rate.
    const fn frames_at(self, rate: u32) -> u32 {
        let tenths_of_a_millisecond = match self {
            Self::Ms2_5 => 25,
            Self::Ms5 => 50,
            Self::Ms10 => 100,
            Self::Ms20 => 200,
            Self::Ms40 => 400,
            Self::Ms60 => 600,
            Self::Ms80 => 800,
            Self::Ms100 => 1_000,
            Self::Ms120 => 1_200,
        };
        rate * tenths_of_a_millisecond / 10_000
    }
}

/// How the bit rate is held.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpusRateControl {
    /// Unconstrained variable bit rate, the best quality for the size.
    Variable,
    /// Variable within one frame's buffer of the target.
    ConstrainedVariable,
    /// Every packet the same size.
    Constant,
}

/// What an Opus stream is encoded with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OpusSettings {
    /// The rate of the samples given: 8, 12, 16, 24 or 48 kHz.
    pub sample_rate: u32,
    /// Channels, one to eight. One and two are coded as one stream (mapping
    /// family 0); three to eight as the Vorbis layouts (mapping family 1),
    /// given in speaker-mask order.
    pub channels: u8,
    /// The target bit rate of the whole stream, in bits a second: 500 to
    /// 300 000 for each channel.
    pub bit_rate: u32,
    /// What the encoder is tuned for.
    pub application: OpusApplication,
    /// How long each packet's audio lasts.
    pub frame_duration: OpusFrameDuration,
    /// How hard the encoder searches, 0 to 10.
    pub complexity: u8,
    /// How the bit rate is held.
    pub rate_control: OpusRateControl,
    /// The rate the audio had before it was brought to `sample_rate`, which
    /// the header records for information; 0 for none.
    pub input_sample_rate: u32,
}

/// The rates the encoder takes.
const RATES: [u32; 5] = [8_000, 12_000, 16_000, 24_000, 48_000];

/// The largest packet each stream may add, as the reference recommends.
const MAX_PACKET_BYTES_PER_STREAM: usize = 4_000;

/// The bit rates each channel may be given.
const BIT_RATE_PER_CHANNEL: std::ops::RangeInclusive<u32> = 500..=300_000;

/// One encoded packet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpusPacket {
    /// The packet's bytes.
    pub bytes: Vec<u8>,
    /// The frames it decodes to at 48 kHz, by which a granule position
    /// advances.
    pub frames: u32,
}

/// Encodes one Opus stream.
pub struct OpusEncoder {
    encoder: OpusMSEncoder,
    head: OpusHead,
    channels: usize,
    /// For each Vorbis-order channel the encoder takes, the plane it is.
    vorbis_source: Vec<usize>,
    /// Frames of each packet at the encoder's rate.
    frame_size: usize,
    /// How many frames at 48 kHz one frame at the encoder's rate is.
    upsampling: u32,
    /// The encoder's lookahead at its own rate.
    lookahead: usize,
    /// Samples waiting for a whole packet, interleaved in Vorbis order.
    pending: Vec<i16>,
    pushed: u64,
    finished: bool,
    ready: VecDeque<OpusPacket>,
    scratch: Vec<u8>,
}

/// A sample in [-1, 1] as the 16 bits the encoder takes: scaled, rounded to
/// the nearest even and held to the range, with no sample at all as silence.
#[allow(
    clippy::cast_possible_truncation,
    reason = "held to the range and rounded first"
)]
fn to_i16(sample: f32) -> i16 {
    let scaled = (sample * 32_768.0).round_ties_even();
    if scaled.is_nan() {
        0
    } else {
        scaled.clamp(-32_768.0, 32_767.0) as i16
    }
}

fn status(code: i32) -> Result<(), CodecFailure> {
    if code == 0 {
        Ok(())
    } else {
        Err(CodecFailure::Refused)
    }
}

impl OpusEncoder {
    /// An encoder for a stream of these settings.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] for settings outside what Opus encodes.
    pub fn new(settings: OpusSettings) -> Result<Self, CodecFailure> {
        let channels = usize::from(settings.channels);
        let layout = vorbis_layout(channels).ok_or(CodecFailure::Refused)?;
        let per_channel = settings.bit_rate / u32::from(settings.channels.max(1));
        let usable = RATES.contains(&settings.sample_rate)
            && settings.complexity <= 10
            && BIT_RATE_PER_CHANNEL.contains(&per_channel);
        if !usable {
            return Err(CodecFailure::Refused);
        }
        let family = if channels <= 2 {
            MappingFamily::Single
        } else {
            MappingFamily::Vorbis
        };
        let application = match settings.application {
            OpusApplication::Audio => OPUS_APPLICATION_AUDIO,
            OpusApplication::Voip => OPUS_APPLICATION_VOIP,
            OpusApplication::RestrictedLowDelay => OPUS_APPLICATION_RESTRICTED_LOWDELAY,
        };
        let rate = i32::try_from(settings.sample_rate).map_err(|_| CodecFailure::Refused)?;
        let (mut encoder, streams, coupled, mapping) = OpusMSEncoder::new_surround(
            rate,
            i32::from(settings.channels),
            i32::from(family.number()),
            application,
        )
        .map_err(|_| CodecFailure::Refused)?;
        status(
            encoder
                .set_bitrate(i32::try_from(settings.bit_rate).map_err(|_| CodecFailure::Refused)?),
        )?;
        status(encoder.set_complexity(i32::from(settings.complexity)))?;
        status(encoder.set_vbr(i32::from(
            settings.rate_control != OpusRateControl::Constant,
        )))?;
        status(encoder.set_vbr_constraint(i32::from(
            settings.rate_control == OpusRateControl::ConstrainedVariable,
        )))?;
        // The multistream encoder's own lookahead omits the 2.5 ms the
        // reference's reports; every stream's encoder reports it whole.
        let lookahead = encoder
            .get_encoder(0)
            .map(ropus::OpusEncoder::get_lookahead)
            .ok_or(CodecFailure::Refused)?;
        let lookahead = usize::try_from(lookahead).map_err(|_| CodecFailure::Refused)?;
        let upsampling = OPUS_RATE / settings.sample_rate;
        let pre_skip =
            u16::try_from(lookahead * upsampling as usize).map_err(|_| CodecFailure::Refused)?;
        let head = OpusHead {
            channel_count: settings.channels,
            pre_skip,
            input_sample_rate: if settings.input_sample_rate == 0 {
                settings.sample_rate
            } else {
                settings.input_sample_rate
            },
            output_gain: 0,
            family,
            stream_count: u8::try_from(streams).map_err(|_| CodecFailure::Refused)?,
            coupled_count: u8::try_from(coupled).map_err(|_| CodecFailure::Refused)?,
            mapping,
        };
        // Vorbis channel `vorbis_index[plane]` is that plane; inverted, so
        // each Vorbis channel names its plane.
        let mut vorbis_source = vec![0; channels];
        if family == MappingFamily::Vorbis {
            for (plane, &vorbis) in layout.vorbis_index.iter().enumerate() {
                vorbis_source[vorbis] = plane;
            }
        } else {
            vorbis_source
                .iter_mut()
                .enumerate()
                .for_each(|(index, source)| *source = index);
        }
        let frame_size = settings.frame_duration.frames_at(settings.sample_rate) as usize;
        let scratch_bytes = MAX_PACKET_BYTES_PER_STREAM * usize::from(head.stream_count);
        Ok(Self {
            encoder,
            head,
            channels,
            vorbis_source,
            frame_size,
            upsampling,
            lookahead,
            pending: Vec::with_capacity(frame_size * channels),
            pushed: 0,
            finished: false,
            ready: VecDeque::new(),
            scratch: vec![0; scratch_bytes],
        })
    }

    /// The identification header, the stream's first Ogg packet.
    #[must_use]
    pub fn head(&self) -> &OpusHead {
        &self.head
    }

    /// Takes the first `frames` samples of each plane, one per channel,
    /// encoding every packet they complete.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] after [`finish`](Self::finish), or for a
    /// plane per channel missing or short.
    pub fn push<P: AsRef<[f32]>>(
        &mut self,
        planes: &[P],
        frames: usize,
    ) -> Result<(), CodecFailure> {
        let usable = !self.finished
            && planes.len() == self.channels
            && planes.iter().all(|plane| plane.as_ref().len() >= frames);
        if !usable {
            return Err(CodecFailure::Refused);
        }
        for frame in 0..frames {
            for &plane in &self.vorbis_source {
                self.pending.push(to_i16(planes[plane].as_ref()[frame]));
            }
            if self.pending.len() == self.frame_size * self.channels {
                self.encode_pending()?;
            }
        }
        self.pushed += frames as u64;
        Ok(())
    }

    /// Ends the stream: pads it with silence until the decoder, after its
    /// pre-skip, has given every frame pushed, and encodes what remains.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] where the encoder fails.
    pub fn finish(&mut self) -> Result<(), CodecFailure> {
        if self.finished {
            return Ok(());
        }
        self.finished = true;
        let mut owed = self.lookahead;
        while owed > 0 || !self.pending.is_empty() {
            self.pending.push(0);
            if self.pending.len() % self.channels == 0 {
                owed = owed.saturating_sub(1);
            }
            if self.pending.len() == self.frame_size * self.channels {
                self.encode_pending()?;
            }
        }
        Ok(())
    }

    /// The next encoded packet, in order.
    pub fn next_packet(&mut self) -> Option<OpusPacket> {
        self.ready.pop_front()
    }

    /// The granule position of the stream's last page: its pre-skip and
    /// every frame pushed, at 48 kHz. Valid once the stream is finished.
    #[must_use]
    pub fn end_granule(&self) -> u64 {
        u64::from(self.head.pre_skip) + self.pushed * u64::from(self.upsampling)
    }

    fn encode_pending(&mut self) -> Result<(), CodecFailure> {
        let frame_size = i32::try_from(self.frame_size).map_err(|_| CodecFailure::Refused)?;
        let capacity = i32::try_from(self.scratch.len()).map_err(|_| CodecFailure::Refused)?;
        let length = self
            .encoder
            .encode(&self.pending, frame_size, &mut self.scratch, capacity)
            .map_err(|_| CodecFailure::Refused)?;
        let length = usize::try_from(length).map_err(|_| CodecFailure::Refused)?;
        self.pending.clear();
        let frames =
            u32::try_from(self.frame_size).map_err(|_| CodecFailure::Refused)? * self.upsampling;
        self.ready.push_back(OpusPacket {
            bytes: self.scratch[..length].to_vec(),
            frames,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::to_i16;

    #[test]
    fn rounds_samples_to_sixteen_bits_by_one_integer_rule() {
        assert_eq!(to_i16(0.0), 0);
        assert_eq!(to_i16(1.0), 32_767);
        assert_eq!(to_i16(-1.0), -32_768);
        assert_eq!(to_i16(2.5 / 32_768.0), 2);
        assert_eq!(to_i16(3.5 / 32_768.0), 4);
        assert_eq!(to_i16(f32::NAN), 0);
        assert_eq!(to_i16(f32::INFINITY), 32_767);
    }
}
