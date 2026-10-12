/**
 * A picture's sound decoded through the page's codecs, over the codec
 * worker's own core and the codec module the run built: the file read by the
 * worker block by block, the stream read by the page with credit, held to the
 * stream the file's analysis described and to the frames the page can hold,
 * and every way the decode ends without its sound said with the reason.
 */

import type { AnalysedStream } from '@audiogubbins/codec-runtime';
import {
  codecModule,
  codecModuleBytes,
  flacFile,
  pageWorker,
  type PageWorker,
} from '@audiogubbins/codec-runtime/testing';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  StandardLayouts,
  fail,
  failure,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it, vi } from 'vitest';

import { CodecThread } from '../codecs/codec-thread.js';
import { PROMPTLY } from '../testing/waiting.js';
import { codecSoundDecoder } from './codec-picture-sound.js';
import type { DecodedSound } from './picture-sound.js';

/**
 * A tone of 100,000 frames, in 16-bit steps: more than the worker sends in
 * one block, which holds at most 65,536 frames and 1 MiB.
 */
const TONE = Int32Array.from({ length: 100_000 }, (_, frame) =>
  Math.round(Math.sin(frame / 10) * 10_000),
);

/** The page's codecs over a worker of their own, with the codec module alone loaded. */
function codecs(): { readonly codecs: CodecThread; readonly workers: PageWorker[] } {
  const workers: PageWorker[] = [];
  const thread = new CodecThread({
    webAssembly: true,
    startWorker: () => {
      const started = pageWorker();
      workers.push(started);
      return started;
    },
    modules: {
      codec: () => Promise.resolve(codecModuleBytes()),
      mp3: () => Promise.reject(new TypeError('Not loaded in this test.')),
      vorbis: () => Promise.reject(new TypeError('Not loaded in this test.')),
    },
    compile: (bytes) => WebAssembly.compile(bytes),
    join: undefined,
    logger: createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('codecs'),
  });
  return { codecs: thread, workers };
}

/** A FLAC file at 44.1 kHz of `layout`'s channels, each the tone, in blocks of 4,096 frames. */
async function flacOf(layout: ChannelLayout): Promise<Blob> {
  const bytes = flacFile(
    await codecModule(),
    layout.roles.map(() => TONE),
    { sampleRate: 44_100, bitsPerSample: 16, blockSize: 4_096 },
  );
  return new Blob([bytes.slice()]);
}

/** The stream the codecs' analysis of `file` describes. */
async function analysed(thread: CodecThread, file: Blob): Promise<AnalysedStream> {
  const analysis = expectSuccess(await thread.analyse(file, new AbortController().signal));
  if (analysis.kind !== 'decode') throw new Error(`The file was analysed as ${analysis.kind}.`);
  return analysis.stream;
}

function soundOf(decoded: DecodedSound | string): DecodedSound {
  if (typeof decoded === 'string') throw new Error(decoded);
  return decoded;
}

describe("a picture's sound decoded by the codecs", () => {
  it('arrives at its own rate, in its own channels, a block at a time', async () => {
    const { codecs: thread } = codecs();
    const file = await flacOf(StandardLayouts.surround5_1);
    const stream = await analysed(thread, file);

    const sound = soundOf(
      await codecSoundDecoder(thread)(file, stream, 1_000_000, new AbortController().signal),
    );

    expect(sound).toMatchObject({
      sampleRate: 44_100,
      layout: stream.layout,
      frames: 100_000,
      decoder: { implementation: 'codec-module', name: 'Symphonia' },
    });
    expect(sound.layout.roles).toHaveLength(6);
    // The file's own blocks, never the whole sound in one message.
    expect(sound.blocks.length).toBeGreaterThan(1);
    const first = sound.blocks.flatMap((block) => [...(block[0] ?? [])]);
    expect(first).toEqual([...TONE].map((sample) => sample / 32_768));
  });

  it('stops a sound that runs past the frames the page can hold, and its decode with it', async () => {
    const { codecs: thread } = codecs();
    const file = await flacOf(StandardLayouts.stereo);
    const stream = await analysed(thread, file);
    const decode = codecSoundDecoder(thread);

    const stopped = await decode(file, stream, 50_000, new AbortController().signal);

    expect(stopped).toBe(
      'The picture’s sound ran past the 50000 frames this page can spare memory for, so it was stopped.',
    );
    // The worker's stream ended with the refusal, so the next decode is served.
    const again = soundOf(await decode(file, stream, 100_000, new AbortController().signal));
    expect(again.frames).toBe(100_000);
  });

  it('refuses a sound that is not the stream the file’s analysis described', async () => {
    const { codecs: thread } = codecs();
    const surround = await flacOf(StandardLayouts.surround5_1);
    const stereo = await analysed(thread, await flacOf(StandardLayouts.stereo));

    const refused = await codecSoundDecoder(thread)(
      surround,
      stereo,
      1_000_000,
      new AbortController().signal,
    );

    expect(refused).toBe(
      'The picture’s sound decoded at another rate or in other channels than its file says, so it was stopped.',
    );
  });

  it('says why where the codecs refuse the file, as an import is refused', async () => {
    const { codecs: thread } = codecs();
    const stream = await analysed(thread, await flacOf(StandardLayouts.stereo));
    const text = new Blob(['Not a sound, nor a picture.']);

    const refused = await codecSoundDecoder(thread)(
      text,
      stream,
      1_000_000,
      new AbortController().signal,
    );

    const analysis = expectSuccess(await thread.analyse(text, new AbortController().signal));
    expect(analysis.kind === 'refused' && refused).toBe(
      analysis.kind === 'refused' && analysis.failure.summary,
    );
  });

  it('cancels the decode in the worker when it is abandoned', async () => {
    const { codecs: thread, workers } = codecs();
    const file = await flacOf(StandardLayouts.stereo);
    const stream = await analysed(thread, file);
    const decode = codecSoundDecoder(thread);
    const controller = new AbortController();

    const abandoned = decode(file, stream, 1_000_000, controller.signal);
    const sent = workers[0]?.sent ?? [];
    await vi.waitFor(() => {
      expect(sent.at(-1)?.kind).toBe('decode');
    }, PROMPTLY);
    controller.abort();

    expect(await abandoned).toBe('The picture’s sound was abandoned.');
    const asked = sent.at(-2);
    expect(sent.at(-1)).toEqual({
      kind: 'cancel',
      request: asked?.kind === 'decode' ? asked.request : '',
    });
    const again = soundOf(await decode(file, stream, 1_000_000, new AbortController().signal));
    expect(again.frames).toBe(100_000);
  });

  it('says the decode’s failure where the worker ends it without its stream', async () => {
    const { codecs: thread } = codecs();
    const stream = await analysed(thread, await flacOf(StandardLayouts.stereo));
    const unstarted = failure(
      'codecs.worker-fault',
      FailureKind.Unrecoverable,
      'The codec worker stopped.',
    );

    const ended = await codecSoundDecoder({ decode: () => Promise.resolve(fail(unstarted)) })(
      new Blob([]),
      stream,
      1_000_000,
      new AbortController().signal,
    );

    expect(ended).toBe('The codec worker stopped.');
  });
});
