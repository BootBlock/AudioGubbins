/**
 * AAC exports (ADR-0091): AAC-LC encoded by the browser's WebCodecs encoder
 * (`mp4a.40.2`) and written into M4A by the application's MP4 writer. Each
 * browser's encoder is its own, so the bytes are not reproducible, which the
 * registry states and the export record carries.
 *
 * The encoder answers its chunks through a callback, so the units of each block
 * are those it has answered by the time the block is queued, and the rest
 * arrive with later blocks or the flush at the end. A block waits while more
 * than {@link MAXIMUM_QUEUED} are queued, so the encoder never holds a growing
 * backlog of audio. The writer's AudioSpecificConfig is the decoder
 * configuration the encoder states with its first chunk, and its priming is how
 * far that chunk's timestamp lies before the first frame given: an encoder
 * whose first chunk starts at the first frame states no priming. The channels
 * are given in the speaker mask's order, the order WebCodecs implementations
 * take a layout of their count in.
 */

import {
  Mp4AacWriter,
  type AudioFileWriter,
  type EncodedStreamLength,
  type SamplePlane,
  type WrittenChannelOrder,
} from '@audiogubbins/codecs';
import type {
  AudioEncoderLike,
  BrowserAudioEncoding,
  EncodedAudioChunkLike,
  EncodedAudioChunkMetadata,
  WebCodecsAudioConfig,
} from '@audiogubbins/capabilities';
import { fail, succeed, type DomainFailure, type DomainResult } from '@audiogubbins/domain';
import type { AacEncoding } from '@audiogubbins/import-export';

import { browserEncoderFailed, encoderUnavailable } from './encoding-failures.js';
import type { ExportEncodeRequest } from '../worker/codec-worker-messages.js';
import { Float32Planes } from './float32-planes.js';
import { FramedFileWriter, type UnitEncoder } from './framed-file-writer.js';

/** WebCodecs' name for AAC-LC (RFC 6381). */
const AAC_LC = 'mp4a.40.2';

/** The most blocks the encoder may hold queued before a block waits. */
const MAXIMUM_QUEUED = 2;

const MICROSECONDS = 1_000_000;

/** The bytes of a decoder configuration's description, copied, or `undefined` where it is none. */
function bytesOf(description: unknown): Uint8Array | undefined {
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(
      description.buffer,
      description.byteOffset,
      description.byteLength,
    ).slice();
  }
  return description instanceof ArrayBuffer ? new Uint8Array(description).slice() : undefined;
}

/** What the encoder stated with its first chunk. */
interface FirstChunk {
  readonly audioSpecificConfig: Uint8Array | undefined;
  readonly primingFrames: number;
}

/** The access units of one AAC stream, from the browser's encoder. */
class AacUnits implements UnitEncoder<EncodedStreamLength> {
  readonly #encoder: AudioEncoderLike;
  readonly #webCodecs: BrowserAudioEncoding;
  readonly #sampleRate: number;
  readonly #planes = new Float32Planes();
  #answered: Uint8Array[] = [];
  #first: FirstChunk | undefined;
  #failure: DomainFailure | undefined;
  /**
   * Settles with the encoder's failure once its error callback says it. The
   * browser closes an encoder that fails, a configuration it refuses only
   * after `configure` returns among them, before the callback runs; a block
   * given to it then is refused as given to a closed codec, which says
   * nothing of why, and a block waiting for the queue to drain hears no more.
   */
  readonly #errored: Promise<DomainFailure>;
  #frames = 0;
  #closed = false;

