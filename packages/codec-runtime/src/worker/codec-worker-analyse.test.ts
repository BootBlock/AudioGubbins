/**
 * Import analysis in the codec worker (ADR-0090): each file recognised and
 * routed, a decoded one described from the codec module's description with
 * its metadata, and a codec unavailable here refused with the reason and the
 * codecs that serve instead (ADR-0091), all before anything is stored.
 */

import type { CodecPlatform } from '@audiogubbins/capabilities';
import { writeWav } from '@audiogubbins/codecs/testing';
import { StandardLayouts, createCancellationSource, succeed } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import type { CodecModule } from '../codec-module.js';
import type { DecoderSession } from '../decoder-session.js';
import type { StreamDescription } from '../stream-description.js';
import { codecModule } from '../testing/codec-module.js';
import { flacFile } from '../testing/encoded-fixtures.js';
import { MEMORY_READER, memoryFile, workerHarness } from '../testing/worker-harness.js';
import { runAnalysis } from './analyse-job.js';
import type { ImportServices } from './import-opening.js';

const TONE = Int32Array.from({ length: 30_000 }, (_, frame) =>
  Math.round(Math.sin(frame / 20) * 20_000),
);

describe('the codec worker analysing a file', () => {
  it('describes a FLAC file from the module, with its decoder and metadata', async () => {
    const module = await codecModule();
    const file = flacFile(module, [TONE, TONE], {
      sampleRate: 48_000,
      bitsPerSample: 16,
      blockSize: 4_096,
      metadata: { text: { title: 'Rain', artist: 'Clouds' } },
    });
    const harness = await workerHarness();
    harness.core.receive({
      kind: 'analyse',
      request: 'a',
      file: { kind: 'file', file: memoryFile(file) },
    });
    expect(await harness.answer('a')).toEqual({
      kind: 'analysed',
      request: 'a',
      analysis: {
        kind: 'decode',
        stream: {
          codec: 'flac',
          container: 'flac',
          sampleRate: 48_000,
          layout: StandardLayouts.stereo,
          statedFrames: 30_000,
          leadingFrames: 0,
          bitRate: expect.any(Number),
          bitsPerSample: 16,
        },
        decoder: { implementation: 'codec-module', name: 'Symphonia', version: '0.6.1' },
        metadata: { kind: 'read', metadata: { text: { title: 'Rain', artist: 'Clouds' } } },
      },
    });
  });

  it('routes a WAV file to be read in place, and refuses what it does not recognise', async () => {
    const wav = writeWav({
      sampleRate: 44_100,
      encoding: { kind: 'integer', bits: 16 },
      channels: [new Float32Array(100)],
    });
    const harness = await workerHarness();
    harness.core.receive({
      kind: 'analyse',
      request: 'w',
      file: { kind: 'file', file: memoryFile(wav) },
    });
    harness.core.receive({
      kind: 'analyse',
      request: 'x',
      file: { kind: 'file', file: memoryFile(new Uint8Array(2_000).fill(3)) },
    });
    expect(await harness.answer('w')).toMatchObject({
      analysis: {
        kind: 'read-in-place',
        container: 'wav',
        codec: 'pcm',
        metadata: { kind: 'read' },
      },
    });
    expect(await harness.answer('x')).toMatchObject({
      analysis: {
        kind: 'refused',
        failure: { code: 'codecs.unsupported-format' },
        alternatives: [],
      },
    });
  });

  it('refuses the module’s formats where it could not be loaded, and keeps every other working', async () => {
    const module = await codecModule();
    const flac = flacFile(module, [TONE], {
      sampleRate: 48_000,
      bitsPerSample: 16,
      blockSize: 4_096,
    });
    const wav = writeWav({
      sampleRate: 44_100,
      encoding: { kind: 'integer', bits: 16 },
      channels: [new Float32Array(100)],
    });
    const harness = await workerHarness({
      codecModule: { kind: 'unavailable', reason: 'The download was refused.' },
    });
    harness.core.receive({
      kind: 'analyse',
      request: 'f',
      file: { kind: 'file', file: memoryFile(flac) },
    });
    harness.core.receive({
      kind: 'analyse',
      request: 'w',
      file: { kind: 'file', file: memoryFile(wav) },
    });
    const refused = await harness.answer('f');
    expect(refused).toMatchObject({
      analysis: {
        kind: 'refused',
        failure: {
          code: 'codec-runtime.codec-unavailable',
          summary: 'The codec module could not be loaded, so FLAC cannot be imported here.',
        },
      },
    });
    // The other formats that need no module are offered, lossless first.
    expect(
      refused.kind === 'analysed' && refused.analysis.kind === 'refused'
        ? refused.analysis.alternatives
        : [],
    ).toEqual(['pcm', 'g711-alaw', 'g711-ulaw', 'ima-adpcm', 'ms-adpcm']);
    expect(await harness.answer('w')).toMatchObject({ analysis: { kind: 'read-in-place' } });
    const environments = harness.posted.flatMap((one) =>
      one.kind === 'environment' ? [one.environment] : [],
    );
    expect(environments.at(-1)?.codecModule).toBe('failed');
  });

  it('says why metadata was not read, keeping the audio', async () => {
    const module = await codecModule();
    const file = flacFile(module, [TONE], {
      sampleRate: 48_000,
      bitsPerSample: 16,
      blockSize: 4_096,
    });
    // A Vorbis comment block of more comments than the metadata readers' bound,
    // which the decoder passes over.
    const comments = 5_000;
    const body = new Uint8Array(8 + comments * 7);
    const view = new DataView(body.buffer);
    view.setUint32(4, comments, true);
    for (let index = 0; index < comments; index += 1) {
      view.setUint32(8 + index * 7, 3, true);
      body.set([0x41, 0x3d, 0x62], 12 + index * 7);
    }
    const head = 4 + 4 + 34;
    const broken = new Uint8Array(file.length + 4 + body.length);
    broken.set(file.subarray(0, head));
    // The stream information is no longer the last block.
    broken[4] = (broken[4] ?? 0) & 0x7f;
    broken.set([0x84, body.length >> 16, (body.length >> 8) & 0xff, body.length & 0xff], head);
    broken.set(body, head + 4);
    broken.set(file.subarray(head), head + 4 + body.length);
    const harness = await workerHarness();
    harness.core.receive({
      kind: 'analyse',
      request: 'm',
      file: { kind: 'file', file: memoryFile(broken) },
    });
    expect(await harness.answer('m')).toMatchObject({
      analysis: {
        kind: 'decode',
        metadata: { kind: 'unread', failure: { code: expect.stringMatching(/^codecs\./u) } },
      },
    });
  });
});

