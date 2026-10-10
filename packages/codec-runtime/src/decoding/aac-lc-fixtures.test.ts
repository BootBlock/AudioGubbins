/**
 * The codec module's AAC-LC decoder on real files: FFmpeg's AAC encoder's
 * output in ADTS and in MP4, mono, stereo and every channel configuration
 * from 3 to 7 (`fixtures/aac-lc/README.md` holds how each was made). Nothing
 * here encodes AAC, so these files are stored rather than made as the test
 * runs.
 *
 * Each channel of a file is a sine of its own frequency and level from phase 0,
 * so each decoded channel is held to the tone its speaker was given, sample
 * for sample. That checks three things at once: the channels leave the module
 * in the speaker mask's order (ADR-0090); the priming an MP4 edit list states
 * is trimmed exactly, since a tone that starts early or late is out of phase
 * with its reference; and the length is the source's, not the encoder's whole
 * packets. ADTS states no priming, so its decoded stream keeps the encoder's
 * 1,024 leading frames and its last packet whole, and the tones begin after
 * them.
 */

import type { ContainerId } from '@audiogubbins/codecs';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { codecModule } from '../testing/codec-module.js';
import { decodeAll } from '../testing/export-encoding.js';
import { memoryBytes } from '../testing/memory-bytes.js';
import { readFile } from '../testing/node-files.js';

/** Where the fixtures are, from the repository's root, where the tests run. */
const FIXTURES = 'packages/codec-runtime/fixtures/aac-lc';

const RATE = 44_100;

/** The priming FFmpeg's AAC encoder writes, which its MP4 edit list states. */
const ENCODER_PRIMING = 1_024;

/** Frames an AAC-LC packet decodes to. */
const PACKET_FRAMES = 1_024;

/**
 * Frames left out at each end of the comparison, where the encoder's first
 * and last blocks spread a tone's onset and end.
 */
const EDGE = 2_048;

/**
 * The least each channel keeps of its tone. The weakest channel here decodes
 * at 24 dB; a channel decoded at another speaker's place, or a tone a
 * packet early or late, falls below 8 dB.
 */
const FLOOR_DB = 18;

/** A sine from phase 0: its level and frequency. */
interface Tone {
  readonly level: number;
  readonly hertz: number;
}

const tone = (level: number, hertz: number): Tone => ({ level, hertz });

/** The speakers of WAVE_FORMAT_EXTENSIBLE's mask. */
const FL = 0x1;
const FR = 0x2;
const FC = 0x4;
const LFE = 0x8;
const BL = 0x10;
const BR = 0x20;
const FLC = 0x40;
const FRC = 0x80;
const BC = 0x100;

/** The tones of 5.1, as FFmpeg's layout gives them: FL FR FC LFE BL BR. */
const SIX = [
  tone(0.5, 400),
  tone(0.4, 600),
  tone(0.3, 800),
  tone(0.5, 50),
  tone(0.25, 1_000),
  tone(0.2, 1_200),
] as const;

/** A file and what it must decode to. */
interface Fixture {
  readonly file: string;
  readonly container: ContainerId;
  /** The frames of the source the file was encoded from. */
  readonly frames: number;
  readonly mask: number;
  /** The tone of each decoded channel, in the mask's order. */
  readonly tones: readonly Tone[];
}

const FIXTURES_DECODED: readonly Fixture[] = [
  {
    file: 'aac-lc-mono.aac',
    container: 'adts',
    frames: RATE,
    mask: FC,
    tones: [tone(0.5, 440)],
  },
  {
    file: 'aac-lc-mono.m4a',
    container: 'mp4',
    frames: RATE,
    mask: FC,
    tones: [tone(0.5, 440)],
  },
  {
    file: 'aac-lc-stereo.aac',
    container: 'adts',
    frames: RATE,
    mask: FL | FR,
    tones: [tone(0.5, 440), tone(0.25, 1_000)],
  },
  {
    file: 'aac-lc-stereo.m4a',
    container: 'mp4',
    frames: RATE,
    mask: FL | FR,
    tones: [tone(0.5, 440), tone(0.25, 1_000)],
  },
  {
    file: 'aac-lc-3.0.aac',
    container: 'adts',
    frames: RATE / 4,
    mask: FL | FR | FC,
    tones: SIX.slice(0, 3),
  },
  {
    file: 'aac-lc-4.0.aac',
    container: 'adts',
    frames: RATE / 4,
    mask: FL | FR | FC | BC,
    tones: [...SIX.slice(0, 3), tone(0.25, 1_000)],
  },
  {
    file: 'aac-lc-5.0.aac',
    container: 'adts',
    frames: RATE / 4,
    mask: FL | FR | FC | BL | BR,
    tones: [...SIX.slice(0, 3), ...SIX.slice(4)],
  },
  {
    file: 'aac-lc-5.1.aac',
    container: 'adts',
    frames: RATE,
    mask: FL | FR | FC | LFE | BL | BR,
    tones: SIX,
  },
  {
    file: 'aac-lc-5.1.m4a',
    container: 'mp4',
    frames: RATE,
    mask: FL | FR | FC | LFE | BL | BR,
    tones: SIX,
  },
  {
    // Configuration 7's second channel pair is the outside-front pair, where
    // FFmpeg 5.1 put 7.1's side pair (1,400 and 1,600 Hz), and its first the
    // centre-front pair, where FFmpeg put the front pair (400 and 600 Hz).
    file: 'aac-lc-7.1.aac',
    container: 'adts',
    frames: RATE / 4,
    mask: FL | FR | FC | LFE | BL | BR | FLC | FRC,
    tones: [tone(0.2, 1_400), tone(0.2, 1_600), ...SIX.slice(2), tone(0.5, 400), tone(0.4, 600)],
  },
];

