// Symphonia
// Copyright (c) 2019-2026 The Project Symphonia Developers.
//
// Previous Author: Kostya Shishkov <kostya.shiskov@gmail.com>
//
// This source file includes code originally written for the NihAV
// project. With the author's permission, it has been relicensed for,
// and ported to the Symphonia project.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use symphonia_core::audio::layouts::{
    CHANNEL_LAYOUT_AAC_3P0, CHANNEL_LAYOUT_AAC_4P0, CHANNEL_LAYOUT_AAC_5P0, CHANNEL_LAYOUT_AAC_5P1,
    CHANNEL_LAYOUT_AAC_7P1,
};
use symphonia_core::audio::{
    AsGenericAudioBufferRef, AudioBuffer, AudioSpec, Channels, GenericAudioBufferRef, Position,
};
use symphonia_core::codecs::CodecInfo;
use symphonia_core::codecs::audio::well_known::CODEC_ID_AAC;
use symphonia_core::codecs::audio::{AudioCodecParameters, AudioDecoderOptions};
use symphonia_core::codecs::audio::{AudioDecoder, FinalizeResult};
use symphonia_core::codecs::registry::{RegisterableAudioDecoder, SupportedAudioCodec};
use symphonia_core::errors::{Result, unsupported_error};
use symphonia_core::io::{BitReaderLtr, FiniteBitStream, ReadBitsLtr};
use symphonia_core::packet::PacketRef;
use symphonia_core::{codec_profile, support_audio_codec};

use symphonia_common::mpeg::audio::{AudioObjectType, AudioSpecificConfig};

mod codebooks;
mod common;
mod cpe;
mod dsp;
mod ics;
mod window;

use common::*;

// AudioGubbins: the syntactic elements of each channel configuration of more than two
// channels, in the order a raw data block carries them, and the speaker of each channel they
// hold, in that order (ISO/IEC 14496-3, Table 1.19). The published crate refused every
// configuration past two channels, and would have written each element's channels to the
// output planes in the order the elements came, where the planes are in the order of the
// layout's positions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Element {
    Single,
    Pair,
    LowFrequency,
}

/// The elements of a layout of more than two channels, and the speaker of each channel they
/// hold, or `None` for a layout no channel configuration states.
fn configuration_of(channels: &Channels) -> Option<(&'static [Element], &'static [Position])> {
    use Element::{LowFrequency, Pair, Single};
    const C: Position = Position::FRONT_CENTER;
    const L: Position = Position::FRONT_LEFT;
    const R: Position = Position::FRONT_RIGHT;
    const LS: Position = Position::REAR_LEFT;
    const RS: Position = Position::REAR_RIGHT;
    const LFE: Position = Position::LFE1;
    let configuration: (&'static [Element], &'static [Position]) =
        if *channels == CHANNEL_LAYOUT_AAC_3P0 {
            (&[Single, Pair], &[C, L, R])
        }
        else if *channels == CHANNEL_LAYOUT_AAC_4P0 {
            (&[Single, Pair, Single], &[C, L, R, Position::REAR_CENTER])
        }
        else if *channels == CHANNEL_LAYOUT_AAC_5P0 {
            (&[Single, Pair, Pair], &[C, L, R, LS, RS])
        }
        else if *channels == CHANNEL_LAYOUT_AAC_5P1 {
            (&[Single, Pair, Pair, LowFrequency], &[C, L, R, LS, RS, LFE])
        }
        else if *channels == CHANNEL_LAYOUT_AAC_7P1 {
            // The first pair is the centre-front pair, the second the outside-front pair.
            (
                &[Single, Pair, Pair, Pair, LowFrequency],
                &[
                    C,
                    Position::FRONT_LEFT_CENTER,
                    Position::FRONT_RIGHT_CENTER,
                    L,
                    R,
                    LS,
                    RS,
                    LFE,
                ],
            )
        }
        else {
            return None;
        };
    Some(configuration)
}

/// The output plane of each channel in element order: a channel's plane is its position's rank
/// among the layout's positions, which order the planes.
fn planes_of(channels: &Channels, positions: &[Position]) -> Vec<usize> {
    let mask = match channels {
        Channels::Positioned(mask) => mask.bits(),
        _ => 0,
    };
    positions.iter().map(|position| (mask & (position.bits() - 1)).count_ones() as usize).collect()
}

/// Advanced Audio Coding (AAC) decoder.
///
/// Implements a decoder for Advanced Audio Decoding Low-Complexity (AAC-LC) as defined in
/// ISO/IEC 13818-7 and ISO/IEC 14496-3.
pub struct AacDecoder {
    // info: NACodecInfoRef,
    asc: AudioSpecificConfig,
    pairs: Vec<cpe::ChannelPair>,
    dsp: dsp::Dsp,
    sbinfo: GASubbandInfo,
    params: AudioCodecParameters,
    buf: AudioBuffer<f32>,
    // AudioGubbins: the elements a raw data block must carry, past two channels, and the output
    // plane of each channel in element order.
    elements: Option<&'static [Element]>,
    planes: Vec<usize>,
}

