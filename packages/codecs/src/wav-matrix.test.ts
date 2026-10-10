/**
 * The WAV matrix (Phase 09's acceptance criterion): every sample format the WAV
 * writer writes, at rates from 8 kHz to 384 kHz, for 1, 2, 6, 8, 12, 16 and 24
 * channels, written block by block, opened by `openAudio` and read back.
 *
 * Integer PCM reads back as the quantisation rule gives it and floating point
 * bit for bit. G.711 reads back as the law's expansion of its compression of
 * each 16-bit sample, and ADPCM as the reference decoders of `testing/` decode
 * the bytes written, so the writer is held to the standards' decoders rather
 * than to its package's own, and to a bound on how far its coding strays.
 */

import {
  discreteLayout,
  sampleRate,
  StandardLayouts,
  type ChannelLayout,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { compressAlaw, compressUlaw } from './g711.js';
import { openAudio, type AudioFormatDescriptor } from './index.js';
import { quantiseSample } from './sample-quantisation.js';
import { memoryBytes, writeWhole } from './testing/index.js';
import {
  referenceAlaw,
  referenceImaWav,
  referenceMs,
  referenceUlaw,
} from './testing/reference-decoders.js';
import { referenceImaWavEncode } from './testing/reference-encoders.js';
import { createWavWriter, type WavSampleFormat } from './wav-file-writer.js';

/**
 * A sine of each channel's own frequency, the same fraction of every rate, with
 * steps past full scale that every coder must clamp.
 */
function testSignal(channels: number, frames: number): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length: frames }, (_, frame) => {
      if (frame % 997 === 3) return 1.25;
      if (frame % 997 === 4) return -1.25;
      return 0.8 * Math.sin((2 * Math.PI * (110 + 37 * channel) * frame) / 48_000);
    }),
  );
}

/** Writes `channels` in blocks of 777 frames, which no block code's block divides. */
async function writeFile(
  format: WavSampleFormat,
  rate: number,
  layout: ChannelLayout,
  channels: readonly Float32Array[],
) {
  const opened = expectSuccess(
    createWavWriter({
      form: 'riff',
      sampleRate: expectSuccess(sampleRate(rate)),
      layout,
      sampleFormat: format,
      metadata: {},
    }),
  );
  const { file } = await writeWhole(opened.writer, channels, 777);
  return { file, layout: opened.layout };
}

/** The 16-bit samples a channel quantises to, which G.711 and ADPCM code. */
const linear16 = (channel: Float32Array) =>
  Array.from(channel, (value) => quantiseSample(value, 16));

/** What a file of `format` must read back as: from the signal, or from the bytes it holds. */
function expectedSamples(
  format: WavSampleFormat,
  channels: readonly Float32Array[],
  file: Uint8Array,
  descriptor: AudioFormatDescriptor,
): readonly (readonly number[])[] {
  const data = file.subarray(descriptor.dataOffset);
  const { encoding, blockAlign, frames } = descriptor;
  switch (format.kind) {
    case 'integer': {
      const scale = 2 ** (format.bits - 1);
      return channels.map((channel) =>
        // An integer has no negative zero, so a value that quantises to one reads back as zero.
        Array.from(channel, (value) =>
          Math.fround((quantiseSample(value, format.bits) + 0) / scale),
        ),
      );
    }
    case 'float':
      return channels.map((channel) => Array.from(channel));
    case 'g711-alaw':
      return channels.map((channel) =>
        linear16(channel).map((value) => referenceAlaw(compressAlaw(value)) / 32_768),
      );
    case 'g711-ulaw':
      return channels.map((channel) =>
        linear16(channel).map((value) => referenceUlaw(compressUlaw(value)) / 32_768),
      );
    case 'ima-adpcm':
    case 'ms-adpcm': {
      const decoded =
        encoding.kind === 'ima-adpcm'
          ? referenceImaWav(data, channels.length, blockAlign, encoding.framesPerBlock, frames)
          : encoding.kind === 'ms-adpcm'
            ? referenceMs(
                data,
                channels.length,
                blockAlign,
                encoding.framesPerBlock,
                frames,
                encoding.coefficients,
              )
            : [];
      return decoded.map((channel) => channel.map((value) => value / 32_768));
    }
  }
}