/**
 * The signal-to-noise ratio, in decibels, of `plane` against `wanted` begun
 * at frame `start`, over the source's frames but `EDGE` at each end.
 */
function toneSnrDb(plane: Float32Array, wanted: Tone, start: number, frames: number): number {
  let signal = 0;
  let noise = 0;
  for (let frame = EDGE; frame < frames - EDGE; frame += 1) {
    const reference = wanted.level * Math.sin((2 * Math.PI * wanted.hertz * frame) / RATE);
    signal += reference * reference;
    noise += ((plane[start + frame] ?? 0) - reference) ** 2;
  }
  return 10 * Math.log10(signal / noise);
}

describe('the codec module’s AAC-LC decoder on files FFmpeg encoded', () => {
  it.each(FIXTURES_DECODED)(
    'decodes $file to its tones, in speaker-mask order',
    async (fixture) => {
      const module = await codecModule();
      const session = expectSuccess(
        module.openDecoder(memoryBytes(readFile(`${FIXTURES}/${fixture.file}`))),
      );
      const { description } = session;
      expect(description).toMatchObject({
        codec: 'aac-lc',
        container: fixture.container,
        sampleRate: RATE,
        channelCount: fixture.tones.length,
        layout: { kind: 'speakers', mask: fixture.mask },
        decodable: true,
      });
      const decoded = decodeAll(session);
      session.release();

      // An MP4 edit list states the priming and the length, both trimmed; ADTS
      // states neither, so every frame of every packet is decoded.
      const packets = Math.ceil((fixture.frames + ENCODER_PRIMING) / PACKET_FRAMES);
      const start = fixture.container === 'mp4' ? 0 : ENCODER_PRIMING;
      if (fixture.container === 'mp4') {
        expect(description.priming).toBe(ENCODER_PRIMING);
        expect(description.totalFrames).toBe(fixture.frames);
      } else {
        expect(description.priming).toBeUndefined();
      }
      const length = fixture.container === 'mp4' ? fixture.frames : packets * PACKET_FRAMES;
      expect(decoded.map((plane) => plane.length)).toEqual(fixture.tones.map(() => length));

      const errors = fixture.tones.map((wanted, channel) =>
        toneSnrDb(decoded[channel] ?? new Float32Array(), wanted, start, fixture.frames),
      );
      for (const error of errors) expect(error).toBeGreaterThan(FLOOR_DB);
    },
  );

  it('refuses a stream whose elements are not the ones its channel configuration places', async () => {
    // 4.0's elements (single, pair, single) under configuration 5's header,
    // which places a pair third: the last single channel would reach the rear
    // left alone, and the rear right would be silent.
    const file = readFile(`${FIXTURES}/aac-lc-4.0.aac`);
    const configuration = 5;
    for (let at = 0; at < file.length;) {
      // The channel configuration's three bits straddle each header's third and
      // fourth bytes; the frame's length, header included, is the next 13 bits.
      file[at + 2] = ((file[at + 2] ?? 0) & 0xfe) | (configuration >> 2);
      file[at + 3] = ((file[at + 3] ?? 0) & 0x3f) | ((configuration & 0x3) << 6);
      const length =
        (((file[at + 3] ?? 0) & 0x3) << 11) |
        ((file[at + 4] ?? 0) << 3) |
        ((file[at + 5] ?? 0) >> 5);
      expect(length).toBeGreaterThan(7);
      at += length;
    }
    const module = await codecModule();
    const session = expectSuccess(module.openDecoder(memoryBytes(file)));
    expect(session.description.channelCount).toBe(5);
    const block = Array.from({ length: 5 }, () => new Float32Array(PACKET_FRAMES));
    const decoded = session.decode(block);
    session.release();
    expect(decoded).toMatchObject({ ok: false, failures: [{ code: 'codec-runtime.malformed' }] });
  });
});
