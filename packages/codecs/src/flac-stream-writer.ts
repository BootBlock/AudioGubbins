/**
 * A FLAC file made from an encoder's frames (RFC 9639).
 *
 * The frames are the body, each written as the encoder answered it. The head
 * waits for the end, since its stream information states what only the whole
 * stream shows: the smallest and largest frame, the count of samples, and the
 * MD5 signature of the samples. The map's metadata blocks follow it. Every
 * frame is checked: its header's checksum, its format against the stream's, its number
 * in sequence, and its block size, which only the last frame may make smaller.
 */

import { fail, succeed, type DomainFailureResult, type DomainResult } from '@audiogubbins/domain';

import { ByteWriter } from './byte-writer.js';
import type { EncodedStreamWriter, FinishedEncodedStream } from './encoded-stream-writer.js';
import { readFlacFrameHeader, type FlacStreamFormat } from './flac-frame-header.js';
import {
  FlacBlockType,
  encodeFlacBlock,
  flacMetadataBlocks,
  type FlacBlock,
  type FlacMetadataSettings,
} from './flac-metadata-blocks.js';
import type { FlacSampleDigest } from './flac-sample-digest.js';
import { invalidEncodedStream, unwritableStream, writerEnded } from './framing-failures.js';

/** What a FLAC file states beyond its frames. */
export interface FlacStreamSettings extends FlacStreamFormat, FlacMetadataSettings {
  /** The block size of every frame but the last, which the encoder keeps fixed. */
  readonly blockSize: number;
}

/** The end of a FLAC stream: the signature of the samples the frames were encoded from. */
export interface FlacStreamEnd {
  readonly samples: FlacSampleDigest;
}

const inRange = (value: number, low: number, high: number): boolean =>
  Number.isInteger(value) && value >= low && value <= high;

/** Why the settings cannot be stated in stream information, or `undefined` where they can. */
function settingsProblem(settings: FlacStreamSettings): string | undefined {
  if (!inRange(settings.sampleRate, 1, 0xfffff))
    return 'A FLAC sample rate must be 1 to 1,048,575 Hz.';
  if (!inRange(settings.channels, 1, 8)) return 'A FLAC stream holds one to eight channels.';
  if (!inRange(settings.bitsPerSample, 4, 32)) return 'A FLAC sample is 4 to 32 bits.';
  if (!inRange(settings.blockSize, 16, 0xffff)) return 'A FLAC block is 16 to 65,535 samples.';
  return undefined;
}

/** A FLAC file being written. */
export class FlacStreamWriter implements EncodedStreamWriter<FlacStreamEnd> {
  private readonly settings: FlacStreamSettings;
  private ended = false;
  private frames = 0;
  private samples = 0;
  private shortFrameSeen = false;
  private minimumFrameBytes = Number.POSITIVE_INFINITY;
  private maximumFrameBytes = 0;

  private constructor(settings: FlacStreamSettings) {
    this.settings = settings;
  }

  /** A writer for a stream of these settings, refused where stream information cannot state them. */
  static create(settings: FlacStreamSettings): DomainResult<FlacStreamWriter> {
    const problem = settingsProblem(settings);
    return problem === undefined
      ? succeed(new FlacStreamWriter(settings))
      : fail(unwritableStream(problem));
  }

  /** Adds one frame, answering it as the body it is. */
  add(frame: Uint8Array): DomainResult<readonly Uint8Array[]> {
    if (this.ended) return fail(writerEnded());
    const header = readFlacFrameHeader(frame, this.settings);
    if (!header.ok) return this.failed(header);
    const { blockSize, fixedBlockSize, number } = header.value;
    if (!fixedBlockSize || number !== this.frames) {
      return this.failed(
        fail(
          invalidEncodedStream('FLAC frames must be of a fixed block size and numbered in order.'),
        ),
      );
    }
    if (this.shortFrameSeen || blockSize > this.settings.blockSize) {
      return this.failed(
        fail(
          invalidEncodedStream(
            "A FLAC frame is not of the stream's block size, and is not its last.",
          ),
        ),
      );
    }
    if (blockSize < this.settings.blockSize) this.shortFrameSeen = true;
    this.frames += 1;
    this.samples += blockSize;
    this.minimumFrameBytes = Math.min(this.minimumFrameBytes, frame.length);
    this.maximumFrameBytes = Math.max(this.maximumFrameBytes, frame.length);
    return succeed([frame]);
  }

  finish(end: FlacStreamEnd): DomainResult<FinishedEncodedStream> {
    if (this.ended) return fail(writerEnded());
    this.ended = true;
    if (end.samples.frames !== this.samples) {
      return fail(
        invalidEncodedStream(
          'The FLAC frames hold a count of samples other than the encoder was given.',
        ),
      );
    }
    const metadata = flacMetadataBlocks(this.settings, {
      ...this.settings,
      totalSamples: this.samples,
    });
    if (!metadata.ok) return metadata;
    const blocks = [this.streamInfo(end.samples.digest()), ...metadata.value.blocks];
    const head = new ByteWriter().latin1('fLaC');
    blocks.forEach((one, index) => head.bytes(encodeFlacBlock(one, index === blocks.length - 1)));
    return succeed({
      head: head.toBytes(),
      body: [],
      tail: new Uint8Array(),
      dropped: metadata.value.dropped,
    });
  }

  /** The stream information block, its fields packed as the format lays them. */
  private streamInfo(signature: Uint8Array): FlacBlock {
    const { sampleRate, channels, bitsPerSample, blockSize } = this.settings;
    // A field too narrow for what it would state says the value is unknown, as the format allows.
    const frameBytes = (bytes: number) => (bytes <= 0xffffff && Number.isFinite(bytes) ? bytes : 0);
    const total = this.samples < 2 ** 36 ? this.samples : 0;
    const body = new ByteWriter()
      .u16(blockSize)
      .u16(blockSize)
      .u24(frameBytes(this.frames === 0 ? 0 : this.minimumFrameBytes))
      .u24(frameBytes(this.maximumFrameBytes))
      .u32(
        sampleRate * 4_096 +
          (channels - 1) * 512 +
          (bitsPerSample - 1) * 16 +
          Math.floor(total / 2 ** 32),
      )
      .u32(total % 2 ** 32)
      .bytes(signature)
      .toBytes();
    return [FlacBlockType.StreamInfo, body];
  }

  private failed(result: DomainFailureResult): DomainFailureResult {
    this.ended = true;
    return result;
  }
}
