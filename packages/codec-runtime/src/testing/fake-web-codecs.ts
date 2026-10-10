/**
 * A fake of the browser's WebCodecs AAC encoder, for the export's tests: each
 * queued block is taken a microtask later, as a browser takes it apart from
 * the caller, and answered as chunks of 1024 frames whose bytes name their
 * index, the first stating the AudioSpecificConfig of AAC-LC at the rate and
 * channels it was made for and its priming by its timestamp. The audio is not
 * coded; the file it makes is real M4A around those chunks.
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
export interface FakeOptions {
  /** The rate and channels its AudioSpecificConfig states; 48 kHz stereo where not given. */
  readonly sampleRate?: number;
  readonly channels?: number;

  /** Frames of priming before the first frame given, stated by the first chunk's timestamp. */
  readonly priming: number;
  /** Fails the encoder once this many chunks have been answered. */
  readonly failAfter?: number;
}

/** What the fake was asked and did, for a test to check. */
export interface FakeLog {
  highestQueue: number;
  configured: WebCodecsAudioConfig | undefined;
  closed: boolean;
}

/**
 * A fake AAC encoder: each queued block is taken a microtask later, as a
 * browser takes it apart from the caller, and answered as chunks of 1024
 * frames, the first `priming` frames of silence before the first frame.
 */
export function fakeWebCodecs(options: FakeOptions): {
  readonly webCodecs: BrowserAudioEncoding;
  readonly log: FakeLog;
} {
  const log: FakeLog = { highestQueue: 0, configured: undefined, closed: false };
  const rate = options.sampleRate ?? 48_000;
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
        const description = audioSpecificConfig(rate, options.channels ?? 2);
        this.#init.output(
          chunk(this.#chunks, Math.round((start * 1_000_000) / rate)),
          this.#chunks === 0 ? { decoderConfig: { description } } : undefined,
        );
        this.#chunks += 1;
        this.#pending = Math.max(0, this.#pending - AAC_FRAME);
      }
    }
  }
  return { webCodecs: { AudioEncoder: FakeEncoder, AudioData: FakeAudioData }, log };
}
