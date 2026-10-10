/**
 * The codec worker's protocol: every message read field by field in both
 * directions, configuration once, requests answered once to the client that
 * sent them, and the encode request moving a rendered stream through the
 * encoder the worker is given.
 */

import type { AudioFileWriter } from '@audiogubbins/codecs';
import {
  FailureKind,
  StandardLayouts,
  failure,
  sampleCount,
  sampleRate,
  succeed,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  readEncodedStreamMessage,
  readStreamReceiverMessage,
  type EncodedStreamMessage,
  type RenderedStreamMessage,
} from '@audiogubbins/import-export';
import { describe, expect, it } from 'vitest';

import type { PortMessage } from '../streams/stream-port.js';
import { messageChannel, workerHarness } from '../testing/worker-harness.js';
import {
  readCodecRequest,
  readFromCodecWorker,
  readToCodecWorker,
} from './codec-worker-message-reading.js';
import type { ExportEncodeRequest, FromCodecWorker } from './codec-worker-messages.js';
import type { OpenExportEncoder, OpenedExportEncoder } from './encode-job.js';
import { FLACENC_ENCODER } from '../encoding/encoder-identity.js';
import { openExportEncoder } from '../encoding/open-export-encoder.js';
import { encodeWhole, testSignal } from '../testing/export-encoding.js';

function rate(value: number): SampleRate {
  const read = sampleRate(value);
  if (!read.ok) throw new Error(read.failures[0].summary);
  return read.value;
}

const ENCODE: ExportEncodeRequest = {
  target: { formatName: 'FLAC', codec: 'flac', container: 'flac', extension: 'flac', depth: 24 },
  encoding: { format: 'flac', encoding: { bits: 24, compressionLevel: 5 } },
  sampleRate: rate(48_000),
  layout: StandardLayouts.stereo,
  metadata: { text: { title: 'Mix' } },
  dither: { settings: { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 0 }, key: 77 },
};

/** The field a refused message names. */
function refusedField(read: {
  ok: boolean;
  failures?: readonly { details?: Record<string, unknown> }[];
}): unknown {
  return read.ok ? undefined : read.failures?.[0]?.details?.['field'];
}

describe('the codec worker’s messages', () => {
  it('reads every request as it was sent, and refuses one that is not', () => {
    const { port1, port2 } = messageChannel();
    const file = { size: 10, slice: () => file };
    const requests = [
      { kind: 'analyse', request: 'a', file: { kind: 'file', file } },
      { kind: 'decode', request: 'd', file: { kind: 'file', file }, stream: port1 },
      { kind: 'encode', request: 'e', encode: ENCODE, rendered: port1, stream: port2 },
      { kind: 'cancel', request: 'd' },
    ] as const;
    for (const request of requests) {
      const read = readCodecRequest(request);
      expect(read.ok ? read.value : read.failures).toEqual(request);
    }
    expect(
      refusedField(
        readCodecRequest({ kind: 'analyse', request: '', file: { kind: 'file', file } }),
      ),
    ).toBe('request');
    expect(
      refusedField(
        readCodecRequest({
          kind: 'decode',
          request: 'd',
          file: { kind: 'file', file },
          stream: {},
        }),
      ),
    ).toBe('stream');
    expect(
      refusedField(
        readCodecRequest({ kind: 'analyse', request: 'a', file: { kind: 'file', file: 'a path' } }),
      ),
    ).toBe('file.file');
    expect(
      refusedField(
        readCodecRequest({
          kind: 'encode',
          request: 'e',
          encode: {
            ...ENCODE,
            encoding: { format: 'flac', encoding: { bits: 20, compressionLevel: 5 } },
          },
          rendered: port1,
          stream: port2,
        }),
      ),
    ).toBe('encode.encoding.encoding.bits');
    // A client's port only asks; configuring is the page's.
    expect(refusedField(readCodecRequest({ kind: 'connect', port: port1 }))).toBe('kind');
    expect(readToCodecWorker({ kind: 'connect', port: port1 }).ok).toBe(true);
    expect(
      refusedField(
        readToCodecWorker({
          kind: 'configure',
          codecModule: { kind: 'url', url: 'https://example.com/codecs.wasm' },
          prebuiltEncoders: {},
        }),
      ),
    ).toBe('codecModule.kind');
    port1.close();
    port2.close();
  });

  it('reads every answer as it was sent', () => {
    const frames = sampleCount(10);
    if (!frames.ok) throw new Error('frames');
    const answers: readonly FromCodecWorker[] = [
      {
        kind: 'environment',
        environment: {
          webAssembly: true,
          codecModule: 'failed',
          prebuiltModules: new Map([['mp3', 'loaded']]),
          browserDecoders: new Set(['he-aac']),
          browserEncoders: new Set(['aac-lc']),
        },
      },
      {
        kind: 'analysed',
        request: 'a',
        analysis: {
          kind: 'decode',
          stream: {
            codec: 'opus',
            container: 'ogg',
            sampleRate: rate(48_000),
            layout: StandardLayouts.stereo,
            statedFrames: undefined,
            leadingFrames: frames.value,
            bitRate: 96_000,
            bitsPerSample: undefined,
          },
          decoder: { implementation: 'codec-module', name: 'ropus', version: '0.12.18' },
          metadata: { kind: 'none' },
        },
      },
      {
        kind: 'analysed',
        request: 'b',
        analysis: {
          kind: 'refused',
          failure: failure('x.y', FailureKind.Rejected, 'No.'),
          alternatives: ['flac'],
        },
      },
      { kind: 'progress', request: 'd', frames: 65_536 },
      {
        kind: 'decoded',
        request: 'd',
        frames: frames.value,
        decoder: { implementation: 'browser', name: 'WebCodecs', version: 'unknown' },
      },
      {
        kind: 'encoded',
        request: 'e',
        frames: frames.value,
        encoder: { implementation: 'codec-module', version: 'flacenc 0.5.1' },
      },
      { kind: 'cancelled', request: 'c' },
      { kind: 'refused', failure: failure('x.y', FailureKind.Rejected, 'No.') },
    ];
    for (const answer of answers) {
      const read = readFromCodecWorker(structuredClone(answer));
      expect(read.ok ? read.value : read.failures).toEqual(answer);
    }
    expect(
      refusedField(
        readFromCodecWorker({
          kind: 'environment',
          environment: {
            ...answers[0],
            webAssembly: true,
            codecModule: 'loaded',
            prebuiltModules: new Map(),
            browserDecoders: new Set(['speex']),
            browserEncoders: new Set(),
          },
        }),
      ),
    ).toBe('environment.browserDecoders[0]');
  });
});

