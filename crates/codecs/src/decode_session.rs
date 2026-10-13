//! A decode session: one file, its default audio track described and decoded
//! in order (ADR-0090).

use symphonia::core::audio::{Channels, Position};
use symphonia::core::codecs::CodecParameters;
use symphonia::core::codecs::audio::AudioCodecParameters;
use symphonia::core::codecs::audio::well_known::profiles::{
    CODEC_PROFILE_AAC_HE, CODEC_PROFILE_AAC_HE_V2,
};
use symphonia::core::codecs::audio::well_known::{
    CODEC_ID_AAC, CODEC_ID_ALAC, CODEC_ID_FLAC, CODEC_ID_MP3, CODEC_ID_OPUS, CODEC_ID_VORBIS,
};
use symphonia::core::common::Limit;
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::well_known::{
    FORMAT_ID_ADTS, FORMAT_ID_FLAC, FORMAT_ID_ISOMP4, FORMAT_ID_MKV, FORMAT_ID_MP3, FORMAT_ID_OGG,
};
use symphonia::core::formats::{FormatOptions, FormatReader, Track, TrackType};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;

use crate::aac_signalling::{AacForm, ImplicitSbrSearch, form_of_config, implicit_form};
use crate::byte_source::{ByteSource, SourceReader, read_failure_of};
use crate::description::{Codec, Container, StatedLayout, StreamDescription};
use crate::failure::CodecFailure;
use crate::leading_bytes::{Leading, leading};
use crate::matroska_blocks::{MatroskaBlocks, MatroskaTrack};
use crate::mp4_gapless::{Mp4Trim, read_mp4_boxes};
use crate::opus_decoding::OPUS_RATE;
use crate::opus_head::{FieldOrder, OpusHead};
use crate::opus_track::OpusTrack;
use crate::planar_queue::PlanarQueue;
use crate::symphonia_track::SymphoniaTrack;
use crate::track_decoder::TrackDecoder;
use crate::track_packets::{BlockTrim, Timing, TrackPacket, TrackPackets, frames_of};
use crate::vorbis_order::vorbis_layout;

/// The speaker bits `WAVE_FORMAT_EXTENSIBLE` names, which Symphonia's
/// positions share; a position past them is one no speaker mask holds.
const SPEAKER_MASK_BITS: u64 = (1 << 18) - 1;

/// The front centre, which one channel alone is.
const FRONT_CENTRE: u32 = 1 << 2;

/// What a probe failing means: the bytes were read and are no container the
/// module knows, unless the read itself failed.
fn probe_failure(error: &Error) -> CodecFailure {
    match error {
        Error::IoError(io) => {
            read_failure_of(io).map_or(CodecFailure::Unrecognised, CodecFailure::from)
        }
        _ => CodecFailure::Unrecognised,
    }
}

/// The layout Symphonia's channels state.
fn layout_of(channels: &Channels) -> StatedLayout {
    match channels {
        Channels::Positioned(_) if channels.count() == 1 => StatedLayout::Speakers(FRONT_CENTRE),
        Channels::Positioned(positions) if positions.bits() & !SPEAKER_MASK_BITS == 0 => {
            u32::try_from(positions.bits()).map_or(StatedLayout::Unstated, StatedLayout::Speakers)
        }
        Channels::Ambisonic(order) => StatedLayout::Ambisonic(*order),
        _ => StatedLayout::Unstated,
    }
}

/// The container Symphonia's reader read, told apart where it reads two
/// alike.
fn container_of(reader: &dyn FormatReader, leading: Leading) -> Result<Container, CodecFailure> {
    let format = reader.format_info().format;
    let container = match format {
        id if id == FORMAT_ID_FLAC => Container::Flac,
        id if id == FORMAT_ID_MP3 => Container::Mp3,
        id if id == FORMAT_ID_OGG => Container::Ogg,
        id if id == FORMAT_ID_ISOMP4 => Container::Mp4,
        id if id == FORMAT_ID_ADTS => Container::Adts,
        id if id == FORMAT_ID_MKV => {
            if leading == (Leading::Ebml { webm: true }) {
                Container::Webm
            } else {
                Container::Matroska
            }
        }
        _ => return Err(CodecFailure::Unrecognised),
    };
    Ok(container)
}

