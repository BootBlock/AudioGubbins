/**
 * The page's codecs over the codec worker's own core, played as a thread the
 * page starts (`pageWorker`): started once on first use, given every module
 * the page bundles compiled or why it has none, joined to storage, and asked
 * to analyse and encode, each request cancelled in the worker when its signal
 * aborts.
 */

import type { OpenExportEncoder } from '@audiogubbins/codec-runtime';
import {
  codecModule,
  codecModuleBytes,
  flacFile,
  pageWorker,
  type PageWorker,
} from '@audiogubbins/codec-runtime/testing';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import {
  StandardLayouts,
  sampleCount,
  sampleRate,
  succeed,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  readEncodedStreamMessage,
  readStreamReceiverMessage,
  type EncodedStreamMessage,
  type RenderedStreamMessage,
} from '@audiogubbins/import-export';
import { describe, expect, it, vi } from 'vitest';

import { PROMPTLY } from '../testing/waiting.js';
import { CodecThread, type BundledModule, type CodecThreadParts } from './codec-thread.js';

const TONE = Int32Array.from({ length: 4_800 }, (_, frame) =>
  Math.round(Math.sin(frame / 10) * 10_000),
);

/** Why this copy has no MP3 encoder. */
const ABSENT_REASON = 'The MP3 encoder was not built into this copy of AudioGubbins.';
const ABSENT: BundledModule = { kind: 'absent', reason: ABSENT_REASON };

interface Scene {
  readonly codecs: CodecThread;
  readonly workers: PageWorker[];
  readonly joined: MessagePort[];
  readonly logs: ReturnType<typeof createLogStore>;
}

/** The codecs over workers made by `worker`, with the parts `parts` overrides. */
function scene(
  parts: Partial<CodecThreadParts> = {},
  worker: () => PageWorker = () => pageWorker(),
): Scene {
  const workers: PageWorker[] = [];
  const joined: MessagePort[] = [];
  const logs = createLogStore();
  const codecs = new CodecThread({
    webAssembly: true,
    startWorker: () => {
      const started = worker();
      workers.push(started);
      return started;
    },
    modules: {
      codec: () => Promise.resolve({ kind: 'bundled', bytes: codecModuleBytes() }),
      mp3: () => Promise.resolve(ABSENT),
      vorbis: () => Promise.resolve({ kind: 'bundled', bytes: Uint8Array.of(0, 1, 2, 3) }),
    },
    compile: (bytes) => WebAssembly.compile(bytes),
    join: (port) => {
      joined.push(port);
      return Promise.resolve();
    },
    logger: createDiagnosticCentre(logs, { now: () => 0 }).loggerFor('codecs'),
    ...parts,
  });
  return { codecs, workers, joined, logs };
}

/** A FLAC file of `layout`'s channels, which the codec module decodes. */
async function flacOf(layout: ChannelLayout): Promise<Blob> {
  const bytes = flacFile(
    await codecModule(),
    layout.roles.map(() => TONE),
    { sampleRate: 48_000, bitsPerSample: 16, blockSize: 4_096 },
  );
  return new Blob([bytes.slice()]);
}

