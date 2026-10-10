/**
 * HE-AAC decoded by the browser's own decoder (ADR-0091): the codec module
 * demultiplexes the file and describes the stream, and its undecoded packets
 * are fed to WebCodecs' `AudioDecoder`, where the browser was probed to decode
 * both forms of HE-AAC; no local decoder serves it.
 *
 * The decoder is configured with the stream's `AudioSpecificConfig`, its
 * container's or, for ADTS, its first frame header's, and the codec string of
 * the form it names: SBR with parametric stereo where it names object type 29,
 * SBR otherwise, which a decoder also finds signalled implicitly in the data.
 * Its output is copied out as planar 32-bit floats, its channels taken in the
 * order the decoder gives them, which for the AAC channel configurations is
 * the speaker-mask order every other decode is in; a block of another rate or
 * channel count than the stream states fails the decode, which is never
 * resampled. The priming the file states is trimmed from the start and the
 * stream ends at the frames it states, as the module trims its own decodes.
 *
 * At most {@link MOST_QUEUED_PACKETS} packets wait in the decoder, and its
 * output is taken a block at a time, so a decode holds a bounded amount
 * whatever the file's length. Any failure, the decoder's or the file's, fails
 * the whole stream.
 */

import type {
  AudioDataLike,
  AudioDecoderLike,
  BrowserAudioDecoding,
} from '@audiogubbins/capabilities';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import type { DecoderSession } from '../decoder-session.js';
import { thrownName } from '../thrown-name.js';
import {
  blockFrames,
  trimmedPlanes,
  type DecodedBlock,
  type DecodedBlocks,
} from './decoded-blocks.js';

/** The most packets fed to the decoder and not yet decoded. */
const MOST_QUEUED_PACKETS = 16;

/** The object type of SBR with parametric stereo, HE-AACv2. */
const PARAMETRIC_STEREO_OBJECT_TYPE = 29;

const MICROSECONDS = 1_000_000;

/** The codec string of the HE-AAC form `config`, an `AudioSpecificConfig`, names. */
function codecStringOf(config: Uint8Array): string {
  const objectType = (config[0] ?? 0) >> 3;
  return objectType === PARAMETRIC_STEREO_OBJECT_TYPE ? 'mp4a.40.29' : 'mp4a.40.5';
}

/** The failure of the browser's decoder, naming what it threw or reported. */
function decoderFailure(thrown: unknown): DomainFailure {
  return failure(
    'codec-runtime.browser-decode-failed',
    FailureKind.IntegrityViolation,
    "The browser's decoder could not decode the file's audio, so none of it is kept.",
    { details: { cause: thrownName(thrown) } },
  );
}

/** Decoded audio taken in part: what of it has been copied out. */
interface PartlyTaken {
  readonly data: AudioDataLike;
  offset: number;
}

