/**
 * A source converted to another rate, explicitly.
 *
 * REQ-ARCH-085 keeps material at its native rate and makes every conversion
 * explicit and deterministic: this is the one place a source changes rate,
 * through the canonical resampler, and nothing converts implicitly.
 *
 * Output frame `k` is defined by the conversion of the whole source from its
 * first frame, so a read anywhere but where the last one ended runs the
 * conversion again from the start and discards up to the frame asked for.
 * Playback that seeks converts a source that starts at the seek position
 * instead (`offsetSource`), which is the conversion of that audio.
 */

import {
  mapResult,
  sampleCount,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { throwIfCancelled, type CancellationSignal } from '../cancellation.js';
import type { CanonicalDsp, CanonicalResampler, ResamplingQuality } from '../dsp/canonical-dsp.js';
import { allocateBlock, blockView, type AudioFrameBlock } from './frame-block.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';

/** Frames read from the source at a time. */
const INPUT_CHUNK = 4_096;

/** `ceil(length · to / from)`, exactly, for the converted length. */
function convertedLength(length: number, from: number, to: number): number {
  return Number((BigInt(length) * BigInt(to) + BigInt(from) - 1n) / BigInt(from));
}

/** The source's audio at `to`, converted at `quality`. */
export function resampledSource(
  dsp: CanonicalDsp,
  source: PcmSource,
  to: SampleRate,
  quality: ResamplingQuality,
): DomainResult<PcmSource> {
  const length =
    source.length === undefined
      ? undefined
      : sampleCount(convertedLength(source.length, source.sampleRate, to));
  if (length !== undefined && !length.ok) return length;
  const make = (): DomainResult<CanonicalResampler> =>
    dsp.createResampler({
      from: source.sampleRate,
      to,
      channels: source.layout.roles.length,
      quality,
    });
  return mapResult(make(), (first) =>
    new Conversion(source, to, make, first).asSource(length?.value),
  );
}

/** The running conversion behind a resampled source. */
class Conversion {
  readonly #source: PcmSource;
  readonly #to: SampleRate;
  readonly #make: () => DomainResult<CanonicalResampler>;
  #resampler: CanonicalResampler;
  #read = 0;
  #written = 0;
  readonly #input: AudioFrameBlock;

  constructor(
    source: PcmSource,
    to: SampleRate,
    make: () => DomainResult<CanonicalResampler>,
    first: CanonicalResampler,
  ) {
    this.#source = source;
    this.#to = to;
    this.#make = make;
    this.#resampler = first;
    this.#input = allocateBlock(source.layout, source.sampleRate, INPUT_CHUNK);
  }

  asSource(length: SampleCount | undefined): PcmSource {
    return {
      layout: this.#source.layout,
      sampleRate: this.#to,
      length,
      read: (start, into, signal) => this.read(start, length, into, signal),
      release: () => {
        this.#resampler.release();
      },
    };
  }

  async read(
    start: number,
    length: SampleCount | undefined,
    into: AudioFrameBlock,
    signal: CancellationSignal | undefined,
  ): Promise<number> {
    assertReadableInto({ layout: this.#source.layout, sampleRate: this.#to }, into);
    if (start !== this.#written) await this.#restartAt(start, signal);
    const wanted = framesAvailable(length, start, into.frames);
    let filled = 0;
    while (filled < wanted) {
      throwIfCancelled(signal);
      filled += this.#resampler.pull(blockView(into, filled, wanted - filled).channels);
      if (filled < wanted && !(await this.#pushNextChunk(signal))) break;
    }
    this.#written += filled;
    return filled;
  }

  /** Pushes the next chunk of the source; answers false once it has ended. */
  async #pushNextChunk(signal: CancellationSignal | undefined): Promise<boolean> {
    if (this.#resampler.drained) return false;
    const read = await this.#source.read(
      // A source's positions are whole frames it has already vouched for.
      this.#position(),
      this.#input,
      signal,
    );
    if (read > 0) this.#resampler.push(blockView(this.#input, 0, read).channels);
    this.#read += read;
    if (read < this.#input.frames) this.#resampler.finish();
    return read > 0 || !this.#resampler.drained;
  }

  #position(): SampleCount {
    const position = sampleCount(this.#read);
    if (!position.ok) throw new Error(position.failures[0].summary);
    return position.value;
  }

  async #restartAt(start: number, signal: CancellationSignal | undefined): Promise<void> {
    this.#resampler.release();
    const again = this.#make();
    if (!again.ok) throw new Error(again.failures[0].summary);
    this.#resampler = again.value;
    this.#read = 0;
    this.#written = 0;
    const discard = allocateBlock(this.#source.layout, this.#to, INPUT_CHUNK);
    while (this.#written < start) {
      const frames = Math.min(INPUT_CHUNK, start - this.#written);
      const skipped = await this.read(
        this.#written,
        undefined,
        blockView(discard, 0, frames),
        signal,
      );
      if (skipped === 0) return;
    }
  }
}
