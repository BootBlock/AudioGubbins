/**
 * AAC exports through a fake of the browser's WebCodecs encoder (ADR-0091):
 * the M4A file states the AudioSpecificConfig the encoder answered, its
 * priming from the first chunk's timestamp, and the length it was given; a
 * full queue holds the next block back; and an encoder's failure, or its
 * absence, is the export's.
 */

import type {
  AudioDataInit,
  AudioDataLike,
  AudioEncoderCallbacks,
  AudioEncoderLike,
  BrowserAudioEncoding,
  CodecState,
  ConfigSupport,
  EncodedAudioChunkLike,
  WebCodecsAudioConfig,
} from '@audiogubbins/capabilities';
import { StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { codecModule } from '../testing/codec-module.js';
import {
  encodeWhole,
  exportRequest,
  testServices,
  testSignal,
} from '../testing/export-encoding.js';
import { memoryBytes } from '../testing/memory-bytes.js';
import { openExportEncoder } from './open-export-encoder.js';

const RATE = 48_000;
const AAC_FRAME = 1_024;

/** The sampling-frequency index of each rate an AudioSpecificConfig names (ISO/IEC 14496-3). */
const RATE_INDEX: ReadonlyMap<number, number> = new Map([
  [96_000, 0],
  [88_200, 1],
  [64_000, 2],
  [48_000, 3],
  [44_100, 4],
  [32_000, 5],
  [24_000, 6],
]);

/** An AAC-LC AudioSpecificConfig: object type 2, the rate's index, the channel configuration. */
function audioSpecificConfig(rate: number, channels: number): Uint8Array {
  const bits = (2 << 11) | ((RATE_INDEX.get(rate) ?? 15) << 7) | (channels << 3);
  return Uint8Array.of(bits >> 8, bits & 0xff);
}

/** What a fake `AudioData` was made with. */
class FakeAudioData implements AudioDataLike {
  readonly init: AudioDataInit;
  closed = false;

  constructor(init: AudioDataInit) {
    this.init = init;
  }

  get sampleRate(): number {
    return this.init.sampleRate;
  }

  get numberOfFrames(): number {
    return this.init.numberOfFrames;
  }

  get numberOfChannels(): number {
    return this.init.numberOfChannels;
  }

  copyTo(): void {
    throw new TypeError('The export never reads back the audio it hands an encoder.');
  }

  close(): void {
    this.closed = true;
  }
}

/** One fake chunk: its bytes name its index. */
function chunk(index: number, timestamp: number): EncodedAudioChunkLike {
  const bytes = Uint8Array.of(0x21, index & 0xff, (index >> 8) & 0xff);
  return {
    timestamp,
    byteLength: bytes.length,
    copyTo: (into) => {
      into.set(bytes);
    },
  };
}

/** How the fake behaves. */
interface FakeOptions {
  /** Frames of priming before the first frame given, stated by the first chunk's timestamp. */
  readonly priming: number;
  /** Fails the encoder once this many chunks have been answered. */
  readonly failAfter?: number;
}

/**
 * A fake AAC encoder: each queued block is taken a microtask later, as a
 * browser takes it apart from the caller, and answered as chunks of 1024
 * frames, the first `priming` frames of silence before the first frame.
 */
function fakeWebCodecs(options: FakeOptions): {
  readonly webCodecs: BrowserAudioEncoding;
  readonly log: {
    highestQueue: number;
    configured: WebCodecsAudioConfig | undefined;
    closed: boolean;
  };
} {
  const log = {
    highestQueue: 0,
    configured: undefined as WebCodecsAudioConfig | undefined,
    closed: false,
  };
  class FakeEncoder implements AudioEncoderLike {
    readonly #init: AudioEncoderCallbacks;
    readonly #queue: number[] = [];
    readonly #listeners = new Set<() => void>();
    #pending = options.priming;
    #chunks = 0;
    #failed = false;

    static isConfigSupported(): Promise<ConfigSupport> {
      return Promise.resolve({ supported: true });
    }

    readonly state: CodecState = 'configured';

    constructor(init: AudioEncoderCallbacks) {
      this.#init = init;
    }

    get encodeQueueSize(): number {
      return this.#queue.length;
    }

    configure(config: WebCodecsAudioConfig): void {
      log.configured = config;
    }

    encode(data: AudioDataLike): void {
      if (!(data instanceof FakeAudioData)) throw new TypeError('Not the fake’s AudioData.');
      this.#queue.push(data.init.numberOfFrames);
      log.highestQueue = Math.max(log.highestQueue, this.#queue.length);
      queueMicrotask(() => {
        this.#take();
      });
    }

    async flush(): Promise<void> {
      await Promise.resolve();
      while (this.#queue.length > 0) this.#take();
      if (this.#failed) throw new DOMException('The encoder failed.', 'EncodingError');
      if (this.#pending > 0) this.#answer(1);
    }

    close(): void {
      log.closed = true;
    }

    addEventListener(_type: 'dequeue', listener: () => void): void {
      this.#listeners.add(listener);
    }

    removeEventListener(_type: 'dequeue', listener: () => void): void {
      this.#listeners.delete(listener);
    }

    #take(): void {
      const frames = this.#queue.shift();
      if (frames === undefined) return;
      this.#pending += frames;
      this.#answer(Math.floor(this.#pending / AAC_FRAME));
      for (const listener of [...this.#listeners]) listener();
    }

    #answer(count: number): void {
      for (let index = 0; index < count && !this.#failed; index += 1) {
        if (options.failAfter !== undefined && this.#chunks === options.failAfter) {
          this.#failed = true;
          this.#init.error(new DOMException('The encoder failed.', 'EncodingError'));
          return;
        }
        const start = this.#chunks * AAC_FRAME - options.priming;
        const description = audioSpecificConfig(RATE, 2);
        this.#init.output(
          chunk(this.#chunks, Math.round((start * 1_000_000) / RATE)),
          this.#chunks === 0 ? { decoderConfig: { description } } : undefined,
        );
        this.#chunks += 1;
        this.#pending = Math.max(0, this.#pending - AAC_FRAME);
      }
    }
  }
  return { webCodecs: { AudioEncoder: FakeEncoder, AudioData: FakeAudioData }, log };
}

const AAC = { format: 'aac', encoding: { bitRate: 192 } } as const;

describe('AAC exports through the browser’s encoder', () => {
  it('states the encoder’s configuration, its priming and the length given, in M4A', async () => {
    const frames = 20_000;
    const { webCodecs, log } = fakeWebCodecs({ priming: 1_024 });
    const file = await encodeWhole(
      exportRequest(AAC, RATE),
      testSignal(2, frames, RATE),
      testServices(webCodecs),
      2_000,
    );
    expect(log.configured).toEqual({
      codec: 'mp4a.40.2',
      sampleRate: RATE,
      numberOfChannels: 2,
      bitrate: 192_000,
    });
    expect(log.closed).toBe(true);
    // Each block waited while more than two were queued.
    expect(log.highestQueue).toBeLessThanOrEqual(3);
    const module = await codecModule();
    const session = expectSuccess(module.openDecoder(memoryBytes(file)));
    expect(session.description).toMatchObject({
      codec: 'aac-lc',
      container: 'mp4',
      sampleRate: RATE,
      channelCount: 2,
      priming: 1_024,
      totalFrames: frames,
    });
    session.release();
  });

  it('states no priming where the first chunk starts at the first frame', async () => {
    const { webCodecs } = fakeWebCodecs({ priming: 0 });
    const file = await encodeWhole(
      exportRequest(AAC, RATE),
      testSignal(2, 5_000, RATE),
      testServices(webCodecs),
    );
    const module = await codecModule();
    const session = expectSuccess(module.openDecoder(memoryBytes(file)));
    expect(session.description).toMatchObject({ priming: 0, totalFrames: 5_000 });
    session.release();
  });

  it('fails the export where the encoder fails, and releases it', async () => {
    const { webCodecs, log } = fakeWebCodecs({ priming: 1_024, failAfter: 3 });
    const writer = expectSuccess(
      await openExportEncoder(exportRequest(AAC, RATE), testServices(webCodecs)),
    );
    const source = testSignal(2, 10_000, RATE);
    const written = await writer.write(source, 10_000);
    const finished = written.ok ? await writer.finish() : written;
    expect(expectFailureCode(finished)).toBe('codec-runtime.browser-encoder-failed');
    expect(log.closed).toBe(true);
  });

  it('is unavailable, naming the formats that are, where the browser has no encoder', async () => {
    const opened = await openExportEncoder(
      exportRequest(AAC, RATE, StandardLayouts.stereo),
      testServices(),
    );
    expect(expectFailureCode(opened)).toBe('codec-runtime.encoder-unavailable');
  });
});
