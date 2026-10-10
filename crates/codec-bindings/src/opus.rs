//! Opus encoders, and Opus packet decoders, by handle.

use audiogubbins_codecs::{
    MappingFamily, OPUS_RATE, OpusApplication, OpusEncoder, OpusFrameDuration, OpusHead,
    OpusPacketDecoder, OpusRateControl, OpusSettings,
};

use crate::host_file::exact_f64;
use crate::{
    BAD_HANDLE, DONE, REFUSED, TOO_SMALL, address_of, code_of, count, handle, planes, release,
    with_objects,
};

/// An encoder, and the bytes it last gave: its header or a packet.
pub struct EncoderEntry {
    encoder: OpusEncoder,
    output: Vec<u8>,
    packet_frames: u32,
}

/// The applications, by the ABI's code.
const APPLICATIONS: [OpusApplication; 3] = [
    OpusApplication::Audio,
    OpusApplication::Voip,
    OpusApplication::RestrictedLowDelay,
];

/// The frame durations, by the ABI's code: 2.5 to 120 ms.
const DURATIONS: [OpusFrameDuration; 9] = [
    OpusFrameDuration::Ms2_5,
    OpusFrameDuration::Ms5,
    OpusFrameDuration::Ms10,
    OpusFrameDuration::Ms20,
    OpusFrameDuration::Ms40,
    OpusFrameDuration::Ms60,
    OpusFrameDuration::Ms80,
    OpusFrameDuration::Ms100,
    OpusFrameDuration::Ms120,
];

/// The rate controls, by the ABI's code.
const RATE_CONTROLS: [OpusRateControl; 3] = [
    OpusRateControl::Variable,
    OpusRateControl::ConstrainedVariable,
    OpusRateControl::Constant,
];

fn by_code<T: Copy>(table: &[T], code: u32) -> Option<T> {
    table.get(usize::try_from(code).ok()?).copied()
}

/// An Opus encoder of `channels` channels at `rate`, its handle, or
/// [`REFUSED`]: `application` 0 audio, 1 voice, 2 restricted low delay;
/// `duration` 0 to 8 for 2.5, 5, 10, 20, 40, 60, 80, 100 and 120 ms;
/// `rate_control` 0 variable, 1 constrained variable, 2 constant;
/// `input_rate` the audio's rate before it was brought to `rate`, or 0.
#[unsafe(no_mangle)]
#[allow(
    clippy::too_many_arguments,
    reason = "one call per setting would be state the ABI must order"
)]
pub extern "C" fn ag_opus_encoder_create(
    rate: u32,
    channels: u32,
    bit_rate: u32,
    application: u32,
    duration: u32,
    complexity: u32,
    rate_control: u32,
    input_rate: u32,
) -> i32 {
    let settings = (|| {
        Some(OpusSettings {
            sample_rate: rate,
            channels: u8::try_from(channels).ok()?,
            bit_rate,
            application: by_code(&APPLICATIONS, application)?,
            frame_duration: by_code(&DURATIONS, duration)?,
            complexity: u8::try_from(complexity).ok()?,
            rate_control: by_code(&RATE_CONTROLS, rate_control)?,
            input_sample_rate: input_rate,
        })
    })();
    let Some(settings) = settings else {
        return REFUSED;
    };
    match OpusEncoder::new(settings) {
        Ok(encoder) => with_objects(|objects| {
            handle(objects.opus_encoders.insert(EncoderEntry {
                encoder,
                output: Vec::new(),
                packet_frames: 0,
            }))
        }),
        Err(failure) => code_of(failure),
    }
}

/// Gives an encoder's identification header, the stream's first Ogg packet,
/// answering its length; [`ag_opus_encoder_output`] gives its bytes.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_encoder_head(encoder: u32) -> i32 {
    with_objects(|objects| {
        let Some(entry) = objects.opus_encoders.get_mut(encoder) else {
            return BAD_HANDLE;
        };
        entry.output = entry.encoder.head().to_bytes();
        count(entry.output.len())
    })
}

/// Gives an encoder the sample buffer `samples`, each channel's `frames`
/// samples after the last's.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_encoder_push(encoder: u32, samples: u32, frames: u32) -> i32 {
    with_objects(|objects| {
        let (Some(entry), Some(buffer)) = (
            objects.opus_encoders.get_mut(encoder),
            objects.floats.get_mut(samples),
        ) else {
            return BAD_HANDLE;
        };
        let Ok(frames) = usize::try_from(frames) else {
            return TOO_SMALL;
        };
        let channels = usize::from(entry.encoder.head().channel_count);
        let Some(planes) = planes(buffer, channels, frames) else {
            return TOO_SMALL;
        };
        entry
            .encoder
            .push(&planes, frames)
            .map_or_else(code_of, |()| DONE)
    })
}

/// Ends an encoder's stream, encoding what remains with its padding.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_encoder_finish(encoder: u32) -> i32 {
    with_objects(|objects| {
        objects
            .opus_encoders
            .get_mut(encoder)
            .map_or(BAD_HANDLE, |entry| {
                entry.encoder.finish().map_or_else(code_of, |()| DONE)
            })
    })
}

