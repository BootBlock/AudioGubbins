import type {
  AudioDataLike,
  AudioDecoderCallbacks,
  BrowserAudioDecoding,
  CodecState,
  EncodedAudioChunkInit,
  EncodedAudioChunkLike,
  PlaneCopy,
  WebCodecsAudioConfig,
} from '@audiogubbins/capabilities';
import { succeed, type DomainResult } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import type { DecoderSession, EncodedPacket } from '../decoder-session.js';
import type { StreamDescription } from '../stream-description.js';
import { browserAacBlocks } from './browser-aac-blocks.js';
import type { DecodedBlock, DecodedBlocks } from './decoded-blocks.js';

/** Each packet decodes to this many frames, as HE-AAC's 2,048 do. */
const PACKET_FRAMES = 2_048;

/** The sample at `frame` of `channel` the fake decoder gives: distinct everywhere. */
const sampleAt = (channel: number, frame: number): number => channel * 1_000_000 + frame;

/** Decoded audio of the fake decoder: planar, each sample its own value. */
function audioData(
  start: number,
  frames: number,
  channels: number,
  rate: number,
): AudioDataLike & { closed: boolean } {
  const data = {
    sampleRate: rate,
    numberOfFrames: frames,
    numberOfChannels: channels,
    closed: false,
    copyTo: (destination: Float32Array, options: PlaneCopy) => {
      const offset = options.frameOffset ?? 0;
      const count = options.frameCount ?? frames - offset;
      for (let index = 0; index < count; index += 1) {
        destination[index] = sampleAt(options.planeIndex, start + offset + index);
      }
    },
    close: () => {
      data.closed = true;
    },
  };
  return data;
}

/** What the fake decoder saw, and how it behaves. */
interface FakeDecoderLog {
  configured: WebCodecsAudioConfig | undefined;
  readonly chunks: { readonly timestamp: number }[];
  mostQueued: number;
  closed: boolean;
  readonly outputs: (AudioDataLike & { closed: boolean })[];
}

/** A WebCodecs decoder that decodes each chunk a turn later into `PACKET_FRAMES` frames. */
function fakeDecoding(
  log: FakeDecoderLog,
  behaviour: {
    readonly rate?: number;
    readonly failAt?: number;
    readonly refuseConfig?: boolean;
  } = {},
): BrowserAudioDecoding {
  class FakeDecoder {
    state: CodecState = 'unconfigured';
    decodeQueueSize = 0;
    readonly #callbacks: AudioDecoderCallbacks;
    readonly #dequeue = new Set<() => void>();
    #produced = 0;
    #channels = 0;
    #rate = 0;

    constructor(callbacks: AudioDecoderCallbacks) {
      this.#callbacks = callbacks;
    }

    static isConfigSupported(): Promise<{ supported: boolean }> {
      return Promise.resolve({ supported: true });
    }

    configure(config: WebCodecsAudioConfig): void {
      if (behaviour.refuseConfig === true) throw new TypeError('Invalid configuration.');
      log.configured = config;
      this.#channels = config.numberOfChannels;
      this.#rate = behaviour.rate ?? config.sampleRate;
      this.state = 'configured';
    }

    decode(chunk: EncodedAudioChunkLike): void {
      log.chunks.push({ timestamp: chunk.timestamp });
      this.decodeQueueSize += 1;
      log.mostQueued = Math.max(log.mostQueued, this.decodeQueueSize);
      const index = log.chunks.length - 1;
      setTimeout(() => {
        this.decodeQueueSize -= 1;
        if (index === behaviour.failAt) {
          this.#callbacks.error(new DOMException('Bad data.', 'EncodingError'));
          return;
        }
        const data = audioData(this.#produced, PACKET_FRAMES, this.#channels, this.#rate);
        this.#produced += PACKET_FRAMES;
        log.outputs.push(data);
        this.#callbacks.output(data);
        for (const listener of this.#dequeue) listener();
      }, 0);
    }

    flush(): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, 5));
    }

    close(): void {
      this.state = 'closed';
      log.closed = true;
    }

    addEventListener(_type: 'dequeue', listener: () => void): void {
      this.#dequeue.add(listener);
    }

    removeEventListener(_type: 'dequeue', listener: () => void): void {
      this.#dequeue.delete(listener);
    }
  }
  class FakeChunk {
    readonly init: EncodedAudioChunkInit;
    readonly byteLength: number;
    readonly timestamp: number;
    constructor(init: EncodedAudioChunkInit) {
      this.init = init;
      this.byteLength = init.data.length;
      this.timestamp = init.timestamp;
    }
    copyTo(): void {
      throw new Error('Not read in this test.');
    }
  }
  return { AudioDecoder: FakeDecoder, EncodedAudioChunk: FakeChunk };
}

const HE_AAC: StreamDescription = {
  codec: 'he-aac',
  container: 'mp4',
  sampleRate: 44_100,
  channelCount: 2,
  layout: { kind: 'speakers', mask: 0b11 },
  totalFrames: undefined,
  priming: undefined,
  padding: undefined,
  bitRate: 48_000,
  bitsPerSample: undefined,
  decodable: false,
  codecConfig: Uint8Array.of(0x2b, 0x92, 0x08, 0x00),
};

