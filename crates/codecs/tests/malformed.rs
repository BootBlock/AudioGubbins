//! Malformed, truncated and hostile files fail without panicking, in bounded
//! time (REQ-EXEC-136): in WebAssembly a panic traps and loses the module, and
//! a file is untrusted. Each valid file is generated, then mutated a few
//! hundred deterministic ways.

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    reason = "test signals and files of small, known ranges"
)]

mod common;

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::{Duration, Instant};

use audiogubbins_codecs::{
    ByteSource, CodecFailure, DecodeSession, FlacSettings, OpusApplication, OpusFrameDuration,
    OpusRateControl, OpusSettings, ReadFailure,
};
use common::{
    Lcg, MemorySource, adts, decode_all, flac_stream, integer_signal, ogg_opus, open_and_decode,
    silent_block, silent_mp3, sine,
};

/// Mutations of each file.
const MUTATIONS: usize = 300;

/// The most one mutated file may take to open and decode, in an unoptimised
/// build: far past what a valid file of this size takes.
const PATIENCE: Duration = Duration::from_secs(5);

fn flac() -> Vec<u8> {
    let settings = FlacSettings {
        channels: 2,
        bits_per_sample: 16,
        sample_rate: 44_100,
        block_size: 1_024,
        level: 5,
    };
    let planes: Vec<Vec<i32>> = (0..2)
        .map(|channel| integer_signal(3_000, 4.0, 16, channel))
        .collect();
    flac_stream(settings, &planes)
}

fn opus() -> Vec<u8> {
    let settings = OpusSettings {
        sample_rate: 48_000,
        channels: 2,
        bit_rate: 64_000,
        application: OpusApplication::Audio,
        frame_duration: OpusFrameDuration::Ms20,
        complexity: 5,
        rate_control: OpusRateControl::Variable,
        input_sample_rate: 0,
    };
    let planes = vec![
        sine(9_600, 440.0, 48_000.0, 0.5),
        sine(9_600, 660.0, 48_000.0, 0.5),
    ];
    ogg_opus(settings, &planes)
}

/// One deterministic mutation of `file`.
fn mutate(file: &[u8], random: &mut Lcg) -> Vec<u8> {
    let mut bytes = file.to_vec();
    match random.below(5) {
        // Bytes changed at random.
        0 => {
            for _ in 0..=random.below(8) {
                let at = random.below(bytes.len());
                bytes[at] = random.next_u32() as u8;
            }
        }
        // Truncated anywhere.
        1 => bytes.truncate(random.below(bytes.len())),
        // Bytes inserted.
        2 => {
            let at = random.below(bytes.len());
            let inserted: Vec<u8> = (0..=random.below(64))
                .map(|_| random.next_u32() as u8)
                .collect();
            bytes.splice(at..at, inserted);
        }
        // A run zeroed.
        3 => {
            let at = random.below(bytes.len());
            let end = (at + random.below(256)).min(bytes.len());
            bytes[at..end].fill(0);
        }
        // A run of the header region set to all ones, where the lengths are.
        _ => {
            let at = random.below(bytes.len().min(160));
            let end = (at + 1 + random.below(6)).min(bytes.len());
            bytes[at..end].fill(0xff);
        }
    }
    bytes
}

/// Opens and decodes every mutation, answering the seeds of any that
/// panicked or ran past patience.
fn survivors_of(file: &[u8], seed: u64) -> Vec<String> {
    let mut random = Lcg(seed);
    let mut faults = Vec::new();
    for index in 0..MUTATIONS {
        let mutated = mutate(file, &mut random);
        let start = Instant::now();
        let outcome = catch_unwind(AssertUnwindSafe(|| open_and_decode(mutated).map(|_| ())));
        let elapsed = start.elapsed();
        if outcome.is_err() {
            faults.push(format!("mutation {index} of seed {seed} panicked"));
        } else if elapsed > PATIENCE {
            faults.push(format!("mutation {index} of seed {seed} took {elapsed:?}"));
        }
    }
    faults
}

#[test]
fn mutated_flac_fails_or_decodes_without_panicking() {
    assert_eq!(survivors_of(&flac(), 1), Vec::<String>::new());
}

#[test]
fn mutated_ogg_opus_fails_or_decodes_without_panicking() {
    assert_eq!(survivors_of(&opus(), 2), Vec::<String>::new());
}

#[test]
fn mutated_mp3_fails_or_decodes_without_panicking() {
    assert_eq!(survivors_of(&silent_mp3(12), 4), Vec::<String>::new());
}

#[test]
fn mutated_adts_fails_or_decodes_without_panicking() {
    assert_eq!(
        survivors_of(&adts(12, 4, &silent_block(&[(6, 0xd)])), 5),
        Vec::<String>::new()
    );
    assert_eq!(
        survivors_of(&adts(12, 4, &silent_block(&[])), 6),
        Vec::<String>::new()
    );
}

#[test]
fn a_flac_stream_cut_short_of_its_stated_length_is_refused_whole() {
    let mut file = flac();
    file.truncate(file.len() * 2 / 3);
    let mut session = DecodeSession::open(MemorySource(file)).expect("the header is whole");
    assert_eq!(
        decode_all(&mut session).err(),
        Some(CodecFailure::Malformed)
    );
    // A failed session keeps failing.
    assert_eq!(
        decode_all(&mut session).err(),
        Some(CodecFailure::Malformed)
    );
}

#[test]
fn bytes_of_no_container_are_unrecognised() {
    let mut random = Lcg(3);
    let noise: Vec<u8> = (0..64 * 1_024).map(|_| random.next_u32() as u8).collect();
    for file in [noise, Vec::new(), b"RIFF\0\0\0\0WAVE".to_vec()] {
        assert_eq!(
            open_and_decode(file).err(),
            Some(CodecFailure::Unrecognised)
        );
    }
}

/// A file whose host stops answering, or answers short, after `good` bytes.
struct Failing {
    bytes: Vec<u8>,
    good: usize,
    failure: ReadFailure,
}

impl ByteSource for Failing {
    fn size(&self) -> u64 {
        self.bytes.len() as u64
    }

    fn read_at(&mut self, offset: u64, into: &mut [u8]) -> Result<usize, ReadFailure> {
        let start = usize::try_from(offset).map_err(|_| ReadFailure::Unreadable)?;
        if start + into.len() > self.good {
            return match self.failure {
                ReadFailure::Unreadable => Err(ReadFailure::Unreadable),
                // Answers fewer bytes than are there.
                ReadFailure::Changed => Ok(0),
            };
        }
        into.copy_from_slice(&self.bytes[start..start + into.len()]);
        Ok(into.len())
    }
}

#[test]
fn a_read_that_fails_part_way_fails_the_session_with_its_reason() {
    for failure in [ReadFailure::Unreadable, ReadFailure::Changed] {
        let bytes = flac();
        let good = bytes.len() / 2;
        let outcome = DecodeSession::open(Failing {
            bytes,
            good,
            failure,
        })
        .and_then(|mut session| decode_all(&mut session));
        let expected = match failure {
            ReadFailure::Unreadable => CodecFailure::Unreadable,
            ReadFailure::Changed => CodecFailure::Changed,
        };
        assert_eq!(outcome.err(), Some(expected));
    }
}
