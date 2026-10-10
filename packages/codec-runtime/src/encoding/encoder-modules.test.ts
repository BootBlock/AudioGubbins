/**
 * The encoder modules as the codec worker instantiates them (ADR-0091): the
 * exact WASI functions each imports, which the host gives and no more; the
 * version of each interface, a module of another refused; and the bit rates
 * their descriptors state (`CodecDirection.bitRates`), held to what LAME and
 * libvorbis themselves take, so validation refuses exactly what an encoder
 * would replace or refuse.
 */

import {
  averageBitRateRanges,
  codecDescriptor,
  constantBitRates,
  type CodecDirection,
} from '@audiogubbins/codecs';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { encoderModuleBytes } from '../testing/encoder-modules.js';
import { ENCODER_MODULE_IMPORTS } from './encoder-host.js';
import { instantiateEncoderModule } from './encoder-module.js';
import { LameModule } from './lame-module.js';
import { LibvorbisModule } from './libvorbis-module.js';

/** The checks run every rate and channel count, in WebAssembly. */
const SWEEP_TIMEOUT_MS = 60_000;

const importsOf = (name: 'mp3' | 'vorbis'): string[] =>
  WebAssembly.Module.imports(new WebAssembly.Module(encoderModuleBytes(name)))
    .map((one) => `${one.module}.${one.name}`)
    .toSorted();

/**
 * A module of the MP3 interface's shape that states version 2: its memory, an
 * `_initialize` that does nothing, and `ag_mp3_abi_version` answering 2.
 */
const OTHER_VERSION = Uint8Array.from([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  // Types: () -> i32, () -> ().
  0x01,
  0x08,
  0x02,
  0x60,
  0x00,
  0x01,
  0x7f,
  0x60,
  0x00,
  0x00,
  // Functions of those types.
  0x03,
  0x03,
  0x02,
  0x00,
  0x01,
  // One page of memory.
  0x05,
  0x03,
  0x01,
  0x00,
  0x01,
  // Exports: memory, ag_mp3_abi_version, _initialize.
  0x07,
  0x2d,
  0x03,
  0x06,
  ...Array.from('memory', (c) => c.charCodeAt(0)),
  0x02,
  0x00,
  0x12,
  ...Array.from('ag_mp3_abi_version', (c) => c.charCodeAt(0)),
  0x00,
  0x00,
  0x0b,
  ...Array.from('_initialize', (c) => c.charCodeAt(0)),
  0x00,
  0x01,
  // Code: i32.const 2; and nothing.
  0x0a,
  0x09,
  0x02,
  0x04,
  0x00,
  0x41,
  0x02,
  0x0b,
  0x02,
  0x00,
  0x0b,
]);

/** Each MPEG version's Layer III bit rates by index, as a frame header states them. */
const MPEG1_TABLE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_TABLE = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** The bit rate the first frame of LAME's output states. */
function firstFrameBitRate(bytes: Uint8Array): number | undefined {
  const version = ((bytes[1] ?? 0) >>> 3) & 3;
  const index = (bytes[2] ?? 0) >>> 4;
  return (version === 3 ? MPEG1_TABLE : MPEG2_TABLE)[index];
}

const MP3_RATES = [8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000];

/** Rates at and around libvorbis's template boundaries, and the common ones. */
const VORBIS_RATES = [
  8_000, 8_500, 9_000, 11_025, 15_000, 16_000, 19_000, 22_050, 26_000, 32_000, 40_000, 44_100,
  48_000, 50_000, 64_000, 70_000, 96_000, 192_000,
];

const writing = (codec: 'mp3' | 'vorbis'): CodecDirection => {
  const direction = codecDescriptor(codec).write;
  if (direction === undefined) throw new Error(`${codec} is written`);
  return direction;
};