impl AacDecoder {
    pub fn try_new(params: &AudioCodecParameters, _opts: &AudioDecoderOptions) -> Result<Self> {
        // This decoder only supports AAC.
        if params.codec != CODEC_ID_AAC {
            return unsupported_error("aac: invalid codec");
        }

        // If extra data present, parse the audio specific config
        let asc = if let Some(extra_data_buf) = &params.extra_data {
            validate!(extra_data_buf.len() >= 2);
            AudioSpecificConfig::read(extra_data_buf)?
        }
        else {
            // Otherwise, assume there is no ASC and use the codec parameters for ADTS.
            let mut asc = AudioSpecificConfig::default();

            asc.object_type = AudioObjectType::Lc;
            asc.samples = 1024;

            asc.sample_rate = match params.sample_rate {
                Some(rate) => rate,
                None => return unsupported_error("aac: sample rate is required"),
            };

            asc.channels = params.channels.clone();

            asc
        };

        // The channel configuration must be known.
        //
        // TODO: Support getting this from program configuration element (PCE). However, this would
        // require deferring the rest of the initialization until the PCE has been read.
        let channels = match &asc.channels {
            Some(channels) => channels.clone(),
            _ => return unsupported_error("aac: channels or channel layout is required"),
        };

        // Check complexity.
        if asc.object_type != AudioObjectType::Lc || asc.sbr_present || asc.samples != 1024 {
            return unsupported_error("aac: aac too complex");
        }

        // AudioGubbins: past two channels, the channel configuration places each element's
        // channels; one and two channels keep the published crate's handling.
        let (elements, planes) = if channels.count() <= 2 {
            (None, (0..channels.count()).collect())
        }
        else {
            match configuration_of(&channels) {
                Some((elements, positions)) => (Some(elements), planes_of(&channels, positions)),
                None => return unsupported_error("aac: channel layout"),
            }
        };

        // Clone and amend the codec parameters with information from the extra data.
        let mut params = params.clone();

        params.with_channels(channels.clone()).with_sample_rate(asc.sample_rate);

        let sbinfo = GASubbandInfo::find(asc.sample_rate);

        let buf = AudioBuffer::new(AudioSpec::new(asc.sample_rate, channels), asc.samples);

        Ok(AacDecoder {
            asc,
            pairs: Vec::new(),
            dsp: dsp::Dsp::new(),
            sbinfo,
            params,
            buf,
            elements,
            planes,
        })
    }

    // AudioGubbins: an element other than the one the channel configuration places next is
    // refused, since its channels would be given to another speaker's plane.
    fn expect_element(&self, pair_no: usize, element: Element) -> Result<()> {
        if let Some(elements) = self.elements {
            validate!(elements.get(pair_no) == Some(&element));
        }
        Ok(())
    }

    fn set_pair(&mut self, pair_no: usize, channel: usize, pair: bool) -> Result<()> {
        if self.pairs.len() <= pair_no {
            self.pairs.push(cpe::ChannelPair::new(pair, channel, self.sbinfo));
        }
        else {
            validate!(self.pairs[pair_no].channel == channel);
            validate!(self.pairs[pair_no].is_pair == pair);
        }

        let max_channels = self.asc.channels.as_ref().map_or(0, |channels| channels.count());
        validate!(if pair { channel + 1 } else { channel } < max_channels);

        Ok(())
    }