/** A session of `packets` packets of HE-AAC, which records whether it was released. */
function heAacSession(packets: number, description: Partial<StreamDescription> = {}) {
  let read = 0;
  const state = { released: false };
  const session: DecoderSession = {
    description: { ...HE_AAC, ...description },
    decode: () => {
      throw new Error('HE-AAC is never decoded by the module.');
    },
    readPacket: (): DomainResult<EncodedPacket | undefined> => {
      if (read === packets) return succeed(undefined);
      read += 1;
      return succeed({ data: Uint8Array.of(read & 0xff, 1, 2, 3), frames: 1_024 });
    },
    release: () => {
      state.released = true;
    },
  };
  return { session, state };
}

function newLog(): FakeDecoderLog {
  return { configured: undefined, chunks: [], mostQueued: 0, closed: false, outputs: [] };
}

/** Every block of `blocks`, or the code of the failure that ended them. */
async function drain(blocks: DecodedBlocks): Promise<DecodedBlock[] | string> {
  const all: DecodedBlock[] = [];
  for (;;) {
    const next = await blocks.next();
    if (!next.ok) return next.failures[0].code;
    if (next.value === undefined) return all;
    all.push(next.value);
  }
}

describe('HE-AAC decoded by the browser', () => {
  it('feeds the module’s packets to the decoder configured from the stream, and streams every frame', async () => {
    const log = newLog();
    const { session, state } = heAacSession(100);
    const made = browserAacBlocks(session, HE_AAC.codecConfig, fakeDecoding(log));
    if (!made.ok) throw new Error(made.failures[0].summary);
    const blocks = await drain(made.value);
    if (typeof blocks === 'string') throw new Error(blocks);
    expect(log.configured).toEqual({
      codec: 'mp4a.40.5',
      sampleRate: 44_100,
      numberOfChannels: 2,
      description: HE_AAC.codecConfig,
    });
    expect(log.chunks.map((chunk) => chunk.timestamp).slice(0, 3)).toEqual([0, 23_220, 46_440]);
    const total = blocks.reduce((sum, block) => sum + block.frames, 0);
    expect(total).toBe(100 * PACKET_FRAMES);
    expect(blocks.slice(0, -1).every((block) => block.frames === 65_536)).toBe(true);
    // Planar, in the decoder's channel order, every frame once and in order.
    let at = 0;
    for (const block of blocks) {
      block.channels.forEach((plane, channel) => {
        expect(plane[0]).toBe(sampleAt(channel, at));
        expect(plane[block.frames - 1]).toBe(sampleAt(channel, at + block.frames - 1));
      });
      at += block.frames;
    }
    expect(log.mostQueued).toBeLessThanOrEqual(16);
    expect(log.outputs.every((data) => data.closed)).toBe(true);
    made.value.release();
    expect(log.closed).toBe(true);
    expect(state.released).toBe(true);
  });

  it('trims the priming the file states and ends at the frames it states', async () => {
    const log = newLog();
    const { session } = heAacSession(40, { priming: 2_112, totalFrames: 70_000 });
    const made = browserAacBlocks(session, HE_AAC.codecConfig, fakeDecoding(log));
    if (!made.ok) throw new Error(made.failures[0].summary);
    const blocks = await drain(made.value);
    if (typeof blocks === 'string') throw new Error(blocks);
    expect(blocks.reduce((sum, block) => sum + block.frames, 0)).toBe(70_000);
    expect(blocks[0]?.channels[1]?.[0]).toBe(sampleAt(1, 2_112));
    const last = blocks.at(-1);
    expect(last?.channels[0]?.[last.frames - 1]).toBe(sampleAt(0, 2_112 + 70_000 - 1));
    made.value.release();
  });

  it('configures HE-AACv2 by its object type', () => {
    const log = newLog();
    const { session } = heAacSession(1);
    // Object type 29, SBR with parametric stereo.
    const made = browserAacBlocks(session, Uint8Array.of(0xe9, 0x92), fakeDecoding(log));
    expect(made.ok).toBe(true);
    expect(log.configured?.codec).toBe('mp4a.40.29');
    if (made.ok) made.value.release();
  });

  it('fails the stream where the decoder fails part way, or gives another rate', async () => {
    const failing = newLog();
    const first = browserAacBlocks(
      heAacSession(80).session,
      HE_AAC.codecConfig,
      fakeDecoding(failing, { failAt: 50 }),
    );
    if (!first.ok) throw new Error(first.failures[0].summary);
    expect(await drain(first.value)).toBe('codec-runtime.browser-decode-failed');
    first.value.release();
    expect(failing.closed).toBe(true);

    const resampling = newLog();
    const second = browserAacBlocks(
      heAacSession(10).session,
      HE_AAC.codecConfig,
      fakeDecoding(resampling, { rate: 48_000 }),
    );
    if (!second.ok) throw new Error(second.failures[0].summary);
    expect(await drain(second.value)).toBe('codec-runtime.browser-decode-mismatch');
    second.value.release();
  });

  it('refuses a configuration the decoder refuses, leaving the session to its caller', () => {
    const log = newLog();
    const { session, state } = heAacSession(1);
    const made = browserAacBlocks(
      session,
      HE_AAC.codecConfig,
      fakeDecoding(log, { refuseConfig: true }),
    );
    expect(made.ok ? undefined : made.failures[0].code).toBe('codec-runtime.browser-decode-failed');
    expect(log.closed).toBe(true);
    expect(state.released).toBe(false);
  });
});