/// What a track's codec is, before any decoder is made.
enum Recognised {
    /// A codec the module decodes.
    Decodable(Codec),
    /// HE-AAC, in the form its configuration or packets state.
    HighEfficiencyAac(AacForm),
}

/// One packet of the track as its container carries it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EncodedPacket<'a> {
    /// The packet's bytes.
    pub data: &'a [u8],
    /// The frames it presents, in the track's own frames, or 0 where the
    /// container does not say (a Matroska block without a duration).
    pub frames: u64,
}

/// How the session is being used: decoded, or read packet by packet for a
/// decoder elsewhere. A session is one or the other, never both.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Use {
    Unstarted,
    Decoding,
    ReadingPackets,
}

/// The trimming of the Matroska block being decoded, in frames: its frames
/// are held until its last is decoded, so its end can be taken back.
#[derive(Clone, Copy, Debug, Default)]
struct OpenBlock {
    /// Frames its start drops.
    start: u64,
    /// Frames its end drops.
    end: u64,
    /// Frames its packets decoded to.
    decoded: u64,
    /// Frames of them kept after the start's trimming and the stream's.
    kept: usize,
}

impl OpenBlock {
    /// A block whose `DiscardPadding` is `padding` nanoseconds, at `rate`.
    fn of(padding: i64, rate: u32) -> Self {
        let frames = frames_of(padding.unsigned_abs(), rate);
        if padding < 0 {
            Self {
                start: frames,
                ..Self::default()
            }
        } else {
            Self {
                end: frames,
                ..Self::default()
            }
        }
    }
}

/// One file's default audio track, described and decoded in order.
pub struct DecodeSession {
    packets: TrackPackets,
    description: StreamDescription,
    codec_config: Box<[u8]>,
    decoder: Option<Box<dyn TrackDecoder>>,
    queue: PlanarQueue,
    /// The Matroska block being decoded, where it has trimming.
    block: Option<OpenBlock>,
    /// The packet last given by [`read_packet`](Self::read_packet).
    packet: Option<TrackPacket>,
    use_: Use,
    delivered: u64,
    ended: bool,
    failure: Option<CodecFailure>,
}