  constructor(webCodecs: BrowserAudioEncoding, sampleRate: number) {
    this.#webCodecs = webCodecs;
    this.#sampleRate = sampleRate;
    let errored: (failure: DomainFailure) => void = () => undefined;
    this.#errored = new Promise((resolve) => {
      errored = resolve;
    });
    this.#encoder = new webCodecs.AudioEncoder({
      output: (chunk, metadata) => {
        this.#output(chunk, metadata);
      },
      error: (error) => {
        this.#failure ??= browserEncoderFailed(
          `The browser's AAC encoder failed: ${error.message}`,
        );
        errored(this.#failure);
      },
    });
  }

  /** The configuration and priming the first chunk stated, once it has come. */
  get first(): FirstChunk | undefined {
    return this.#first;
  }

  /** Configures the encoder, or says why the browser refused the configuration. */
  configure(config: WebCodecsAudioConfig): DomainResult<undefined> {
    try {
      this.#encoder.configure(config);
      return succeed(undefined);
    } catch (error) {
      // WebCodecs throws a TypeError for a configuration it cannot read and a
      // DOMException for one it will not encode; either leaves no encoder.
      if (!(error instanceof TypeError || error instanceof DOMException)) throw error;
      this.release();
      return fail(
        encoderUnavailable(`The browser's AAC encoder refused its configuration: ${error.message}`),
      );
    }
  }

  async encode(
    planes: readonly SamplePlane[],
    frames: number,
  ): Promise<DomainResult<readonly Uint8Array[]>> {
    if (this.#failure !== undefined) return fail(this.#failure);
    if (this.#encoder.state === 'closed') return fail(await this.#errored);
    if (frames > 0) {
      const samples = this.#planes.of(planes, frames);
      const data = new Float32Array(samples.length * frames);
      samples.forEach((plane, channel) => {
        data.set(plane, channel * frames);
      });
      const audio = new this.#webCodecs.AudioData({
        format: 'f32-planar',
        sampleRate: this.#sampleRate,
        numberOfFrames: frames,
        numberOfChannels: samples.length,
        timestamp: Math.round((this.#frames * MICROSECONDS) / this.#sampleRate),
        data,
      });
      this.#encoder.encode(audio);
      audio.close();
      this.#frames += frames;
      await this.#queueBelowLimit();
    }
    // The encoder's error callback may have run while the block waited.
    const failure = this.#failureSoFar();
    return failure === undefined ? succeed(this.#take()) : fail(failure);
  }

  async finish(): Promise<
    DomainResult<{ readonly units: readonly Uint8Array[]; readonly end: EncodedStreamLength }>
  > {
    if (this.#failure === undefined && this.#encoder.state === 'closed') await this.#errored;
    if (this.#failure === undefined) {
      try {
        await this.#encoder.flush();
      } catch (error) {
        // A flush rejects with the error that closed the encoder, which its
        // error callback has stated already.
        if (!(error instanceof DOMException)) throw error;
        this.#failure ??= browserEncoderFailed(
          `The browser's AAC encoder failed: ${error.message}`,
        );
      }
    }
    if (this.#failure !== undefined) return fail(this.#failure);
    return succeed({ units: this.#take(), end: { inputFrames: this.#frames } });
  }

  release(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#encoder.close();
  }

  #output(chunk: EncodedAudioChunkLike, metadata: EncodedAudioChunkMetadata | undefined): void {
    if (this.#first === undefined) {
      const description = metadata?.decoderConfig?.description;
      this.#first = {
        audioSpecificConfig: bytesOf(description),
        primingFrames:
          chunk.timestamp < 0
            ? Math.round((-chunk.timestamp * this.#sampleRate) / MICROSECONDS)
            : 0,
      };
    }
    const bytes = new Uint8Array(chunk.byteLength);
    chunk.copyTo(bytes);
    this.#answered.push(bytes);
  }

  /** What failed, as the callbacks have said by now. */
  #failureSoFar(): DomainFailure | undefined {
    return this.#failure;
  }

  #take(): readonly Uint8Array[] {
    const taken = this.#answered;
    this.#answered = [];
    return taken;
  }

  async #queueBelowLimit(): Promise<void> {
    while (this.#encoder.encodeQueueSize > MAXIMUM_QUEUED && this.#failure === undefined) {
      let dequeued = (): void => undefined;
      await Promise.race([
        new Promise<void>((resolve) => {
          dequeued = resolve;
          this.#encoder.addEventListener('dequeue', dequeued);
        }),
        this.#errored,
      ]);
      this.#encoder.removeEventListener('dequeue', dequeued);
    }
  }
}

/** An AAC export's writer, on the browser's encoder, or why there is none. */
export function openAacWriter(
  request: ExportEncodeRequest,
  encoding: AacEncoding,
  webCodecs: BrowserAudioEncoding | undefined,
  order: WrittenChannelOrder,
): DomainResult<AudioFileWriter> {
  if (webCodecs === undefined) {
    return fail(
      encoderUnavailable(
        'This browser has no AAC encoder, so AAC cannot be exported here; Opus, Vorbis and MP3 can.',
      ),
    );
  }
  const units = new AacUnits(webCodecs, request.sampleRate);
  const configured = units.configure({
    codec: AAC_LC,
    sampleRate: request.sampleRate,
    numberOfChannels: order.length,
    bitrate: encoding.bitRate * 1_000,
  });
  if (!configured.ok) return configured;
  const openFramer = () => {
    const first = units.first;
    if (first?.audioSpecificConfig === undefined) {
      return fail(
        browserEncoderFailed(
          "The browser's AAC encoder stated no AudioSpecificConfig with its first chunk.",
        ),
      );
    }
    return Mp4AacWriter.create({
      audioSpecificConfig: first.audioSpecificConfig,
      primingFrames: first.primingFrames,
      metadata: request.metadata,
    });
  };
  return succeed(new FramedFileWriter(units, openFramer, order));
}