describe('the page’s codecs', () => {
  it('start nothing until asked, saying only that WebAssembly runs', () => {
    const { codecs, workers } = scene();

    expect(workers).toEqual([]);
    expect(codecs.environment.get()).toMatchObject({
      webAssembly: true,
      codecModule: 'not-loaded',
    });
    expect(codecs.capability('flac', 'write')).toMatchObject({ kind: 'available' });
  });

  it('start the worker once, configured before it is joined to storage', async () => {
    const { codecs, workers, joined } = scene();

    const [first, second] = await Promise.all([codecs.ready(), codecs.ready()]);

    expect(first.ok && second.ok).toBe(true);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.sent.map((message) => message.kind)).toEqual(['configure', 'connect']);
    expect(joined).toHaveLength(1);
    expect((await codecs.ready()).ok).toBe(true);
    expect(workers).toHaveLength(1);
  });

  it('make the formats of a module it has none of unavailable, with the reason, and keep the rest', async () => {
    const { codecs, workers, logs } = scene();

    expect((await codecs.ready()).ok).toBe(true);

    const configure = workers[0]?.sent[0];
    expect(configure?.kind === 'configure' && configure.codecModule.kind).toBe('compiled');
    expect(configure?.kind === 'configure' && configure.prebuiltEncoders).toEqual({
      mp3: { kind: 'unavailable', reason: ABSENT_REASON },
      vorbis: { kind: 'unavailable', reason: expect.any(String) as unknown },
    });
    expect(codecs.capability('mp3', 'write')).toMatchObject({
      kind: 'unavailable',
      reason: 'The MP3 encoder could not be loaded, so MP3 cannot be exported here.',
    });
    expect(codecs.capability('vorbis', 'write')).toMatchObject({ kind: 'unavailable' });
    expect(codecs.capability('flac', 'write')).toMatchObject({ kind: 'available' });
    // Why each module could not be had is kept where the person's diagnostics show it.
    const warned = logs.snapshot().filter((record) => record.severity === 'warning');
    expect(warned.map((record) => record.message)).toEqual([
      'The MP3 encoder could not be loaded.',
      'The Vorbis encoder could not be loaded.',
    ]);
  });

  it('analyse a file in the worker, its channels read from its headers', async () => {
    const { codecs } = scene();

    const analysis = await codecs.analyse(
      await flacOf(StandardLayouts.surround5_1),
      new AbortController().signal,
    );

    const analysed = expectSuccess(analysis);
    expect(analysed.kind === 'decode' && analysed.stream.layout.roles.length).toBe(6);
  });

  it('cancel an analysis in the worker when its signal aborts', async () => {
    const { codecs, workers } = scene();
    expect((await codecs.ready()).ok).toBe(true);
    const controller = new AbortController();

    const analysing = codecs.analyse(await flacOf(StandardLayouts.stereo), controller.signal);
    const sent = workers[0]?.sent ?? [];
    await vi.waitFor(() => {
      expect(sent.at(-1)?.kind).toBe('analyse');
    }, PROMPTLY);
    controller.abort();
    const analysis = await analysing;

    expect(analysis.ok ? 'analysed' : analysis.failures[0].code).toBe('codec-runtime.cancelled');
    const asked = sent.at(-2);
    expect(sent.at(-1)).toEqual({
      kind: 'cancel',
      request: asked?.kind === 'analyse' ? asked.request : '',
    });
  });

  it('serve the storage worker over the port they join it by', async () => {
    const { codecs, joined } = scene();
    expect((await codecs.ready()).ok).toBe(true);
    const storage = joined[0];
    if (storage === undefined) throw new Error('The codecs joined no storage.');

    const answered = new Promise<unknown>((resolve) => {
      storage.addEventListener('message', (event) => {
        resolve(event.data);
      });
    });
    storage.start();
    // A request the worker cannot read is refused to the client that sent it,
    // over its own port, which only a client the worker serves is answered on.
    storage.postMessage({ kind: 'analyse', request: '' });

    expect(await answered).toMatchObject({
      kind: 'refused',
      failure: { code: 'codec-runtime.message-malformed' },
    });
  });

  it('fail, and start no second worker, where the worker faults before it says anything', async () => {
    const { codecs, workers } = scene({}, () => {
      const worker = pageWorker();
      worker.fault('The script could not be loaded.');
      return worker;
    });

    const ready = await codecs.ready();

    expect(ready.ok ? 'ready' : ready.failures[0]).toMatchObject({
      code: 'codecs.worker-unstarted',
      summary: expect.stringContaining('The script could not be loaded.') as unknown,
    });
    expect(workers[0]?.terminated()).toBe(true);
    const again = await codecs.analyse(new Blob([]), new AbortController().signal);
    expect(again.ok ? 'analysed' : again.failures[0].code).toBe('codecs.worker-unstarted');
    expect(workers).toHaveLength(1);
  });

  it('fail where the worker cannot be joined to storage', async () => {
    const { codecs, workers } = scene({
      join: () => Promise.reject(new Error('The storage worker has stopped.')),
    });

    const ready = await codecs.ready();

    expect(ready.ok ? 'ready' : ready.failures[0]).toMatchObject({
      code: 'codecs.storage-unjoined',
      summary: expect.stringContaining('The storage worker has stopped.') as unknown,
    });
    expect(workers[0]?.terminated()).toBe(true);
  });

  it('configure the worker with no join where no projects are kept', async () => {
    const { codecs, workers } = scene({ join: undefined });

    expect((await codecs.ready()).ok).toBe(true);
    expect(workers[0]?.sent.map((message) => message.kind)).toEqual(['configure']);
  });
});