impl DecodeSession {
    /// Opens `source`: recognises its container from its bytes, chooses its
    /// default audio track, and describes it.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Unrecognised`] where no container the module reads
    /// is found, [`CodecFailure::NoAudioTrack`],
    /// [`CodecFailure::Unsupported`] for a codec the module neither decodes
    /// nor recognises, [`CodecFailure::Malformed`], or the read failures.
    pub fn open<S: ByteSource + Send + Sync + 'static>(
        mut source: S,
    ) -> Result<Self, CodecFailure> {
        let size = source.size();
        let leading = leading(&mut source)?;
        let mp4_boxes = if leading == Leading::Mp4 {
            Some(read_mp4_boxes(&mut source)?)
        } else {
            None
        };
        let stream = MediaSourceStream::new(
            Box::new(SourceReader::new(source)),
            MediaSourceStreamOptions::default(),
        );
        // The application reads metadata itself (ADR-0093), so none is kept
        // here: no tag or picture is held in memory.
        let metadata = MetadataOptions::default()
            .limit_tag_bytes(Limit::Maximum(0))
            .limit_visual_bytes(Limit::Maximum(0));
        let reader = symphonia::default::get_probe()
            .probe(&Hint::new(), stream, FormatOptions::default(), metadata)
            .map_err(|error| probe_failure(&error))?;
        let container = container_of(reader.as_ref(), leading)?;
        let track = reader
            .default_track(TrackType::Audio)
            .cloned()
            .ok_or(CodecFailure::NoAudioTrack)?;
        let Some(CodecParameters::Audio(params)) = track.codec_params.clone() else {
            return Err(CodecFailure::NoAudioTrack);
        };
        // Symphonia has read the tracks; the module reads Matroska's blocks
        // itself, for the trimming Symphonia's reader drops.
        let (mut packets, matroska) = if matches!(container, Container::Webm | Container::Matroska)
        {
            let blocks = MatroskaBlocks::open(reader.into_inner(), track.id, size)?;
            let facts = blocks.track();
            (TrackPackets::matroska(blocks), Some(facts))
        } else {
            (TrackPackets::symphonia(reader, track.id), None)
        };
        let recognised = recognise(&mut packets, &params)?;
        let mp4_trim = |rate: u32| {
            mp4_boxes
                .as_ref()
                .and_then(|boxes| boxes.trim(track.id, rate))
        };
        let opened = match recognised {
            Recognised::Decodable(Codec::Opus) => {
                open_opus(&track, &params, container, &mp4_trim, matroska)?
            }
            Recognised::Decodable(codec) => {
                open_symphonia(&track, &params, codec, container, &mp4_trim, matroska)?
            }
            Recognised::HighEfficiencyAac(form) => describe_he_aac(&params, form, &mp4_trim)?,
        };
        let Opened {
            mut description,
            decoder,
            skip,
            length,
        } = opened;
        description.container = container;
        description.bit_rate = average_bit_rate(size, &description);
        let channels =
            usize::try_from(description.channel_count).map_err(|_| CodecFailure::Malformed)?;
        Ok(Self {
            packets,
            description,
            codec_config: params.extra_data.clone().unwrap_or_default(),
            decoder,
            queue: PlanarQueue::new(channels, skip, length),
            block: None,
            packet: None,
            use_: Use::Unstarted,
            delivered: 0,
            ended: false,
            failure: None,
        })
    }

    /// What the session decodes.
    #[must_use]
    pub const fn description(&self) -> &StreamDescription {
        &self.description
    }

    /// The codec's configuration as the container carries it: an AAC
    /// `AudioSpecificConfig`, an `OpusHead`, Vorbis's headers, FLAC's
    /// STREAMINFO or ALAC's magic cookie; empty where the container carries
    /// none, as in ADTS.
    #[must_use]
    pub fn codec_config(&self) -> &[u8] {
        &self.codec_config
    }

    /// Decodes up to `capacity` frames into `planes`, one slice per channel
    /// of at least `capacity` samples, answering how many: none only at the
    /// stream's end.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Unsupported`] for a stream the module describes but
    /// does not decode, [`CodecFailure::Refused`] for no capacity or a
    /// session already read packet by packet, and [`CodecFailure::Malformed`]
    /// or a read failure part way, which every later call answers too.
    pub fn decode_into<'a>(
        &mut self,
        capacity: usize,
        planes: impl Iterator<Item = &'a mut [f32]>,
    ) -> Result<usize, CodecFailure> {
        if let Some(failure) = self.failure {
            return Err(failure);
        }
        if capacity == 0 || self.use_ == Use::ReadingPackets {
            return Err(CodecFailure::Refused);
        }
        self.use_ = Use::Decoding;
        let result = self.fill();
        if let Err(failure) = result {
            self.failure = Some(failure);
            return Err(failure);
        }
        let frames = self.queue.take_into(capacity, planes);
        self.delivered += frames as u64;
        Ok(frames)
    }

    /// Decodes packets until frames wait or the stream ends, refusing a
    /// stream that ends short of the length its container states. A
    /// Matroska block with trimming is decoded whole before any of it is
    /// given out, so its end can be taken back.
    fn fill(&mut self) -> Result<(), CodecFailure> {
        let track_decoder = self.decoder.as_mut().ok_or(CodecFailure::Unsupported)?;
        let rate = self.description.sample_rate;
        while !self.ended && (self.queue.waiting() == 0 || self.block.is_some()) {
            let Some(packet) = self.packets.next()? else {
                self.ended = true;
                let given = self.delivered + self.queue.waiting() as u64;
                if self
                    .description
                    .total_frames
                    .is_some_and(|total| given < total)
                {
                    return Err(CodecFailure::Malformed);
                }
                break;
            };
            let trim = match packet.timing {
                Timing::Matroska { trim, .. } => trim,
                Timing::Frames => None,
            };
            if let Some(BlockTrim {
                padding,
                opens: true,
                ..
            }) = trim
            {
                let block = OpenBlock::of(padding, rate);
                self.queue.skip_at_least(block.start);
                self.block = Some(block);
            }
            let output = track_decoder.decode(&packet.packet)?;
            let kept = self.queue.push(&output);
            if let Some(block) = self.block.as_mut() {
                block.decoded += output.frames.len() as u64;
                block.kept += kept;
            }
            if trim.is_some_and(|trim| trim.closes) {
                let block = self.block.take().ok_or(CodecFailure::Malformed)?;
                // Padding past the block's own frames would trim another's.
                if block.start > block.decoded || block.end > block.decoded {
                    return Err(CodecFailure::Malformed);
                }
                let end = usize::try_from(block.end).map_err(|_| CodecFailure::Malformed)?;
                self.queue.retract(end.min(block.kept));
            }
            self.ended = self.queue.complete();
        }
        Ok(())
    }

    /// Reads the track's next packet as the container carries it, for a
    /// decoder outside the module, answering it, or `None` at the end. It is
    /// [`last_packet`](Self::last_packet) until the next call.
    ///
    /// # Errors
    ///
    /// [`CodecFailure::Refused`] for a session already decoded, and
    /// [`CodecFailure::Malformed`] or a read failure, which every later call
    /// answers too.
    pub fn read_packet(&mut self) -> Result<Option<EncodedPacket<'_>>, CodecFailure> {
        if let Some(failure) = self.failure {
            return Err(failure);
        }
        if self.use_ == Use::Decoding {
            return Err(CodecFailure::Refused);
        }
        self.use_ = Use::ReadingPackets;
        match self.packets.next() {
            Ok(packet) => {
                self.packet = packet;
                Ok(self.last_packet())
            }
            Err(failure) => {
                self.failure = Some(failure);
                Err(failure)
            }
        }
    }
}