describe('the codec worker’s requests', () => {
  it('refuses a second configuration, keeping the first, and work before any', async () => {
    const harness = await workerHarness();
    harness.core.receive({
      kind: 'configure',
      codecModule: { kind: 'unavailable', reason: 'Again.' },
      prebuiltEncoders: {
        mp3: { kind: 'unavailable', reason: 'Again.' },
        vorbis: { kind: 'unavailable', reason: 'Again.' },
      },
    });
    expect(harness.posted.at(-1)).toMatchObject({
      kind: 'refused',
      failure: { code: 'codec-runtime.worker-configured' },
    });
    harness.core.receive({ kind: 'nonsense' });
    expect(harness.posted.at(-1)).toMatchObject({
      kind: 'refused',
      failure: { code: 'codec-runtime.message-malformed' },
    });
  });

  it('answers a connected client over its own port', async () => {
    const harness = await workerHarness();
    const { port1, port2 } = messageChannel();
    harness.core.receive({ kind: 'connect', port: port1 });
    const answers: unknown[] = [];
    const answered = new Promise<void>((resolve) => {
      port2.addEventListener('message', (event: PortMessage) => {
        answers.push(event.data);
        resolve();
      });
    });
    port2.start();
    port2.postMessage(
      { kind: 'analyse', request: 'x', file: { kind: 'file', file: 'not a file' } },
      [],
    );
    await answered;
    expect(answers[0]).toMatchObject({
      kind: 'refused',
      failure: { details: { field: 'file.file' } },
    });
    port2.close();
  });
});

/** The encoder a test's writer is said to be. */
const COUNTING_ENCODER = { implementation: 'application', version: 'Counting 1.0' } as const;

/**
 * An encoder whose writer writes each block's frame count as one byte, and a
 * head and tail.
 */
function countingWriter(log: number[]): OpenedExportEncoder {
  const writer: AudioFileWriter = {
    write: (_channels, frames) => {
      log.push(frames);
      return Promise.resolve(succeed([Uint8Array.of(frames & 0xff)]));
    },
    finish: () =>
      Promise.resolve(succeed({ head: Uint8Array.of(1), tail: Uint8Array.of(2), dropped: [] })),
  };
  return { writer, encoder: COUNTING_ENCODER };
}

/** Plays the render worker and the storage worker around an encode, answering what the storage worker received. */
async function encodeThrough(
  open: OpenExportEncoder,
  blocks: readonly RenderedStreamMessage[],
  cancelAfter?: number,
) {
  const harness = await workerHarness({ openExportEncoder: open });
  const rendered = messageChannel();
  const stored = messageChannel();
  const received: EncodedStreamMessage[] = [];
  let sent = 0;
  const renderSide = rendered.port2;
  // The render side sends a block for each credit granted, as the render worker does.
  renderSide.addEventListener('message', (event: PortMessage) => {
    const read = readStreamReceiverMessage(event.data);
    if (!read.ok || read.value.kind === 'refused') return;
    for (let credit = read.value.credit; credit > 0 && sent < blocks.length; credit -= 1) {
      renderSide.postMessage(blocks[sent], []);
      sent += 1;
      if (sent === cancelAfter) harness.core.receive({ kind: 'cancel', request: 'e' });
    }
  });
  renderSide.start();
  const storageSide = stored.port2;
  storageSide.addEventListener('message', (event: PortMessage) => {
    const read = readEncodedStreamMessage(event.data);
    if (!read.ok) throw new Error(read.failures[0].summary);
    received.push(read.value);
    storageSide.postMessage({ kind: 'ready', credit: 1 }, []);
  });
  storageSide.start();
  storageSide.postMessage({ kind: 'ready', credit: 1 }, []);
  harness.core.receive({
    kind: 'encode',
    request: 'e',
    encode: ENCODE,
    rendered: rendered.port1,
    stream: stored.port1,
  });
  const answer = await harness.answer('e');
  await new Promise((resolve) => setTimeout(resolve, 20));
  renderSide.close();
  storageSide.close();
  return { answer, received };
}

