//! FLAC frame encoders by handle.

use audiogubbins_codecs::{FlacFrameEncoder, FlacSettings};

use crate::{
    BAD_HANDLE, REFUSED, TOO_SMALL, address_of, code_of, count, handle, planes, release,
    with_objects,
};

/// An encoder of FLAC frames of `channels` channels of `bits` bits at `rate`,
/// in blocks of `block_size` frames, at compression level `level` (0 to 8):
/// its handle, or [`REFUSED`] for settings FLAC does not encode. Every
/// depth from 4 to 32 bits is served: `flacenc`'s by `flacenc`, the rest,
/// 32 bits among them, by the module's own encoder.
#[unsafe(no_mangle)]
pub extern "C" fn ag_flac_encoder_create(
    channels: u32,
    bits: u32,
    rate: u32,
    block_size: u32,
    level: u32,
) -> i32 {
    let (Ok(channels), Ok(bits_per_sample), Ok(level)) = (
        u8::try_from(channels),
        u8::try_from(bits),
        u8::try_from(level),
    ) else {
        return REFUSED;
    };
    let settings = FlacSettings {
        channels,
        bits_per_sample,
        sample_rate: rate,
        block_size,
        level,
    };
    match FlacFrameEncoder::new(settings) {
        Ok(encoder) => with_objects(|objects| handle(objects.flac_encoders.insert(encoder))),
        Err(failure) => code_of(failure),
    }
}

/// Encodes the frame numbered `number` from the integer buffer `samples`,
/// each channel's `frames` samples after the last's, answering the frame's
/// length in bytes, which [`ag_flac_encoder_frame`] gives.
#[unsafe(no_mangle)]
pub extern "C" fn ag_flac_encoder_encode(
    encoder: u32,
    samples: u32,
    frames: u32,
    number: u32,
) -> i32 {
    with_objects(|objects| {
        let (Some(encoder), Some(buffer)) = (
            objects.flac_encoders.get_mut(encoder),
            objects.ints.get_mut(samples),
        ) else {
            return BAD_HANDLE;
        };
        let Ok(frames) = usize::try_from(frames) else {
            return TOO_SMALL;
        };
        let channels = usize::from(encoder.settings().channels);
        let Some(planes) = planes(buffer, channels, frames) else {
            return TOO_SMALL;
        };
        encoder
            .encode(&planes, frames, number)
            .map_or_else(code_of, |bytes| count(bytes.len()))
    })
}

/// Where the frame an encoder last encoded starts, or 0 for a bad handle.
#[unsafe(no_mangle)]
pub extern "C" fn ag_flac_encoder_frame(encoder: u32) -> u32 {
    with_objects(|objects| {
        objects
            .flac_encoders
            .get_mut(encoder)
            .map_or(0, |encoder| address_of(encoder.last_frame()))
    })
}

/// Closes an encoder.
#[unsafe(no_mangle)]
pub extern "C" fn ag_flac_encoder_close(encoder: u32) -> i32 {
    with_objects(|objects| release(&mut objects.flac_encoders, encoder))
}
