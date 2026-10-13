//! Decode sessions by handle: open a file the host registered, describe its
//! default audio track, and decode it or read its packets in order.

use audiogubbins_codecs::{DecodeSession, StatedLayout, StreamDescription};

use crate::host_file::{HostFile, exact_f64};
use crate::{
    BAD_HANDLE, REFUSED, TOO_SMALL, address_of, code_of, count, handle, release, with_objects,
};

/// The fields of a description record, each an `f64`, NaN where the stream
/// does not state it: the codec and container codes, the rate, the channels,
/// the layout's kind (0 unstated, 1 speakers, 2 ambisonic) and its mask or
/// order, the length, priming and padding in frames, the bit rate, the bits a
/// sample, whether the module decodes it (1) or not (0), and the length of
/// the codec configuration [`ag_decoder_config`] gives.
pub const RECORD_FIELDS: usize = 13;

/// A session, and its description as the record the host reads.
pub struct DecoderEntry {
    session: DecodeSession,
    /// Boxed, so its address holds when the table grows.
    pub(crate) record: Box<[f64; RECORD_FIELDS]>,
}

fn stated(value: Option<u64>) -> f64 {
    value.and_then(exact_f64).unwrap_or(f64::NAN)
}

fn record_of(description: &StreamDescription, config_length: usize) -> [f64; RECORD_FIELDS] {
    let (layout_kind, layout_value) = match description.layout {
        StatedLayout::Unstated => (0.0, f64::NAN),
        StatedLayout::Speakers(mask) => (1.0, f64::from(mask)),
        StatedLayout::Ambisonic(order) => (2.0, f64::from(order)),
    };
    [
        f64::from(description.codec.code()),
        f64::from(description.container.code()),
        f64::from(description.sample_rate),
        f64::from(description.channel_count),
        layout_kind,
        layout_value,
        stated(description.total_frames),
        stated(description.priming),
        stated(description.padding),
        description.bit_rate.map_or(f64::NAN, f64::from),
        description.bits_per_sample.map_or(f64::NAN, f64::from),
        if description.decodable { 1.0 } else { 0.0 },
        stated(Some(config_length as u64)),
    ]
}

/// Opens the file the host registered as `source`, of `size` bytes: a
/// session's handle, or the failure that refused the file.
#[unsafe(no_mangle)]
pub extern "C" fn ag_decoder_open(source: u32, size: f64) -> i32 {
    let Some(file) = HostFile::new(source, size) else {
        return REFUSED;
    };
    // Opened outside the tables: the host's reads may not call the module,
    // but the tables are not held while it is asked.
    match DecodeSession::open(file) {
        Ok(session) => {
            let record = Box::new(record_of(
                session.description(),
                session.codec_config().len(),
            ));
            with_objects(|objects| {
                handle(objects.decoders.insert(DecoderEntry { session, record }))
            })
        }
        Err(failure) => code_of(failure),
    }
}

/// Where a session's description record starts, eight-byte aligned, or 0
/// for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_decoder_description(session: u32) -> u32 {
    with_objects(|objects| {
        objects
            .decoders
            .get_mut(session)
            .map_or(0, |entry| address_of(entry.record.as_slice()))
    })
}

/// Where a session's codec configuration starts, its length in the
/// description record, or 0 for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_decoder_config(session: u32) -> u32 {
    with_objects(|objects| {
        objects
            .decoders
            .get_mut(session)
            .map_or(0, |entry| address_of(entry.session.codec_config()))
    })
}

/// Decodes up to `capacity` frames into the sample buffer `samples`, each
/// channel's `capacity` samples after the last's, answering how many: 0 only
/// at the stream's end.
#[unsafe(no_mangle)]
pub extern "C" fn ag_decoder_decode(session: u32, samples: u32, capacity: u32) -> i32 {
    with_objects(|objects| {
        let (Some(entry), Some(buffer)) = (
            objects.decoders.get_mut(session),
            objects.floats.get_mut(samples),
        ) else {
            return BAD_HANDLE;
        };
        let Ok(capacity) = usize::try_from(capacity) else {
            return TOO_SMALL;
        };
        let channels = entry.session.description().channel_count as usize;
        let Some(needed) = channels
            .checked_mul(capacity)
            .filter(|&needed| needed <= buffer.len())
        else {
            return TOO_SMALL;
        };
        if capacity == 0 {
            return REFUSED;
        }
        let planes = buffer[..needed].chunks_exact_mut(capacity);
        entry
            .session
            .decode_into(capacity, planes)
            .map_or_else(code_of, count)
    })
}

/// Reads a session's next packet undecoded, for a decoder outside the module,
/// answering its length, or 0 at the stream's end.
#[unsafe(no_mangle)]
pub extern "C" fn ag_decoder_read_packet(session: u32) -> i32 {
    with_objects(|objects| {
        let Some(entry) = objects.decoders.get_mut(session) else {
            return BAD_HANDLE;
        };
        match entry.session.read_packet() {
            Ok(Some(packet)) => count(packet.data.len()),
            Ok(None) => 0,
            Err(failure) => code_of(failure),
        }
    })
}

/// Where the packet a session last read starts, or 0 for a bad handle or no
/// packet.
#[unsafe(no_mangle)]
pub extern "C" fn ag_decoder_packet(session: u32) -> u32 {
    with_objects(|objects| {
        objects
            .decoders
            .get_mut(session)
            .and_then(|entry| {
                entry
                    .session
                    .last_packet()
                    .map(|packet| address_of(packet.data))
            })
            .unwrap_or(0)
    })
}

/// The frames the packet a session last read presents, or -1 for a bad
/// handle or no packet.
#[unsafe(no_mangle)]
pub extern "C" fn ag_decoder_packet_frames(session: u32) -> f64 {
    with_objects(|objects| {
        objects
            .decoders
            .get_mut(session)
            .and_then(|entry| entry.session.last_packet())
            .and_then(|packet| exact_f64(packet.frames))
            .unwrap_or(-1.0)
    })
}

/// Closes a session.
#[unsafe(no_mangle)]
pub extern "C" fn ag_decoder_close(session: u32) -> i32 {
    with_objects(|objects| release(&mut objects.decoders, session))
}
