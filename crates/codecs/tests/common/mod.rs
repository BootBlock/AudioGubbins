//! What the codec tests generate their files with: no binary fixture is
//! committed (REQ-REPO-191), so each file is made here, deterministically.

#![allow(dead_code, reason = "each test file uses some of these")]
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_precision_loss,
    reason = "test signals and files of small, known ranges"
)]

use audiogubbins_codecs::{
    ByteSource, CodecFailure, DecodeSession, FlacFrameEncoder, FlacSettings, OpusEncoder,
    OpusSettings, ReadFailure,
};

/// Bytes in memory read as a file.
pub struct MemorySource(pub Vec<u8>);

impl ByteSource for MemorySource {
    fn size(&self) -> u64 {
        self.0.len() as u64
    }

    fn read_at(&mut self, offset: u64, into: &mut [u8]) -> Result<usize, ReadFailure> {
        let start = usize::try_from(offset).map_err(|_| ReadFailure::Unreadable)?;
        let available = self.0.get(start..).unwrap_or(&[]);
        let count = available.len().min(into.len());
        into[..count].copy_from_slice(&available[..count]);
        Ok(count)
    }
}

/// A deterministic generator of pseudo-random numbers: the 64-bit linear
/// congruential generator of Knuth's MMIX.
pub struct Lcg(pub u64);

impl Lcg {
    pub fn next_u32(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 32) as u32
    }

    /// A number below `bound`.
    pub fn below(&mut self, bound: usize) -> usize {
        ((u64::from(self.next_u32()) * bound as u64) >> 32) as usize
    }
}

/// Integer samples of `bits` bits: a sine of `cycles` cycles over `frames`,
/// at three quarters of full scale, with noise of a few steps.
pub fn integer_signal(frames: usize, cycles: f64, bits: u8, seed: u64) -> Vec<i32> {
    let peak = f64::from((1i32 << (bits - 1)) - 1) * 0.75;
    let mut noise = Lcg(seed);
    (0..frames)
        .map(|frame| {
            let phase = std::f64::consts::TAU * cycles * frame as f64 / frames as f64;
            (phase.sin() * peak).round() as i32 + (noise.below(7) as i32 - 3)
        })
        .collect()
}

/// A sine of `frequency` hertz at `rate`, of amplitude `amplitude`.
pub fn sine(frames: usize, frequency: f64, rate: f64, amplitude: f64) -> Vec<f32> {
    (0..frames)
        .map(|frame| {
            (amplitude * (std::f64::consts::TAU * frequency * frame as f64 / rate).sin()) as f32
        })
        .collect()
}

/// A native FLAC stream of `planes` encoded by the module's frame encoder:
/// the signature, STREAMINFO with no MD5 (which FLAC allows), and the frames.
pub fn flac_stream(settings: FlacSettings, planes: &[Vec<i32>]) -> Vec<u8> {
    let mut encoder = FlacFrameEncoder::new(settings).expect("valid settings");
    let total = planes[0].len();
    let block = settings.block_size as usize;
    let mut frames = Vec::new();
    let (mut min_frame, mut max_frame) = (u32::MAX, 0u32);
    for (number, start) in (0..total).step_by(block).enumerate() {
        let end = (start + block).min(total);
        let slices: Vec<&[i32]> = planes.iter().map(|plane| &plane[start..end]).collect();
        let bytes = encoder
            .encode(
                &slices,
                end - start,
                u32::try_from(number).expect("few frames"),
            )
            .expect("encodable frame")
            .to_vec();
        min_frame = min_frame.min(bytes.len() as u32);
        max_frame = max_frame.max(bytes.len() as u32);
        frames.extend(bytes);
    }
    let mut stream = b"fLaC".to_vec();
    // The last metadata block, of type STREAMINFO, 34 bytes.
    stream.extend_from_slice(&[0x80, 0, 0, 34]);
    let block16 = u16::try_from(block).expect("a FLAC block size");
    stream.extend_from_slice(&block16.to_be_bytes());
    stream.extend_from_slice(&block16.to_be_bytes());
    stream.extend_from_slice(&min_frame.to_be_bytes()[1..]);
    stream.extend_from_slice(&max_frame.to_be_bytes()[1..]);
    let packed = (u64::from(settings.sample_rate) << 44)
        | (u64::from(settings.channels - 1) << 41)
        | (u64::from(settings.bits_per_sample - 1) << 36)
        | total as u64;
    stream.extend_from_slice(&packed.to_be_bytes());
    stream.extend_from_slice(&[0; 16]);
    stream.extend(frames);
    stream
}