/** The frames after each step past full scale that an adaptive coder takes to settle. */
const SETTLING_FRAMES = 128;

/**
 * The RMS of the difference between what was written and what reads back, over
 * the sine alone: a step from silence to past full scale and back is clamped,
 * which the sample check holds exactly, and leaves an ADPCM coder's step size
 * wide for a while, which says nothing of how closely it codes a signal.
 */
function rmsError(written: Float32Array, read: Float32Array): number {
  let sum = 0;
  let counted = 0;
  for (const [index, value] of written.entries()) {
    if (index % 997 >= 3 && index % 997 < 3 + SETTLING_FRAMES) continue;
    sum += (value - (read[index] ?? 0)) ** 2;
    counted += 1;
  }
  return Math.sqrt(sum / Math.max(1, counted));
}

const FORMATS: readonly WavSampleFormat[] = [
  { kind: 'integer', bits: 8 },
  { kind: 'integer', bits: 16 },
  { kind: 'integer', bits: 24 },
  { kind: 'integer', bits: 32 },
  { kind: 'float', bits: 32 },
  { kind: 'float', bits: 64 },
  { kind: 'g711-alaw' },
  { kind: 'g711-ulaw' },
  { kind: 'ima-adpcm' },
  { kind: 'ms-adpcm' },
];

const RATES: readonly number[] = [8_000, 11_025, 22_050, 44_100, 48_000, 96_000, 192_000, 384_000];

/** The layouts of each channel count: speakers where the domain names a set, discrete otherwise. */
const LAYOUTS: readonly ChannelLayout[] = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  StandardLayouts.surround5_1,
  StandardLayouts.surround7_1,
  StandardLayouts.surround7_1_4,
  expectSuccess(discreteLayout(16)),
  expectSuccess(discreteLayout(24)),
];

/** How far a lossy coding of the test signal may stray, as an RMS on full scale. */
const STRAY: Readonly<Record<WavSampleFormat['kind'], number>> = {
  integer: 2 ** -7,
  float: 0,
  'g711-alaw': 0.01,
  'g711-ulaw': 0.01,
  // Four bits a sample keep the test signal's sine, 0.57 RMS, some 23 dB above the coding's error.
  'ima-adpcm': 0.04,
  'ms-adpcm': 0.04,
};

describe.each(FORMATS)('a WAV of $kind $bits', (format) => {
  it('reads back at every rate and channel count as the format says it must', async () => {
    for (const rate of RATES) {
      for (const layout of LAYOUTS) {
        const count = layout.roles.length;
        const frames = 2_100;
        const channels = testSignal(count, frames);
        const { file, layout: stated } = await writeFile(format, rate, layout, channels);
        const reader = expectSuccess(await openAudio(memoryBytes(file)));
        expect(reader.format).toMatchObject({
          sampleRate: rate,
          channelCount: count,
          frames,
          declaredFrames: frames,
          layout: stated,
        });
        // The writer puts a mask's speakers in its bit order; the file's channel i is the role's.
        const order = stated.roles.map((role, index) =>
          role === 'discrete' ? index : layout.roles.indexOf(role),
        );
        const source = order.map((index) => channels[index] ?? new Float32Array());
        const want = expectedSamples(format, source, file, reader.format);
        if (reader.format.encoding.kind === 'ima-adpcm') {
          // IMA's encoder is the recommended practice's, so its bytes are the reference encoder's.
          const reference = referenceImaWavEncode(
            source.map(linear16),
            reader.format.encoding.framesPerBlock,
          );
          expect(
            file.subarray(reader.format.dataOffset, reader.format.dataOffset + reference.length),
          ).toEqual(reference);
        }
        const into = source.map(() => new Float32Array(frames));
        expect(expectSuccess(await reader.read(0 as SampleCount, frames, into))).toBe(frames);
        for (const [channel, samples] of into.entries()) {
          const first = Array.from(samples).findIndex(
            (value, frame) => !Object.is(value, Math.fround(want[channel]?.[frame] ?? Number.NaN)),
          );
          expect(first === -1 ? undefined : { rate, count, channel, frame: first }).toBeUndefined();
          expect(rmsError(source[channel] ?? new Float32Array(), samples)).toBeLessThanOrEqual(
            STRAY[format.kind],
          );
        }
      }
    }
  });
});
