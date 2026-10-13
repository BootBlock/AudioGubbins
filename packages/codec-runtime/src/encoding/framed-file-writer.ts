/**
 * An encoder of units and the framer of its format, composed into the
 * streaming write contract (ADR-0091, ADR-0092): planar blocks in, the body
 * bytes the framer completes out, and at the end the framer's head, its last
 * body bytes and its tail.
 *
 * The blocks arrive in the rendered layout's order and are handed to the
 * encoder in the file's (`writtenChannelOrder`), by reference. The framer is
 * opened when the first unit arrives, since AAC's states what only the
 * encoder's first output says. The framer's last body bytes follow every body
 * byte answered before them, so they lead the tail. A call that fails ends
 * the writer and releases its encoder, as finishing does.
 */

import {
  fail,
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type {
  AudioFileWriter,
  EncodedStreamWriter,
  FinishedAudioFile,
  SamplePlane,
  WrittenChannelOrder,
} from '@audiogubbins/codecs';

import { blockRefused, writerEnded } from './encoding-failures.js';

/** An encoder of one stream's units, its blocks in the file's channel order. */
export interface UnitEncoder<TEnd> {
  /** Encodes `frames` frames of `planes`, answering the units they completed, possibly none. */
  encode(
    planes: readonly SamplePlane[],
    frames: number,
  ): Promise<DomainResult<readonly Uint8Array[]>>;

  /** Ends the stream: the units that remained, and what the framer needs at the end. */
  finish(): Promise<DomainResult<{ readonly units: readonly Uint8Array[]; readonly end: TEnd }>>;

  /** Releases what the encoder holds. A second call does nothing. */
  release(): void;
}

/** Why a block cannot be written, or `undefined` where it can. */
export function blockProblem(
  channels: readonly SamplePlane[],
  frames: number,
  channelCount: number,
): string | undefined {
  if (!Number.isSafeInteger(frames) || frames < 0) {
    return 'A block written holds a whole number of frames, none or more.';
  }
  if (channels.length !== channelCount) {
    return `A block written holds ${String(channelCount)} channels, one array for each.`;
  }
  return channels.some((channel) => channel.length < frames)
    ? 'Each array of a block written must hold its frames.'
    : undefined;
}

/** Joins byte arrays in order. */
function joined(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** An encoder's units framed into one file, by the framer `openFramer` opens. */
export class FramedFileWriter<TEnd> implements AudioFileWriter {
  readonly #encoder: UnitEncoder<TEnd>;
  readonly #openFramer: () => DomainResult<EncodedStreamWriter<TEnd>>;
  readonly #order: WrittenChannelOrder;
  #framer: EncodedStreamWriter<TEnd> | undefined;
  #open = true;

  constructor(
    encoder: UnitEncoder<TEnd>,
    openFramer: () => DomainResult<EncodedStreamWriter<TEnd>>,
    order: WrittenChannelOrder,
  ) {
    this.#encoder = encoder;
    this.#openFramer = openFramer;
    this.#order = order;
  }

  async write(
    channels: readonly SamplePlane[],
    frames: number,
    signal?: CancellationSignal,
  ): Promise<DomainResult<readonly Uint8Array[]>> {
    await Promise.resolve();
    this.#stopIfCancelled(signal);
    if (!this.#open) return fail(writerEnded());
    const problem = blockProblem(channels, frames, this.#order.length);
    if (problem !== undefined) return this.#ended([blockRefused(problem)]);
    const planes = this.#order.map((index) => channels[index] ?? new Float32Array(frames));
    const units = await this.#encoder.encode(planes, frames);
    this.#stopIfCancelled(signal);
    if (!units.ok) return this.#ended(units.failures);
    const body = this.#framed(units.value);
    return body.ok ? body : this.#ended(body.failures);
  }

  async finish(signal?: CancellationSignal): Promise<DomainResult<FinishedAudioFile>> {
    await Promise.resolve();
    this.#stopIfCancelled(signal);
    if (!this.#open) return fail(writerEnded());
    const last = await this.#encoder.finish();
    this.#stopIfCancelled(signal);
    if (!last.ok) return this.#ended(last.failures);
    const body = this.#framed(last.value.units);
    if (!body.ok) return this.#ended(body.failures);
    const framer = this.#currentFramer();
    if (!framer.ok) return this.#ended(framer.failures);
    const finished = framer.value.finish(last.value.end);
    this.#open = false;
    this.#encoder.release();
    if (!finished.ok) return finished;
    return succeed({
      head: finished.value.head,
      tail: joined([...body.value, ...finished.value.body, finished.value.tail]),
      dropped: finished.value.dropped,
    });
  }

  /** Ends the writer with `failures`, releasing the encoder. */
  #ended(failures: readonly [DomainFailure, ...DomainFailure[]]): DomainResult<never> {
    this.#open = false;
    this.#encoder.release();
    return fail(...failures);
  }

  /** Stops, releasing the encoder, where the signal is cancelled; a cancelled writer takes no more. */
  #stopIfCancelled(signal: CancellationSignal | undefined): void {
    if (signal?.aborted === true && this.#open) {
      this.#open = false;
      this.#encoder.release();
    }
    throwIfCancelled(signal);
  }

  /** The framer, opened the first time it is asked for. */
  #currentFramer(): DomainResult<EncodedStreamWriter<TEnd>> {
    if (this.#framer !== undefined) return succeed(this.#framer);
    const opened = this.#openFramer();
    if (opened.ok) this.#framer = opened.value;
    return opened;
  }

  /** The body bytes `units` complete. */
  #framed(units: readonly Uint8Array[]): DomainResult<readonly Uint8Array[]> {
    const body: Uint8Array[] = [];
    for (const unit of units) {
      const framer = this.#currentFramer();
      if (!framer.ok) return framer;
      const added = framer.value.add(unit);
      if (!added.ok) return added;
      body.push(...added.value);
    }
    return succeed(body);
  }
}