class BrowserAacBlocks implements DecodedBlocks {
  readonly #session: DecoderSession;
  readonly #decoding: BrowserAudioDecoding;
  readonly #decoder: AudioDecoderLike;
  readonly #channels: number;
  readonly #sampleRate: number;
  readonly #frames: number;
  readonly #outputs: AudioDataLike[] = [];
  readonly #wakeOnDequeue = (): void => {
    this.#wake();
  };
  #current: PartlyTaken | undefined;
  #waiting: (() => void) | undefined;
  #failure: DomainFailure | undefined;
  #fedFrames = 0;
  #packetsDone = false;
  #flush: 'not-started' | 'flushing' | 'flushed' = 'not-started';
  /** The frames still to trim from the start. */
  #skip: number;
  /** The frames still to answer before the stated end. */
  #remaining: number;
  #ended = false;

  constructor(session: DecoderSession, decoding: BrowserAudioDecoding) {
    const { description } = session;
    this.#session = session;
    this.#decoding = decoding;
    this.#channels = description.channelCount;
    this.#sampleRate = description.sampleRate;
    this.#frames = blockFrames(description.channelCount);
    this.#skip = description.priming ?? 0;
    this.#remaining = description.totalFrames ?? Number.POSITIVE_INFINITY;
    this.#decoder = new decoding.AudioDecoder({
      output: (data) => {
        this.#outputs.push(data);
        this.#wake();
      },
      error: (error) => {
        this.#failure ??= decoderFailure(error);
        this.#wake();
      },
    });
    this.#decoder.addEventListener('dequeue', this.#wakeOnDequeue);
  }

  /** Configures the decoder with `config`, refusing a configuration it holds invalid. */
  configure(config: Uint8Array): DomainResult<undefined> {
    try {
      this.#decoder.configure({
        codec: codecStringOf(config),
        sampleRate: this.#sampleRate,
        numberOfChannels: this.#channels,
        description: config,
      });
    } catch (error) {
      // `configure` throws a `TypeError` for a configuration it holds invalid.
      return fail(decoderFailure(error));
    }
    return succeed(undefined);
  }

  #wake(): void {
    const waiting = this.#waiting;
    this.#waiting = undefined;
    waiting?.();
  }

  /** Resolves when the decoder next outputs, takes a packet, fails or finishes flushing. */
  #changed(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#waiting = resolve;
    });
  }

  /** Feeds the decoder the next packet, or notes that none are left. */
  #feedNext(): void {
    const packet = this.#session.readPacket();
    if (!packet.ok) {
      this.#failure = packet.failures[0];
      return;
    }
    if (packet.value === undefined) {
      this.#packetsDone = true;
      return;
    }
    const chunk = new this.#decoding.EncodedAudioChunk({
      type: 'key',
      timestamp: Math.round((this.#fedFrames * MICROSECONDS) / this.#sampleRate),
      data: packet.value.data,
    });
    this.#fedFrames += packet.value.frames;
    this.#decoder.decode(chunk);
  }

  #startFlush(): void {
    this.#flush = 'flushing';
    this.#decoder.flush().then(
      () => {
        this.#flush = 'flushed';
        this.#wake();
      },
      (error: unknown) => {
        this.#failure ??= decoderFailure(error);
        this.#wake();
      },
    );
  }

  /** Why decoded audio is not of the stream's shape, or `undefined` where it is. */
  #mismatch(data: AudioDataLike): DomainFailure | undefined {
    if (data.sampleRate === this.#sampleRate && data.numberOfChannels === this.#channels) {
      return undefined;
    }
    return failure(
      'codec-runtime.browser-decode-mismatch',
      FailureKind.IntegrityViolation,
      `The browser's decoder gave ${String(data.numberOfChannels)} channels at ${String(data.sampleRate)} Hz of a stream that states ${String(this.#channels)} at ${String(this.#sampleRate)} Hz, so none of it is kept.`,
    );
  }

  /**
   * Copies what fits of the decoded audio at the head of the output into
   * `planes` from `filled`, trimming the priming and stopping at the stated
   * end, and answers the frames copied, or the failure of audio not of the
   * stream's shape.
   */
  #take(planes: readonly Float32Array[], filled: number): DomainResult<number> {
    const current = this.#current ?? { data: this.#outputs.shift(), offset: 0 };
    const { data } = current;
    if (data === undefined) return succeed(0);
    if (this.#current === undefined) {
      const mismatch = this.#mismatch(data);
      if (mismatch !== undefined) {
        data.close();
        return fail(mismatch);
      }
      this.#current = { data, offset: 0 };
    }
    const taken = this.#current;
    const skipped = Math.min(this.#skip, data.numberOfFrames - taken.offset);
    this.#skip -= skipped;
    taken.offset += skipped;
    const count = Math.min(
      data.numberOfFrames - taken.offset,
      this.#frames - filled,
      this.#remaining,
    );
    planes.forEach((plane, channel) => {
      if (count === 0) return;
      data.copyTo(plane.subarray(filled, filled + count), {
        planeIndex: channel,
        format: 'f32-planar',
        frameOffset: taken.offset,
        frameCount: count,
      });
    });
    taken.offset += count;
    this.#remaining -= count;
    if (taken.offset === data.numberOfFrames || this.#remaining === 0) {
      data.close();
      this.#current = undefined;
    }
    return succeed(count);
  }

  /** Whether the stream has ended: its stated end reached, or every output taken after the flush. */
  #atEnd(): boolean {
    return (
      this.#remaining === 0 ||
      (this.#flush === 'flushed' && this.#current === undefined && this.#outputs.length === 0)
    );
  }

  async next(): Promise<DomainResult<DecodedBlock | undefined>> {
    if (this.#ended) return succeed(undefined);
    const planes = Array.from({ length: this.#channels }, () => new Float32Array(this.#frames));
    let filled = 0;
    while (filled < this.#frames) {
      if (this.#failure !== undefined) return fail(this.#failure);
      if (this.#current !== undefined || this.#outputs.length > 0) {
        const taken = this.#take(planes, filled);
        if (!taken.ok) return taken;
        filled += taken.value;
      } else if (this.#atEnd()) {
        this.#ended = true;
        break;
      } else if (!this.#packetsDone && this.#decoder.decodeQueueSize < MOST_QUEUED_PACKETS) {
        try {
          this.#feedNext();
        } catch (error) {
          // A decoder closed under the feed, or a chunk it refuses, throws.
          this.#failure ??= decoderFailure(error);
        }
      } else if (this.#packetsDone && this.#flush === 'not-started') {
        this.#startFlush();
      } else {
        await this.#changed();
      }
      if (this.#remaining === 0) {
        this.#ended = true;
        break;
      }
    }
    if (filled === 0) return succeed(undefined);
    return succeed({ channels: trimmedPlanes(planes, filled), frames: filled });
  }

  /** Closes the decoder and any audio it gave that was not taken. */
  closeDecoder(): void {
    this.#current?.data.close();
    this.#current = undefined;
    for (const data of this.#outputs.splice(0)) data.close();
    this.#decoder.removeEventListener('dequeue', this.#wakeOnDequeue);
    if (this.#decoder.state !== 'closed') this.#decoder.close();
  }

  release(): void {
    this.closeDecoder();
    this.#session.release();
  }
}

/**
 * The blocks of the HE-AAC stream `session` describes, decoded by the
 * browser's decoder configured with `config`, its `AudioSpecificConfig`; the
 * blocks release the session. A configuration the decoder refuses fails
 * here, and the session stays the caller's.
 */
export function browserAacBlocks(
  session: DecoderSession,
  config: Uint8Array,
  decoding: BrowserAudioDecoding,
): DomainResult<DecodedBlocks> {
  const blocks = new BrowserAacBlocks(session, decoding);
  const configured = blocks.configure(config);
  if (!configured.ok) {
    blocks.closeDecoder();
    return configured;
  }
  return succeed(blocks);
}