describe('the encoder modules', () => {
  it('import only the WASI functions the host gives, and each exactly these', () => {
    expect(importsOf('mp3')).toEqual([
      'wasi_snapshot_preview1.fd_close',
      'wasi_snapshot_preview1.fd_seek',
      'wasi_snapshot_preview1.fd_write',
      'wasi_snapshot_preview1.proc_exit',
    ]);
    expect(importsOf('vorbis')).toEqual(['wasi_snapshot_preview1.proc_exit']);
    for (const name of [...importsOf('mp3'), ...importsOf('vorbis')]) {
      expect(ENCODER_MODULE_IMPORTS).toContain(name);
    }
  });

  it('refuse a module whose interface is of another version, or of another encoder', async () => {
    const other = await instantiateEncoderModule('mp3', OTHER_VERSION, []);
    expect(expectFailureCode(other)).toBe('codec-runtime.encoder-module-refused');
    expect(other.ok ? '' : other.failures[0].summary).toBe(
      "The mp3 encoder module's interface is version 2, not 1.",
    );
    expect(expectFailureCode(await LameModule.instantiate(encoderModuleBytes('vorbis')))).toBe(
      'codec-runtime.encoder-module-refused',
    );
  });

  it('name the libraries they are built from', async () => {
    expect(expectSuccess(await LameModule.instantiate(encoderModuleBytes('mp3'))).version).toBe(
      '3.100',
    );
    expect(
      expectSuccess(await LibvorbisModule.instantiate(encoderModuleBytes('vorbis'))).version,
    ).toBe('Xiph.Org libVorbis 1.3.7');
  });

  it('answer an encoder’s refusal of its settings as the module’s failure', async () => {
    const libvorbis = expectSuccess(
      await LibvorbisModule.instantiate(encoderModuleBytes('vorbis')),
    );
    const refused = libvorbis.open(2, 96_000, { mode: 'bit-rate', nominalBitRate: 128 });
    expect(expectFailureCode(refused)).toBe('codec-runtime.encoder-module-failed');
  });
});

describe('the bit rates the descriptors state', () => {
  it(
    'are the constant bit rates LAME codes at every rate, each kept as asked',
    async () => {
      const lame = expectSuccess(await LameModule.instantiate(encoderModuleBytes('mp3')));
      const noise = Float32Array.from({ length: 4_096 }, (_, index) => Math.sin(index * 1.7) * 0.5);
      for (const sampleRate of MP3_RATES) {
        for (const channels of [1, 2]) {
          const rates = constantBitRates(writing('mp3'), { sampleRate, channels }) ?? [];
          expect(rates.length).toBeGreaterThan(0);
          for (const bitRate of rates) {
            const encoder = expectSuccess(
              lame.open(channels, sampleRate, { mode: 'constant', bitRate }),
            );
            const planes = Array.from({ length: channels }, () => noise);
            // At the lowest rates LAME holds a block's frames back until the stream ends.
            const units = [
              ...expectSuccess(encoder.encode(planes, noise.length)),
              ...expectSuccess(encoder.flush()),
            ];
            encoder.release();
            expect([sampleRate, channels, firstFrameBitRate(units[0] ?? new Uint8Array())]).toEqual(
              [sampleRate, channels, bitRate],
            );
          }
        }
      }
    },
    SWEEP_TIMEOUT_MS,
  );

  it(
    'are the nominal bit rates libvorbis takes, at every rate and channel count, and no others',
    async () => {
      const libvorbis = expectSuccess(
        await LibvorbisModule.instantiate(encoderModuleBytes('vorbis')),
      );
      const takes = (channels: number, sampleRate: number, nominalBitRate: number): boolean => {
        const opened = libvorbis.open(channels, sampleRate, { mode: 'bit-rate', nominalBitRate });
        if (opened.ok) opened.value.release();
        return opened.ok;
      };
      const disagreements: string[] = [];
      for (let channels = 1; channels <= 8; channels += 1) {
        for (const sampleRate of VORBIS_RATES) {
          const ranges = averageBitRateRanges(writing('vorbis'), { sampleRate, channels });
          const stream = `${String(channels)} channels at ${String(sampleRate)} Hz`;
          if (ranges.length === 0 && takes(channels, sampleRate, 64 * channels)) {
            disagreements.push(
              `${stream}: libvorbis takes a bit rate the descriptor states none of`,
            );
          }
          for (const { minimum, maximum } of ranges) {
            for (const [kbps, taken] of [
              [minimum - 1, false],
              [minimum, true],
              [maximum, true],
              [maximum + 1, false],
            ] as const) {
              const inAnother = ranges.some(
                (range) => kbps >= range.minimum && kbps <= range.maximum,
              );
              if (kbps > 0 && takes(channels, sampleRate, kbps) !== (taken || inAnother)) {
                disagreements.push(`${stream}: ${String(kbps)} kbit/s`);
              }
            }
          }
        }
      }
      expect(disagreements).toEqual([]);
    },
    SWEEP_TIMEOUT_MS,
  );
});