    fn decode_ga<B: ReadBitsLtr + FiniteBitStream>(&mut self, bs: &mut B) -> Result<()> {
        let mut cur_pair = 0;
        let mut cur_ch = 0;
        while bs.bits_left() > 3 {
            let id = bs.read_bits_leq32(3)?;

            match id {
                0 => {
                    // ID_SCE
                    let _tag = bs.read_bits_leq32(4)?;
                    self.expect_element(cur_pair, Element::Single)?;
                    self.set_pair(cur_pair, cur_ch, false)?;
                    self.pairs[cur_pair].decode_ga_sce(bs, self.asc.object_type)?;
                    cur_pair += 1;
                    cur_ch += 1;
                }
                1 => {
                    // ID_CPE
                    let _tag = bs.read_bits_leq32(4)?;
                    self.expect_element(cur_pair, Element::Pair)?;
                    self.set_pair(cur_pair, cur_ch, true)?;
                    self.pairs[cur_pair].decode_ga_cpe(bs, self.asc.object_type)?;
                    cur_pair += 1;
                    cur_ch += 2;
                }
                2 => {
                    // ID_CCE
                    return unsupported_error("aac: coupling channel element");
                }
                3 => {
                    // ID_LFE
                    let _tag = bs.read_bits_leq32(4)?;
                    self.expect_element(cur_pair, Element::LowFrequency)?;
                    self.set_pair(cur_pair, cur_ch, false)?;
                    self.pairs[cur_pair].decode_ga_sce(bs, self.asc.object_type)?;
                    cur_pair += 1;
                    cur_ch += 1;
                }
                4 => {
                    // ID_DSE
                    let _id = bs.read_bits_leq32(4)?;
                    let align = bs.read_bool()?;
                    let mut count = bs.read_bits_leq32(8)?;
                    if count == 255 {
                        count += bs.read_bits_leq32(8)?;
                    }
                    if align {
                        bs.realign(); // ????
                    }
                    bs.ignore_bits(count * 8)?; // no SBR payload or such
                }
                5 => {
                    // ID_PCE
                    return unsupported_error("aac: program config");
                }
                6 => {
                    // ID_FIL
                    let mut count = bs.read_bits_leq32(4)? as usize;
                    if count == 15 {
                        count += bs.read_bits_leq32(8)? as usize;
                        count -= 1;
                    }

                    // Check if the ID_FIL element contains SBR data. Note that ID_FIL elements with
                    // SBR data may not contain other extension payloads.
                    if count > 0 {
                        let ext_type = bs.read_bits_leq32(4)?;

                        match ext_type {
                            // EXT_SBR_DATA (0xd)
                            // EXT_SBR_DATA_CRC (0xe)
                            0xd | 0xe => self.asc.sbr_present = true,
                            // EXT_FILL (0x0)
                            // EXT_FILL_DATA (0x1)
                            // EXT_DATA_ELEMENT (0x2)
                            // EXT_DYNAMIC_RANGE (0xb)
                            // EXT_SAC_DATA (0xc)
                            _ => (),
                        }

                        // Ignore extension payload(s).
                        bs.ignore_bits(4)?;
                        for _ in 0..count - 1 {
                            bs.ignore_bits(8)?;
                        }
                    }
                }
                7 => {
                    // ID_TERM
                    break;
                }
                _ => unreachable!(),
            };
        }
        let rate_idx = GASubbandInfo::find_idx(self.asc.sample_rate);
        for pair in 0..cur_pair {
            self.pairs[pair].synth_audio(&mut self.dsp, &mut self.buf, rate_idx, &self.planes);
        }
        Ok(())
    }

    // fn flush(&mut self) {
    //     for pair in self.pairs.iter_mut() {
    //         pair.ics[0].delay = [0.0; 1024];
    //         pair.ics[1].delay = [0.0; 1024];
    //     }
    // }

    fn decode_inner(&mut self, packet: &PacketRef<'_>) -> Result<()> {
        // Clear the audio output buffer.
        self.buf.clear();
        self.buf.render_uninit(None);

        let mut bs = BitReaderLtr::new(packet.data);

        // Choose decode step based on the object type.
        match self.asc.object_type {
            AudioObjectType::Lc => self.decode_ga(&mut bs)?,
            _ => return unsupported_error("aac: object type"),
        }

        Ok(())
    }
}

impl AudioDecoder for AacDecoder {
    fn reset(&mut self) {
        for pair in self.pairs.iter_mut() {
            pair.reset();
        }
    }

    fn codec_info(&self) -> &CodecInfo {
        // Only one codec is supported.
        &Self::supported_codecs().first().expect("at least one codec registered").info
    }

    fn codec_params(&self) -> &AudioCodecParameters {
        &self.params
    }

    fn decode_ref(&mut self, packet: &PacketRef<'_>) -> Result<GenericAudioBufferRef<'_>> {
        if let Err(e) = self.decode_inner(packet) {
            self.buf.clear();
            Err(e)
        }
        else {
            Ok(self.buf.as_generic_audio_buffer_ref())
        }
    }

    fn finalize(&mut self) -> FinalizeResult {
        Default::default()
    }

    fn last_decoded(&self) -> GenericAudioBufferRef<'_> {
        self.buf.as_generic_audio_buffer_ref()
    }
}

impl RegisterableAudioDecoder for AacDecoder {
    fn try_registry_new(
        params: &AudioCodecParameters,
        opts: &AudioDecoderOptions,
    ) -> Result<Box<dyn AudioDecoder>>
    where
        Self: Sized,
    {
        Ok(Box::new(AacDecoder::try_new(params, opts)?))
    }

    fn supported_codecs() -> &'static [SupportedAudioCodec] {
        use symphonia_core::codecs::audio::well_known::profiles::CODEC_PROFILE_AAC_LC;

        &[support_audio_codec!(
            CODEC_ID_AAC,
            "aac",
            "Advanced Audio Coding",
            &[codec_profile!(CODEC_PROFILE_AAC_LC, "aac-lc", "Low Complexity"),]
        )]
    }
}
