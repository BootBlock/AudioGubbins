/**
 * A source converted to another rate, explicitly.
 *
 * REQ-ARCH-085 keeps material at its native rate and makes every conversion
 * explicit and deterministic: this is the one place a source changes rate,
 * through the canonical resampler, and nothing converts implicitly.
 *
 * Output frame `k` is defined by the conversion of the whole source from its
 * first frame. A read anywhere but where the last one ended seeks the
 * converter to that frame, which resumes the source a filter length before
 * the frame's input position and writes the bits a conversion run from the
 * first frame writes, so a read two hours in costs what a read at the start
 * does. Playback that seeks converts a source that starts at the seek
 * position instead (`offsetSource`), which is the conversion of that audio.
 */

import {
  mapResult,
  sampleCount,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { throwIfCancelled, type CancellationSignal } from '../cancellation.js';
import type {
  CanonicalDsp,
  CanonicalResampler,
  ResamplerCoefficients,
  ResamplingQuality,
} from '../dsp/canonical-dsp.js';
import { allocateBlock, blockView, type AudioFrameBlock } from './frame-block.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';

/** Frames read from the source at a time. */
const INPUT_CHUNK = 4_096;

/** `ceil(length · to / from)`, exactly, for the converted length. */
function convertedLength(length: number, from: number, to: number): number {
  return Number((BigInt(length) * BigInt(to) + BigInt(from) - 1n) / BigInt(from));
}

/** A converted source, and how its resampler came by its taps, for a workload estimate. */
export interface ResampledSource extends PcmSource {
  readonly coefficients: ResamplerCoefficients;
}

/**
 * The source's audio at `to`, converted at `quality`, its resampler given
 * `coefficientBudgetBytes` for its filter's table where the caller measured
 * the memory it can spare (see `ResamplerSettings`).
 */
export function resampledSource(
  dsp: CanonicalDsp,
  source: PcmSource,
  to: SampleRate,
  quality: ResamplingQuality,
  coefficientBudgetBytes?: number,
): DomainResult<ResampledSource> {
  const length =
    source.length === undefined
      ? undefined
      : sampleCount(convertedLength(source.length, source.sampleRate, to));
  if (length !== undefined && !length.ok) return length;
  const made = dsp.createResampler({
    from: source.sampleRate,
    to,
    channels: source.layout.roles.length,
    quality,
    ...(coefficientBudgetBytes === undefined ? {} : { coefficientBudgetBytes }),
  });
  return mapResult(made, (resampler) =>
    new Conversion(source, to, resampler).asSource(length?.value),
  );
}

/** The running conversion behind a resampled source. */
class Conversion {
  readonly #source: PcmSource;
  readonly #to: SampleRate;
  readonly #resampler: CanonicalResampler;
  /** The source frame the next push starts at. */
  #read = 0;
  #written = 0;
  readonly #input: AudioFrameBlock;

  constructor(source: PcmSource, to: SampleRate, resampler: CanonicalResampler) {
    this.#source = source;
    this.#to = to;
    this.#resampler = resampler;
    this.#input = allocateBlock(source.layout, source.sampleRate, INPUT_CHUNK);
  }

  asSource(length: SampleCount | undefined): ResampledSource {
    return {
      coefficients: this.#resampler.coefficients,
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
    if (start !== this.#written) {
      this.#read = this.#resampler.seek(start);
      this.#written = start;
    }
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
}