impl DecodeSession {
    /// The packet [`read_packet`](Self::read_packet) last read.
    #[must_use]
    pub fn last_packet(&self) -> Option<EncodedPacket<'_>> {
        self.packet.as_ref().map(|packet| EncodedPacket {
            data: &packet.packet.data,
            frames: packet.frames(self.description.sample_rate),
        })
    }
}

/// A track's codec, from its parameters and, for AAC, its first packets.
fn recognise(
    packets: &mut TrackPackets,
    params: &AudioCodecParameters,
) -> Result<Recognised, CodecFailure> {
    let codec = match params.codec {
        id if id == CODEC_ID_FLAC => Codec::Flac,
        id if id == CODEC_ID_ALAC => Codec::Alac,
        id if id == CODEC_ID_MP3 => Codec::Mp3,
        id if id == CODEC_ID_VORBIS => Codec::Vorbis,
        id if id == CODEC_ID_OPUS => Codec::Opus,
        id if id == CODEC_ID_AAC => return recognise_aac(packets, params),
        _ => return Err(CodecFailure::Unsupported),
    };
    Ok(Recognised::Decodable(codec))
}

/// Whether an AAC track is AAC-LC or HE-AAC: by its configuration where it
/// states SBR, and otherwise by its first packets.
fn recognise_aac(
    packets: &mut TrackPackets,
    params: &AudioCodecParameters,
) -> Result<Recognised, CodecFailure> {
    let stated = params.extra_data.as_deref().map(form_of_config);
    if let Some(form @ AacForm::HighEfficiency { .. }) = stated {
        return Ok(Recognised::HighEfficiencyAac(form));
    }
    if let Some(profile) = params.profile {
        if profile == CODEC_PROFILE_AAC_HE || profile == CODEC_PROFILE_AAC_HE_V2 {
            let rate = params.sample_rate.ok_or(CodecFailure::Malformed)?;
            return Ok(Recognised::HighEfficiencyAac(AacForm::HighEfficiency {
                rate: implicit_rate(rate),
                parametric_stereo: profile == CODEC_PROFILE_AAC_HE_V2,
            }));
        }
    }
    let mut search = ImplicitSbrSearch::default();
    while !search.decided() {
        let Some(data) = packets.read_ahead()? else {
            break;
        };
        search.examine(data);
    }
    if search.carries_sbr() {
        let rate = params.sample_rate.ok_or(CodecFailure::Malformed)?;
        return Ok(Recognised::HighEfficiencyAac(implicit_form(rate)));
    }
    Ok(Recognised::Decodable(Codec::AacLc))
}

