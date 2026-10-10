/**
 * A prebuilt encoder as a unit encoder: what it answers is one unit, the bytes
 * of its stream in whatever pieces it made them, which its framer reads
 * through. The frames it was given are counted, for the end of a stream whose
 * framer states its length.
 *
 * The encoder is handed its samples in blocks of {@link ENCODER_BLOCK_FRAMES}
 * whatever blocks the render made, the last block alone shorter. libvorbis's
 * output depends on how its input is divided (it extrapolates the stream's
 * start from the first samples it holds, and chooses its block sizes from the
 * lookahead it has), and an export's bytes must depend on its samples and
 * settings alone, never on the size of the render's chunks (ADR-0091).
 */

import type { SamplePlane } from '@audiogubbins/codecs';
import { succeed, type DomainResult } from '@audiogubbins/domain';

import type { UnitEncoder } from './framed-file-writer.js';
import type { PrebuiltEncoder } from './prebuilt-encoder.js';

/** The frames each call to a prebuilt encoder is given. */
const ENCODER_BLOCK_FRAMES = 4_096;

/** A prebuilt encoder's stream, its end made from the frames it was given. */
export class PrebuiltUnits<TEnd> implements UnitEncoder<TEnd> {
  readonly #encoder: PrebuiltEncoder;
  readonly #endOf: (frames: number) => TEnd;
  readonly #held: readonly Float32Array[];
  #filled = 0;
  #frames = 0;

  constructor(encoder: PrebuiltEncoder, channels: number, endOf: (frames: number) => TEnd) {
    this.#encoder = encoder;
    this.#endOf = endOf;
    this.#held = Array.from({ length: channels }, () => new Float32Array(ENCODER_BLOCK_FRAMES));
  }

  async encode(
    planes: readonly SamplePlane[],
    frames: number,
  ): Promise<DomainResult<readonly Uint8Array[]>> {
    await Promise.resolve();
    const units: Uint8Array[] = [];
    for (let offset = 0; offset < frames;) {
      const count = Math.min(ENCODER_BLOCK_FRAMES - this.#filled, frames - offset);
      this.#held.forEach((held, channel) => {
        const plane = planes[channel];
        if (plane !== undefined) held.set(plane.subarray(offset, offset + count), this.#filled);
      });
      this.#filled += count;
      offset += count;
      if (this.#filled === ENCODER_BLOCK_FRAMES) {
        const bytes = this.#encodeHeld();
        if (!bytes.ok) return bytes;
        if (bytes.value.length > 0) units.push(bytes.value);
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
    const units = [last.value, flushed.value].filter((bytes) => bytes.length > 0);
    return succeed({ units, end: this.#endOf(this.#frames) });
  }

  release(): void {
    this.#encoder.release();
  }

  /** The bytes of the frames held, which are then gone. */
  #encodeHeld(): DomainResult<Uint8Array> {
    const filled = this.#filled;
    this.#filled = 0;
    return this.#encoder.encode(
      this.#held.map((held) => held.subarray(0, filled)),
      filled,
    );
  }
}