describe('an encode through the page’s codecs', () => {
  /** An encoder that writes each block's frame count as a byte. */
  const counting: OpenExportEncoder = () =>
    Promise.resolve(
      succeed({
        writer: {
          write: (_channels, frames) => Promise.resolve(succeed([Uint8Array.of(frames)])),
          finish: () =>
            Promise.resolve(
              succeed({ head: Uint8Array.of(1), tail: Uint8Array.of(2), dropped: [] }),
            ),
        },
        encoder: { implementation: 'codec-module', version: 'flacenc 0.5.1' },
      }),
    );

  it('answers the frames and the encoder the record names, reporting progress', async () => {
    const { codecs } = scene({}, () => pageWorker({ openExportEncoder: counting }));
    const rendered = new MessageChannel();
    const stream = new MessageChannel();
    const blocks: RenderedStreamMessage[] = [
      { kind: 'block', channels: [new Float32Array(10), new Float32Array(10)], frames: 10 },
      { kind: 'block', channels: [new Float32Array(20), new Float32Array(20)], frames: 20 },
      { kind: 'end', frames: expectSuccess(sampleCount(30)) },
    ];
    // The render worker's side: a block for each credit granted.
    let sent = 0;
    rendered.port2.addEventListener('message', (event) => {
      const read = readStreamReceiverMessage(event.data);
      if (!read.ok || read.value.kind !== 'ready') return;
      for (let credit = read.value.credit; credit > 0 && sent < blocks.length; credit -= 1) {
        rendered.port2.postMessage(blocks[sent]);
        sent += 1;
      }
    });
    rendered.port2.start();
    // The storage worker's side: credit for each message taken.
    const stored: EncodedStreamMessage[] = [];
    stream.port2.addEventListener('message', (event) => {
      const read = readEncodedStreamMessage(event.data);
      if (read.ok) stored.push(read.value);
      stream.port2.postMessage({ kind: 'ready', credit: 1 });
    });
    stream.port2.start();
    stream.port2.postMessage({ kind: 'ready', credit: 1 });
    const progress: number[] = [];

    const encoded = await codecs.encode(
      {
        target: {
          formatName: 'FLAC',
          codec: 'flac',
          container: 'flac',
          extension: 'flac',
          depth: 16,
        },
        encoding: { format: 'flac', encoding: { bits: 16, compressionLevel: 5 } },
        sampleRate: expectSuccess(sampleRate(48_000)),
        layout: StandardLayouts.stereo,
        metadata: {},
        dither: { settings: { kind: 'none' }, key: 0 },
      },
      { rendered: rendered.port1, stream: stream.port1 },
      (frames) => progress.push(frames),
      new AbortController().signal,
    );

    expect(expectSuccess(encoded)).toEqual({
      frames: 30,
      encoder: { id: 'flac', implementation: 'codec-module', version: 'flacenc 0.5.1' },
    });
    expect(progress).toEqual([10, 30]);
    expect(stored.at(-1)?.kind).toBe('finished');
    rendered.port2.close();
    stream.port2.close();
  });
});