/// The rate SBR doubles a core rate to, where the container names HE-AAC.
fn implicit_rate(core: u32) -> u32 {
    match implicit_form(core) {
        AacForm::HighEfficiency { rate, .. } => rate,
        _ => core,
    }
}

/// A recognised track, described, with its decoder and the trimming its
/// container states outside its packets.
struct Opened {
    description: StreamDescription,
    decoder: Option<Box<dyn TrackDecoder>>,
    skip: u64,
    length: Option<u64>,
}

/// A description with what every track states.
fn described(
    codec: Codec,
    rate: u32,
    channels: usize,
    layout: StatedLayout,
) -> Result<StreamDescription, CodecFailure> {
    if rate == 0 || channels == 0 {
        return Err(CodecFailure::Malformed);
    }
    Ok(StreamDescription {
        codec,
        // Set by the session, which knows the reader.
        container: Container::Flac,
        sample_rate: rate,
        channel_count: u32::try_from(channels).map_err(|_| CodecFailure::Malformed)?,
        layout,
        total_frames: None,
        priming: None,
        padding: None,
        bit_rate: None,
        bits_per_sample: None,
        decodable: true,
    })
}

fn open_symphonia(
    track: &Track,
    params: &AudioCodecParameters,
    codec: Codec,
    container: Container,
    mp4_trim: &dyn Fn(u32) -> Option<Mp4Trim>,
    matroska: Option<MatroskaTrack>,
) -> Result<Opened, CodecFailure> {
    let track_decoder = SymphoniaTrack::new(params)?;
    // The decoder completes the parameters from the codec's own headers.
    let completed = track_decoder.params();
    let channels = completed.channels.clone().ok_or(CodecFailure::Malformed)?;
    let rate = completed.sample_rate.ok_or(CodecFailure::Malformed)?;
    let mut description = described(codec, rate, channels.count(), layout_of(&channels))?;
    if codec.lossless() {
        description.bits_per_sample = completed.bits_per_sample;
    }
    let mut skip = 0;
    let mut length = None;
    match container {
        Container::Mp4 => {
            if let Some(trim) = mp4_trim(rate) {
                skip = trim.priming;
                length = trim.length;
                description.priming = Some(trim.priming);
                description.total_frames = trim
                    .length
                    .or_else(|| track.num_frames.map(|all| all.saturating_sub(trim.priming)));
                description.padding = track
                    .num_frames
                    .zip(trim.length)
                    .map(|(all, kept)| all.saturating_sub(trim.priming + kept));
            } else {
                description.total_frames = track.num_frames;
            }
        }
        // Symphonia's MP3 reader estimates a length where no tag states
        // one, so the length is taken as stated only beside the LAME tag's
        // priming.
        Container::Mp3 => {
            description.priming = track.delay.map(u64::from);
            description.padding = track.padding.map(u64::from);
            description.total_frames = track.delay.and(track.num_frames);
        }
        // Matroska states the delay of any codec, which Symphonia's reader
        // reads but applies to nothing; its end padding is in the blocks.
        Container::Webm | Container::Matroska => {
            if let Some(delay) = matroska.and_then(|track| track.codec_delay) {
                skip = frames_of(delay, rate);
                description.priming = Some(skip);
            }
        }
        _ => {
            description.priming = track.delay.map(u64::from);
            description.padding = track.padding.map(u64::from);
            description.total_frames = track.num_frames;
        }
    }
    Ok(Opened {
        description,
        decoder: Some(Box::new(track_decoder)),
        skip,
        length,
    })
}