const block = (frames: number): RenderedStreamMessage => ({
  kind: 'block',
  channels: [new Float32Array(frames), new Float32Array(frames)],
  frames,
});

describe('the codec worker encoding an export', () => {
  it('moves each rendered block through the encoder it is given, then the file’s head and tail', async () => {
    const written: number[] = [];
    let opened: ExportEncodeRequest | undefined;
    const ended = sampleCount(600);
    if (!ended.ok) throw new Error('frames');
    const { answer, received } = await encodeThrough(
      (request) => {
        opened = request;
        return Promise.resolve(succeed(countingWriter(written)));
      },
      [block(100), block(200), block(300), { kind: 'end', frames: ended.value }],
    );
    expect(opened).toEqual(ENCODE);
    // The answer names the encoder the factory opened, which the export's record keeps.
    expect(answer).toEqual({
      kind: 'encoded',
      request: 'e',
      frames: 600,
      encoder: COUNTING_ENCODER,
    });
    expect(written).toEqual([100, 200, 300]);
    // Bytes that crossed a channel are of the channel's realm, so they are compared as numbers.
    expect(
      received.map((one) =>
        one.kind === 'body'
          ? [...one.bytes]
          : one.kind === 'finished'
            ? [[...one.file.head], [...one.file.tail], one.file.dropped]
            : one.kind,
      ),
    ).toEqual([[100], [200], [44], [[1], [2], []]]);
  });

  it('encodes the export through the encoders the worker registers, the file a direct write makes', async () => {
    const source = testSignal(2, 9_000, 48_000);
    const blocks: RenderedStreamMessage[] = [0, 3_000, 6_000].map((at) => ({
      kind: 'block',
      channels: source.map((plane) => plane.slice(at, at + 3_000)),
      frames: 3_000,
    }));
    const frames = sampleCount(9_000);
    if (!frames.ok) throw new Error('frames');
    const { answer, received } = await encodeThrough(openExportEncoder, [
      ...blocks,
      { kind: 'end', frames: frames.value },
    ]);
    expect(answer).toEqual({
      kind: 'encoded',
      request: 'e',
      frames: 9_000,
      encoder: FLACENC_ENCODER,
    });
    const finished = received.at(-1);
    if (finished?.kind !== 'finished') throw new Error('The encode did not finish.');
    const parts = [
      finished.file.head,
      ...received.flatMap((one) => (one.kind === 'body' ? [one.bytes] : [])),
      finished.file.tail,
    ];
    const file = parts.flatMap((part) => [...part]);
    expect(file).toEqual([...(await encodeWhole(ENCODE, source))]);
  });

  it('ends both streams with the reason where the encoder is refused, the render fails, or its length disagrees', async () => {
    const refusal = failure('codec-runtime.encoder-unavailable', FailureKind.Rejected, 'No FLAC.');
    const refused = await encodeThrough(
      () => Promise.resolve({ ok: false, failures: [refusal] }),
      [],
    );
    expect(refused.answer).toEqual({ kind: 'failed', request: 'e', failure: refusal });
    expect(refused.received).toEqual([{ kind: 'failed', failure: refusal }]);

    const broken = failure('render.failed', FailureKind.Unrecoverable, 'The render broke.');
    const failed = await encodeThrough(
      () => Promise.resolve(succeed(countingWriter([]))),
      [block(10), { kind: 'failed', failure: broken }],
    );
    expect(failed.answer).toMatchObject({ kind: 'failed', failure: broken });
    expect(failed.received.at(-1)).toEqual({ kind: 'failed', failure: broken });

    const short = sampleCount(11);
    if (!short.ok) throw new Error('frames');
    const disagreeing = await encodeThrough(
      () => Promise.resolve(succeed(countingWriter([]))),
      [block(10), { kind: 'end', frames: short.value }],
    );
    expect(disagreeing.answer).toMatchObject({
      failure: { code: 'codec-runtime.rendered-frames-disagree' },
    });
  });

  it('stops at a cancellation, ending the stored stream with it', async () => {
    const { answer, received } = await encodeThrough(
      () => Promise.resolve(succeed(countingWriter([]))),
      Array.from({ length: 50 }, () => block(10)),
      3,
    );
    expect(answer).toEqual({ kind: 'cancelled', request: 'e' });
    expect(received.at(-1)).toMatchObject({
      kind: 'failed',
      failure: { code: 'codec-runtime.cancelled' },
    });
    expect(received.some((one) => one.kind === 'finished')).toBe(false);
  });
});