/** An HE-AAC stream as the module describes one, which it does not decode. */
const HE_AAC: StreamDescription = {
  codec: 'he-aac',
  container: 'mp4',
  sampleRate: 44_100,
  channelCount: 2,
  layout: { kind: 'speakers', mask: 0b11 },
  totalFrames: 88_200,
  priming: 2_112,
  padding: undefined,
  bitRate: 48_000,
  bitsPerSample: undefined,
  decodable: false,
  codecConfig: Uint8Array.of(0x2b, 0x92, 0x08, 0x00),
};

/** A stand-in codec module that opens every file as `description`. */
function describingModule(
  description: StreamDescription,
  released: { count: number },
): CodecModule {
  const session: DecoderSession = {
    description,
    decode: () => succeed(0),
    readPacket: () => succeed(undefined),
    release: () => {
      released.count += 1;
    },
  };
  const refused = (): never => {
    throw new Error('Not made in this test.');
  };
  return {
    openDecoder: () => succeed(session),
    createFlacFrameEncoder: refused,
    createOpusEncoder: refused,
    createOpusPacketDecoder: refused,
  };
}

/** The first bytes of an MP4 file, whose codec lies past what recognition reads. */
const MP4 = Uint8Array.from([
  0,
  0,
  0,
  16,
  0x66,
  0x74,
  0x79,
  0x70,
  0x4d,
  0x34,
  0x41,
  0x20,
  0,
  0,
  0,
  0,
  ...new Array<number>(200).fill(0),
]);

function heAacServices(probed: boolean, released: { count: number }): ImportServices {
  const platform: CodecPlatform = {
    webAssembly: true,
    decoding: undefined,
    encoding: undefined,
    browser: { name: 'Firefox', majorVersion: '140' },
  };
  return {
    codecModule: () => Promise.resolve(succeed(describingModule(HE_AAC, released))),
    environment: () => ({
      webAssembly: true,
      codecModule: 'loaded',
      encoderModules: new Map(),
      browserDecoders: new Set(probed ? (['he-aac'] as const) : []),
      browserEncoders: new Set(),
    }),
    platform,
  };
}

describe('the analysis of HE-AAC', () => {
  it('refuses it where the browser was not probed to decode it, with the reason and alternatives', async () => {
    const released = { count: 0 };
    const end = await runAnalysis(
      { kind: 'file', file: memoryFile(MP4) },
      MEMORY_READER,
      heAacServices(false, released),
      createCancellationSource().signal,
    );
    expect(end).toMatchObject({
      kind: 'analysed',
      analysis: {
        kind: 'refused',
        failure: {
          code: 'codec-runtime.codec-unavailable',
          summary:
            "Importing HE-AAC needs the browser's own decoder, which this browser does not have.",
          details: { codec: 'he-aac' },
        },
        alternatives: [
          'opus',
          'vorbis',
          'mp3',
          'aac-lc',
          'g711-alaw',
          'g711-ulaw',
          'ima-adpcm',
          'ms-adpcm',
          'pcm',
          'flac',
          'alac',
        ],
      },
    });
    expect(released.count).toBe(1);
  });

  it('describes it, decoded by the browser, where the browser was probed to decode it', async () => {
    const released = { count: 0 };
    const end = await runAnalysis(
      { kind: 'file', file: memoryFile(MP4) },
      MEMORY_READER,
      heAacServices(true, released),
      createCancellationSource().signal,
    );
    expect(end).toMatchObject({
      kind: 'analysed',
      analysis: {
        kind: 'decode',
        stream: { codec: 'he-aac', container: 'mp4', statedFrames: 88_200, leadingFrames: 2_112 },
        decoder: { implementation: 'browser', name: 'WebCodecs (Firefox)', version: '140' },
      },
    });
    expect(released.count).toBe(1);
  });
});
