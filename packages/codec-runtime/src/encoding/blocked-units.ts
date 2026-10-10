/**
 * An encoder module's session as a unit encoder: whatever it answers for a
 * block, MP3 bytes or Vorbis packets, are the units its framer reads. The
 * frames it was given are counted, for the end of a stream whose framer
 * states its length.
 *
 * The encoder is handed its samples in blocks of the size its module states,
 * whatever blocks the render made, the last block alone shorter. libvorbis's
 * output depends on how its input is divided (it extrapolates the stream's
 * start from the first samples it holds, and chooses its block sizes from the
 * lookahead it has), and an export's bytes must depend on its samples and
 * settings alone, never on the size of the render's chunks (ADR-0091).
 */

import type { SamplePlane } from '@audiogubbins/codecs';
import { succeed, type DomainResult } from '@audiogubbins/domain';

import type { UnitEncoder } from './framed-file-writer.js';

/** An encoder module's open encoder: blocks of float planes in, its units out. */
export interface BlockEncoder {
  /** The most frames one block holds. */
  readonly blockFrames: number;

  /** Encodes the first `frames` frames of `planes`, one per channel, answering the units completed. */
  encode(planes: readonly Float32Array[], frames: number): DomainResult<readonly Uint8Array[]>;

  /** Ends the stream, answering the last units. */
  flush(): DomainResult<readonly Uint8Array[]>;

  /** Releases the encoder. A second call does nothing. */
  release(): void;
}

/** An encoder module's stream, its end made from the frames it was given. */
export class BlockedUnits<TEnd> implements UnitEncoder<TEnd> {
  readonly #encoder: BlockEncoder;
  readonly #endOf: (frames: number) => TEnd;
  readonly #held: readonly Float32Array[];
  #filled = 0;
  #frames = 0;

  constructor(encoder: BlockEncoder, channels: number, endOf: (frames: number) => TEnd) {
    this.#encoder = encoder;
    this.#endOf = endOf;
    this.#held = Array.from({ length: channels }, () => new Float32Array(encoder.blockFrames));
  }

  async encode(
    planes: readonly SamplePlane[],
    frames: number,
  ): Promise<DomainResult<readonly Uint8Array[]>> {
    await Promise.resolve();
    const units: Uint8Array[] = [];
    const block = this.#encoder.blockFrames;
    for (let offset = 0; offset < frames;) {
      const count = Math.min(block - this.#filled, frames - offset);
      this.#held.forEach((held, channel) => {
        const plane = planes[channel];
        if (plane !== undefined) held.set(plane.subarray(offset, offset + count), this.#filled);
      });
      this.#filled += count;
      offset += count;
      if (this.#filled === block) {
        const answered = this.#encodeHeld();
        if (!answered.ok) return answered;
        units.push(...answered.value);
      }
    }
    this.#frames += frames;
    return succeed(units);
  }

  async finish(): Promise<
    DomainResult<{ readonly units: readonly Uint8Array[]; readonly end: TEnd }>
  > {
    await Promise.resolve();
    const last = this.#encodeHeld();
    if (!last.ok) return last;
    const flushed = this.#encoder.flush();
    if (!flushed.ok) return flushed;
    return succeed({ units: [...last.value, ...flushed.value], end: this.#endOf(this.#frames) });
  }

  release(): void {
    this.#encoder.release();
  }

  /** The units of the frames held, which are then gone. */
  #encodeHeld(): DomainResult<readonly Uint8Array[]> {
    const filled = this.#filled;
    this.#filled = 0;
    if (filled === 0) return succeed([]);
    return this.#encoder.encode(
      this.#held.map((held) => held.subarray(0, filled)),
      filled,
    );
  }
}