/// The CRC of an Ogg page: polynomial 0x04c11db7, unreflected, from zero.
fn ogg_crc(bytes: &[u8]) -> u32 {
    let mut crc = 0u32;
    for &byte in bytes {
        crc ^= u32::from(byte) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04c1_1db7
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// One Ogg page of whole packets.
fn ogg_page(serial: u32, sequence: u32, granule: u64, flags: u8, packets: &[&[u8]]) -> Vec<u8> {
    let mut lacing = Vec::new();
    for packet in packets {
        lacing.extend(std::iter::repeat_n(255u8, packet.len() / 255));
        lacing.push((packet.len() % 255) as u8);
    }
    let mut page = b"OggS".to_vec();
    page.push(0);
    page.push(flags);
    page.extend_from_slice(&granule.to_le_bytes());
    page.extend_from_slice(&serial.to_le_bytes());
    page.extend_from_slice(&sequence.to_le_bytes());
    page.extend_from_slice(&[0; 4]);
    page.push(u8::try_from(lacing.len()).expect("a page of few packets"));
    page.extend(lacing);
    for packet in packets {
        page.extend_from_slice(packet);
    }
    let crc = ogg_crc(&page);
    page[22..26].copy_from_slice(&crc.to_le_bytes());
    page
}

/// An Ogg Opus file of `planes` encoded by the module's Opus encoder, its
/// granule positions written as RFC 7845 asks: each audio page's is the
/// pre-skip and every frame of its packets, and the last page's the end
/// granule, which trims the final packet's padding.
pub fn ogg_opus(settings: OpusSettings, planes: &[Vec<f32>]) -> Vec<u8> {
    let mut encoder = OpusEncoder::new(settings).expect("valid settings");
    // Pushed in uneven blocks, as a renderer's might arrive.
    let total = planes[0].len();
    let mut start = 0;
    let mut sizes = Lcg(7);
    while start < total {
        let end = (start + 100 + sizes.below(3000)).min(total);
        let slices: Vec<&[f32]> = planes.iter().map(|plane| &plane[start..end]).collect();
        encoder
            .push(&slices, end - start)
            .expect("pushable samples");
        start = end;
    }
    encoder.finish().expect("finishable");
    let serial = 0x5eed;
    let mut file = ogg_page(serial, 0, 0, 0x02, &[&encoder.head().to_bytes()]);
    let tags = b"OpusTags\x08\0\0\0testcase\0\0\0\0";
    file.extend(ogg_page(serial, 1, 0, 0, &[tags]));
    let mut packets = Vec::new();
    while let Some(packet) = encoder.next_packet() {
        packets.push(packet);
    }
    let mut granule = u64::from(encoder.head().pre_skip);
    let pages: Vec<_> = packets.chunks(10).collect();
    for (index, page) in pages.iter().enumerate() {
        granule += page
            .iter()
            .map(|packet| u64::from(packet.frames))
            .sum::<u64>();
        let last = index + 1 == pages.len();
        let position = if last { encoder.end_granule() } else { granule };
        let bytes: Vec<&[u8]> = page.iter().map(|packet| packet.bytes.as_slice()).collect();
        let sequence = u32::try_from(index + 2).expect("few pages");
        file.extend(ogg_page(
            serial,
            sequence,
            position,
            if last { 0x04 } else { 0 },
            &bytes,
        ));
    }
    file
}

/// Every frame a session decodes, one plane per channel.
pub fn decode_all(session: &mut DecodeSession) -> Result<Vec<Vec<f32>>, CodecFailure> {
    let channels = session.description().channel_count as usize;
    let mut planes = vec![Vec::new(); channels];
    let capacity = 1_000;
    let mut block = vec![vec![0.0f32; capacity]; channels];
    loop {
        let frames = session.decode_into(capacity, block.iter_mut().map(Vec::as_mut_slice))?;
        if frames == 0 {
            return Ok(planes);
        }
        for (plane, decoded) in planes.iter_mut().zip(&block) {
            plane.extend_from_slice(&decoded[..frames]);
        }
    }
}

/// Opens `bytes` and decodes every frame.
pub fn open_and_decode(bytes: Vec<u8>) -> Result<(DecodeSession, Vec<Vec<f32>>), CodecFailure> {
    let mut session = DecodeSession::open(MemorySource(bytes))?;
    let planes = decode_all(&mut session)?;
    Ok((session, planes))
}

/// Bits written most significant first.
#[derive(Default)]
pub struct Bits(pub Vec<bool>);

impl Bits {
    pub fn put(&mut self, value: u32, count: usize) -> &mut Self {
        for bit in (0..count).rev() {
            self.0.push((value >> bit) & 1 == 1);
        }
        self
    }

    pub fn bytes(&self) -> Vec<u8> {
        self.0
            .chunks(8)
            .map(|chunk| {
                chunk.iter().enumerate().fold(0u8, |byte, (index, &bit)| {
                    byte | (u8::from(bit) << (7 - index))
                })
            })
            .collect()
    }
}

/// `count` MPEG-1 Layer III frames of silence at 128 kbit/s, 44.1 kHz, in
/// stereo or, where `mono`, one channel: a header, side information of no
/// bits for every granule, and main data of zeros.
pub fn silent_mp3(count: usize, mono: bool) -> Vec<u8> {
    let frame_length = 144 * 128_000 / 44_100;
    let mut frame = vec![0u8; frame_length];
    let mode = if mono { 0xc0 } else { 0x00 };
    frame[..4].copy_from_slice(&[0xff, 0xfb, 0x90, mode]);
    frame.repeat(count)
}

/// The encoder priming and padding the LAME tag of [`lame_mp3`] states.
pub const LAME_PRIMING: u32 = 576;
pub const LAME_PADDING: u32 = 1_000;

/// [`silent_mp3`]'s stereo frames after an `Info` frame whose Xing tag
/// counts them and whose LAME extension states [`LAME_PRIMING`] and
/// [`LAME_PADDING`], with a tag CRC of 0, which readers take as unchecked.
pub fn lame_mp3(count: usize) -> Vec<u8> {
    let mut info = silent_mp3(1, false);
    let mut tag = b"Info".to_vec();
    // Flags: the frame count alone.
    tag.extend_from_slice(&1u32.to_be_bytes());
    tag.extend_from_slice(&u32::try_from(count).unwrap_or(0).to_be_bytes());
    tag.extend_from_slice(b"LAME3.100");
    // Revision, lowpass, peak, two replay gains, flags and bit rate.
    tag.extend_from_slice(&[0; 1 + 1 + 4 + 2 + 2 + 1 + 1]);
    // The delay and padding, each less the decoder's 529 frames, in 12 bits.
    let trim = ((LAME_PRIMING - 529) << 12) | (LAME_PADDING + 529);
    tag.extend_from_slice(&trim.to_be_bytes()[1..]);
    // The rest of the extension, ending in its CRC.
    tag.extend_from_slice(&[0; 12]);
    info[36..36 + tag.len()].copy_from_slice(&tag);
    info.extend(silent_mp3(count, false));
    info
}

/// A raw data block of AAC-LC: a channel pair of no scale factor bands, so
/// silence, then fill elements given as (count, first payload nibble), then
/// `ID_END`.
pub fn silent_block(fills: &[(u32, u32)]) -> Vec<u8> {
    let mut bits = Bits::default();
    // ID_CPE, its tag, a common window, and the window's information: a long
    // window of no bands and no prediction; then no mid/side mask.
    bits.put(1, 3).put(0, 4).put(1, 1);
    bits.put(0, 1).put(0, 2).put(0, 1).put(0, 6).put(0, 1);
    bits.put(0, 2);
    for _ in 0..2 {
        // A global gain, then no sections, pulses, TNS or gain control.
        bits.put(100, 8).put(0, 1).put(0, 1).put(0, 1);
    }
    for &(count, nibble) in fills {
        bits.put(6, 3).put(count, 4);
        if count > 0 {
            bits.put(nibble, 4).put(0x5, 4);
            for _ in 1..count {
                bits.put(0xa5, 8);
            }
        }
    }
    bits.put(7, 3);
    bits.bytes()
}

/// `count` ADTS frames of AAC-LC stereo at the rate of `rate_index`, each
/// holding `block`.
pub fn adts(count: usize, rate_index: u32, block: &[u8]) -> Vec<u8> {
    let length = u32::try_from(7 + block.len()).unwrap_or(0);
    let mut header = Bits::default();
    header.put(0xfff, 12).put(0, 1).put(0, 2).put(1, 1);
    header.put(1, 2).put(rate_index, 4).put(0, 1).put(2, 3);
    header.put(0, 4).put(length, 13).put(0x7ff, 11).put(0, 2);
    let mut frame = header.bytes();
    frame.extend_from_slice(block);
    frame.repeat(count)
}
