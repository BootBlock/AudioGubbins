/**
 * One side of a model's rate conversion: the stream's audio to the rate the
 * model hears, or the model's output back to the stream's rate, by the
 * canonical resampler (ADR-0062, REQ-ARCH-085), or straight through where the
 * two rates are one, since audio that needs no conversion is never filtered.
 *
 * Its output depends only on its input, never on the chunks it is fed in, so
 * how the pass is fed changes no bit of what the model hears or what the
 * kernel plays.
 */

import { mapResult, succeed, type DomainResult, type SampleRate } from '@audiogubbins/domain';
import type {
  CanonicalDsp,
  CanonicalResampler,
  ResamplingQuality,
} from '@audiogubbins/audio-engine';

/** Receives converted audio: the first `frames` frames of each array, valid until it returns. */
export type ConvertedAudio = (chunk: readonly Float32Array[], frames: number) => Promise<void>;

/** The frames pulled from the resampler at a time. */
const PULL_FRAMES = 4_096;

export class RateStage {
  readonly #resampler: CanonicalResampler | undefined;
  readonly #pulled: readonly Float32Array[];

  private constructor(resampler: CanonicalResampler | undefined, channels: number) {
    this.#resampler = resampler;
    this.#pulled =
      resampler === undefined
        ? []
        : Array.from({ length: channels }, () => new Float32Array(PULL_FRAMES));
  }

  /** A stage from `from` to `to`, or why the resampler cannot be made. */
  static between(
    dsp: CanonicalDsp,
    from: SampleRate,
    to: SampleRate,
    channels: number,
    quality: ResamplingQuality,
  ): DomainResult<RateStage> {
    if (from === to) return succeed(new RateStage(undefined, channels));
    return mapResult(
      dsp.createResampler({ from, to, channels, quality }),
      (resampler) => new RateStage(resampler, channels),
    );
  }

  /** Converts the first `frames` frames of `input`, handing on what is ready. */
  async push(input: readonly Float32Array[], frames: number, take: ConvertedAudio): Promise<void> {
    if (this.#resampler === undefined) {
      await take(input, frames);
      return;
    }
    this.#resampler.push(input.map((channel) => channel.subarray(0, frames)));
    await this.#drain(take);
  }

  /** Marks the end of the input and hands on the rest. */
  async finish(take: ConvertedAudio): Promise<void> {
    if (this.#resampler === undefined) return;
    this.#resampler.finish();
    await this.#drain(take);
  }

  release(): void {
    this.#resampler?.release();
  }

  async #drain(take: ConvertedAudio): Promise<void> {
    const resampler = this.#resampler;
    if (resampler === undefined) return;
    for (
      let ready = resampler.pull(this.#pulled);
      ready > 0;
      ready = resampler.pull(this.#pulled)
    ) {
      await take(this.#pulled, ready);
    }
  }
}