fn open_opus(
    track: &Track,
    params: &AudioCodecParameters,
    container: Container,
    mp4_trim: &dyn Fn(u32) -> Option<Mp4Trim>,
    matroska: Option<MatroskaTrack>,
) -> Result<Opened, CodecFailure> {
    let config = params
        .extra_data
        .as_deref()
        .ok_or(CodecFailure::Malformed)?;
    let order = if container == Container::Mp4 {
        FieldOrder::Big
    } else {
        FieldOrder::Little
    };
    let head = OpusHead::read(config, order)?;
    let channels = usize::from(head.channel_count);
    let layout = match head.channel_count {
        1 => StatedLayout::Speakers(FRONT_CENTRE),
        _ => vorbis_layout(channels).map_or(StatedLayout::Unstated, |layout| {
            StatedLayout::Speakers(layout.mask)
        }),
    };
    let mut description = described(Codec::Opus, OPUS_RATE, channels, layout)?;
    let pre_skip = u64::from(head.pre_skip);
    // The pre-skip is trimmed from the start. Ogg states the end in its last
    // granule position, which Symphonia counts from the stream's start, so
    // the length is that less the pre-skip; an MP4 edit list states both.
    // Matroska states the delay as `CodecDelay`, which wins where stated, as
    // the edit list does, and the end in its last block's `DiscardPadding`.
    let (skip, length) = match container {
        Container::Ogg => (
            pre_skip,
            track.num_frames.and_then(|end| end.checked_sub(pre_skip)),
        ),
        Container::Mp4 => {
            mp4_trim(OPUS_RATE).map_or((pre_skip, None), |trim| (trim.priming, trim.length))
        }
        Container::Webm | Container::Matroska => (
            matroska
                .and_then(|track| track.codec_delay)
                .map_or(pre_skip, |delay| frames_of(delay, OPUS_RATE)),
            None,
        ),
        _ => (pre_skip, None),
    };
    description.priming = Some(skip);
    description.total_frames = length;
    Ok(Opened {
        description,
        decoder: Some(Box::new(OpusTrack::new(&head)?)),
        skip,
        length,
    })
}

fn describe_he_aac(
    params: &AudioCodecParameters,
    form: AacForm,
    mp4_trim: &dyn Fn(u32) -> Option<Mp4Trim>,
) -> Result<Opened, CodecFailure> {
    let (rate, parametric_stereo) = match form {
        AacForm::HighEfficiency {
            rate,
            parametric_stereo,
        } => (rate, parametric_stereo),
        _ => (params.sample_rate.unwrap_or(0), false),
    };
    let core = params.channels.clone().unwrap_or(Channels::None);
    // Parametric stereo makes two channels of one.
    let channels = if parametric_stereo && core.count() <= 1 {
        Channels::Positioned(Position::FRONT_LEFT | Position::FRONT_RIGHT)
    } else {
        core
    };
    // The decoder that serves HE-AAC trims it; the module states what the
    // container does.
    let trim = mp4_trim(rate);
    let mut description = described(Codec::HeAac, rate, channels.count(), layout_of(&channels))?;
    description.total_frames = trim.and_then(|trim| trim.length);
    description.priming = trim.map(|trim| trim.priming);
    description.decodable = false;
    Ok(Opened {
        description,
        decoder: None,
        skip: 0,
        length: None,
    })
}

/// The file's bits over the stream's stated duration.
fn average_bit_rate(size: u64, description: &StreamDescription) -> Option<u32> {
    let frames = description.total_frames.filter(|&frames| frames > 0)?;
    let bits = u128::from(size) * 8 * u128::from(description.sample_rate);
    u32::try_from(bits / u128::from(frames)).ok()
}