/// Gives an encoder's next packet, answering its length, or 0 where none is
/// ready; [`ag_opus_encoder_output`] gives its bytes and
/// [`ag_opus_encoder_packet_frames`] its duration.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_encoder_next_packet(encoder: u32) -> i32 {
    with_objects(|objects| {
        let Some(entry) = objects.opus_encoders.get_mut(encoder) else {
            return BAD_HANDLE;
        };
        let Some(packet) = entry.encoder.next_packet() else {
            return 0;
        };
        entry.output = packet.bytes;
        entry.packet_frames = packet.frames;
        count(entry.output.len())
    })
}

/// Where the bytes an encoder last gave start, or 0 for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_encoder_output(encoder: u32) -> u32 {
    with_objects(|objects| {
        objects
            .opus_encoders
            .get_mut(encoder)
            .map_or(0, |entry| address_of(&entry.output))
    })
}

/// The frames at 48 kHz of the packet an encoder last gave, by which the
/// granule position advances.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_encoder_packet_frames(encoder: u32) -> i32 {
    with_objects(|objects| {
        objects
            .opus_encoders
            .get_mut(encoder)
            .map_or(BAD_HANDLE, |entry| {
                i32::try_from(entry.packet_frames).unwrap_or(TOO_SMALL)
            })
    })
}

/// The granule position of a finished stream's last page, or -1 for a bad
/// handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_encoder_end_granule(encoder: u32) -> f64 {
    with_objects(|objects| {
        objects
            .opus_encoders
            .get_mut(encoder)
            .and_then(|entry| exact_f64(entry.encoder.end_granule()))
            .unwrap_or(-1.0)
    })
}

/// Closes an encoder.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_encoder_close(encoder: u32) -> i32 {
    with_objects(|objects| release(&mut objects.opus_encoders, encoder))
}

/// A decoder of single-stream Opus packets, and the planes it decodes into.
pub struct DecoderEntry {
    decoder: OpusPacketDecoder,
    planes: Vec<Vec<f32>>,
}

/// A decoder of one stream of Opus packets to `channels` channels, one or
/// two, at 48 kHz: what the conformance vectors are decoded with.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_decoder_create(channels: u32) -> i32 {
    let Some(channel_count) = u8::try_from(channels)
        .ok()
        .filter(|count| (1..=2).contains(count))
    else {
        return REFUSED;
    };
    let head = OpusHead {
        channel_count,
        pre_skip: 0,
        input_sample_rate: OPUS_RATE,
        output_gain: 0,
        family: MappingFamily::Single,
        stream_count: 1,
        coupled_count: channel_count - 1,
        mapping: (0..channel_count).collect(),
    };
    match OpusPacketDecoder::new(&head) {
        Ok(decoder) => with_objects(|objects| {
            handle(objects.opus_decoders.insert(DecoderEntry {
                decoder,
                planes: vec![Vec::new(); usize::from(channel_count)],
            }))
        }),
        Err(failure) => code_of(failure),
    }
}

/// Decodes the first `length` bytes of the byte buffer `packet` into the
/// sample buffer `samples`, each channel's `capacity` samples after the
/// last's, answering the frames decoded. A packet of no bytes is a lost one,
/// concealed. `capacity` must hold the longest packet, 5 760 frames.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_decoder_decode(
    decoder: u32,
    packet: u32,
    length: u32,
    samples: u32,
    capacity: u32,
) -> i32 {
    with_objects(|objects| {
        let objects = &mut *objects;
        let (Some(entry), Some(bytes), Some(buffer)) = (
            objects.opus_decoders.get_mut(decoder),
            objects.bytes.get_mut(packet),
            objects.floats.get_mut(samples),
        ) else {
            return BAD_HANDLE;
        };
        let (Ok(length), Ok(capacity)) = (usize::try_from(length), usize::try_from(capacity))
        else {
            return TOO_SMALL;
        };
        let channels = entry.planes.len();
        let fits = capacity >= audiogubbins_codecs::MAX_OPUS_PACKET_FRAMES
            && length <= bytes.len()
            && channels
                .checked_mul(capacity)
                .is_some_and(|needed| needed <= buffer.len());
        if !fits {
            return TOO_SMALL;
        }
        match entry.decoder.decode(&bytes[..length], &mut entry.planes) {
            Ok(frames) => {
                for (into, plane) in buffer.chunks_exact_mut(capacity).zip(&entry.planes) {
                    into[..frames].copy_from_slice(&plane[..frames]);
                }
                count(frames)
            }
            Err(failure) => code_of(failure),
        }
    })
}

/// The range coder's final state after a decoder's last packet, or -1 for a
/// bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_decoder_final_range(decoder: u32) -> f64 {
    with_objects(|objects| {
        objects
            .opus_decoders
            .get_mut(decoder)
            .map_or(-1.0, |entry| f64::from(entry.decoder.final_range()))
    })
}

/// Closes a packet decoder.
#[unsafe(no_mangle)]
pub extern "C" fn ag_opus_decoder_close(decoder: u32) -> i32 {
    with_objects(|objects| release(&mut objects.opus_decoders, decoder))
}
