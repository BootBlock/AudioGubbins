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
 *
 * The resampler's position is shared by every read, so reads take turns
 * (`read-turns.ts`), and a read that fails or is cancelled part way leaves
 * the position unknown, so the read after it seeks.
 *
 * The source's length is read at each read, not once: a stream of a plan
 * continued with a longer one (`reader-continuation.ts`) is still converted by
 * the resampler that was running, which is why the conversion says how far into
 * its source the state it holds reaches.
 *
 * The same converter plays a source faster or slower, as a game preview's
 * varispeed stream does (ADR-0104): run with whole steps, `denominator` output
 * frames for each `numerator` input frames, it changes pitch and speed together
 * and its output stays at the source's own rate, since no rate is converted.
 */

import {
  VARISPEED_DENOMINATOR,
  convertedFrameCount,
  mapResult,
  sampleCount,
  sampleRate,
  throwIfCancelled,
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import type {
  CanonicalDsp,
  CanonicalResampler,
  ResamplerCoefficients,
  ResamplingQuality,
} from '../dsp/canonical-dsp.js';
import { allocateBlock, blockView, type AudioFrameBlock } from './frame-block.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';
import { ReadTurns } from './read-turns.js';

/** Frames read from the source at a time. */
const INPUT_CHUNK = 4_096;

/** A converted source, and how its resampler came by its taps, for a workload estimate. */
export interface ResampledSource extends PcmSource {
  readonly coefficients: ResamplerCoefficients;
  /** Source frames the resampler needs past an output frame's position. */
  readonly lookahead: number;
  /**
   * The source frame the resampler's state has read up to, from where it last
   * sought: what a change to the source before it would leave stale. Infinite
   * once it has been told the source ended, since that end is part of its
   * state too; `undefined` where the next read seeks afresh, holding nothing.
   */
  readonly consumedTo: number | undefined;
}

/** Input frames for each `output` output frames, as whole numbers: a conversion's rates, or a varispeed's ratio. */
interface Steps {
  readonly input: number;
  readonly output: number;
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
  const steps = { input: source.sampleRate, output: to };
  const length = convertedLength(source, steps);
  if (length !== undefined && !length.ok) return length;
  const made = dsp.createResampler({
    from: source.sampleRate,
    to,
    channels: source.layout.roles.length,
    quality,
    ...(coefficientBudgetBytes === undefined ? {} : { coefficientBudgetBytes }),
  });
  return mapResult(made, (resampler) => new Conversion(source, steps, to, resampler));
}

/**
 * The factor a varispeed's steps are given to the resampler multiplied by. The
 * resampler is told two rates and designs its filter from their ratio reduced,
 * so any common factor makes the same bits; 8 is the least that lifts the
 * slowest step, 1,024, to a rate the resampler takes (8,192 Hz), and the
 * fastest, 16,384, stays within the most (131,072 Hz). No rate of the source is
 * declared: it stays at its own.
 */
const VARISPEED_STEP_SCALE = 8;

/**
 * The source played at `numerator / 4,096` of its speed, its pitch moved with
 * it, at `quality` (ADR-0104): `4,096` output frames for each `numerator` input
 * frames, the ratio reduced, so the filter has at most 4,096 phases, and the
 * frames it makes are `convertedFrameCount` of the source's by those steps.
 */
export function varispeedSource(
  dsp: CanonicalDsp,
  source: PcmSource,
  numerator: number,
  quality: ResamplingQuality,
): DomainResult<ResampledSource> {
  const steps = { input: numerator, output: VARISPEED_DENOMINATOR };
  const length = convertedLength(source, steps);
  if (length !== undefined && !length.ok) return length;
  const from = sampleRate(numerator * VARISPEED_STEP_SCALE);
  const to = sampleRate(VARISPEED_DENOMINATOR * VARISPEED_STEP_SCALE);
  if (!from.ok) return from;
  if (!to.ok) return to;
  const made = dsp.createResampler({
    from: from.value,
    to: to.value,
    channels: source.layout.roles.length,
    quality,
  });
  return mapResult(
    made,
    (resampler) => new Conversion(source, steps, source.sampleRate, resampler),
  );
}

/** The frames `source` holds by `steps`, or `undefined` for a source without an end. */
function convertedLength(source: PcmSource, steps: Steps): DomainResult<SampleCount> | undefined {
  return source.length === undefined
    ? undefined
    : sampleCount(convertedFrameCount(source.length, steps.input, steps.output));
}

/** The running conversion behind a resampled source. */
class Conversion implements ResampledSource {
  readonly coefficients: ResamplerCoefficients;
  readonly lookahead: number;
  readonly layout: ChannelLayout;
  readonly sampleRate: SampleRate;
  readonly #source: PcmSource;
  readonly #steps: Steps;
  readonly #resampler: CanonicalResampler;
  /** The source frame the next push starts at. */
  #read = 0;
  /** The output frame the next pull gives, or `NaN` where a read ended part way. */
  #written = 0;
  /** Whether the resampler has been told the source ended since it last sought. */
  #finished = false;
  readonly #input: AudioFrameBlock;
  readonly #turns = new ReadTurns();

  /** `source` by `steps`, made at `rate`, by `resampler`, which was made for those steps. */
  constructor(source: PcmSource, steps: Steps, rate: SampleRate, resampler: CanonicalResampler) {
    this.#source = source;
    this.#steps = steps;
    this.#resampler = resampler;
    this.coefficients = resampler.coefficients;
    this.lookahead = resampler.lookahead;
    this.layout = source.layout;
    this.sampleRate = rate;
    this.#input = allocateBlock(source.layout, source.sampleRate, INPUT_CHUNK);
  }

  /** The frames the source holds now, converted; the length was validated when it was converted. */
  get length(): SampleCount | undefined {
    const length = convertedLength(this.#source, this.#steps);
    if (length !== undefined && !length.ok) throw new Error(length.failures[0].summary);
    return length?.value;
  }

  get consumedTo(): number | undefined {
    if (Number.isNaN(this.#written)) return undefined;
    return this.#finished ? Number.POSITIVE_INFINITY : this.#read;
  }

  read(start: SampleCount, into: AudioFrameBlock, signal?: CancellationSignal): Promise<number> {
    return this.#turns.take(() => this.#convert(start, into, signal), signal);
  }

  release(): void {
    this.#resampler.release();
  }

  async #convert(
    start: number,
    into: AudioFrameBlock,
    signal: CancellationSignal | undefined,
  ): Promise<number> {
    assertReadableInto(this, into);
    if (start !== this.#written) {
      this.#read = this.#resampler.seek(start);
      this.#finished = false;
    }
    this.#written = Number.NaN;
    const wanted = framesAvailable(this.length, start, into.frames);
    let filled = 0;
    while (filled < wanted) {
      throwIfCancelled(signal);
      filled += this.#resampler.pull(blockView(into, filled, wanted - filled).channels);
      if (filled < wanted && !(await this.#pushNextChunk(signal))) break;
    }
    this.#written = start + filled;
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
    if (read < this.#input.frames) {
      this.#resampler.finish();
      this.#finished = true;
    }
    return read > 0 || !this.#resampler.drained;
  }

  #position(): SampleCount {
    const position = sampleCount(this.#read);
    if (!position.ok) throw new Error(position.failures[0].summary);
    return position.value;
  }
}
