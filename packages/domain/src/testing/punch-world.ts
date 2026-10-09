/**
 * The take stacks and recordings a random chain of punches makes, for the
 * property tests of the plan: each punch gets a stack of a few takes, each a
 * recording at one of the rates the test gives, long enough for the range it
 * is punched over, and the plan's context and the oracle's world both read
 * them from here.
 */

import {
  unsafeBrandId,
  type AssetId,
  type TakeId,
  type TakeStackId,
} from '../identity/branded-id.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import { TakeState, type Take, type TakeStack } from '../project/take-stack.js';
import { derivedSampleCount, type SampleRate } from '../time/sample-time.js';
import type { EditShape } from '../editing/edit-shape.js';
import { FadeShape } from '../editing/fades.js';
import type { PlanContext } from '../editing/plan-context.js';
import { punchTakeFrames } from '../editing/punch-validation.js';
import { validateTakeStack } from '../editing/take-stack-validation.js';
import type { OracleWorld, Samples } from './edit-oracle.js';
import { TEST_ENGINE } from './plan-context.js';
import { expectSuccess } from './unwrap.js';

const SHAPES: readonly FadeShape[] = Object.values(FadeShape);

/** One of `values`, chosen by `next`. */
export function pick<T>(next: () => number, values: readonly T[]): T {
  const value = values[Math.floor(next() * values.length)];
  if (value === undefined) throw new Error('Nothing to pick from.');
  return value;
}

/** `channels` channels of `length` frames of noise from `next`. */
export function noise(next: () => number, channels: number, length: number): Samples {
  return Array.from({ length: channels }, () =>
    Float32Array.from({ length }, () => Math.fround(next() * 2 - 1)),
  );
}

/** A conversion the tests state: each frame takes the source frame before it. */
const NEAREST_CONVERSION: NonNullable<OracleWorld['convert']> = (samples, from, to, length) =>
  samples.map((channel) =>
    Float32Array.from(
      { length },
      (_, frame) => channel[Math.min(channel.length - 1, Math.floor((frame * from) / to))] ?? 0,
    ),
  );

/** Everything a random chain of punches made: its assets, their samples and its stacks. */
export class PunchWorld {
  readonly assets = new Map<AssetId, Asset>();
  readonly sources = new Map<AssetId, Samples>();
  readonly stacks = new Map<TakeStackId, TakeStack>();
  readonly #next: () => number;
  readonly #rates: readonly SampleRate[];
  #made = 0;

  /** A world whose recordings are made at `rates`, by `next`. */
  constructor(next: () => number, rates: readonly SampleRate[]) {
    this.#next = next;
    this.#rates = rates;
  }

  #id(kind: string): string {
    this.#made += 1;
    return `${kind}-${this.#made.toString(16).padStart(6, '0')}`;
  }

  /** What a plan of an asset of this world is built with. */
  get context(): PlanContext {
    return {
      chains: new Map(),
      takeStacks: this.stacks,
      assets: this.assets,
      catalogue: new Map(),
      engine: TEST_ENGINE,
    };
  }

  /** What the oracle is told of this world, with `inserted` as what an insertion inserts. */
  oracle(inserted: Samples): OracleWorld {
    return {
      inserted,
      convert: NEAREST_CONVERSION,
      takes: {
        stacks: this.stacks,
        recordings: new Map(
          [...this.sources].map(([id, samples]) => [
            id,
            { samples, rate: this.assets.get(id)?.sampleRate ?? 0 },
          ]),
        ),
      },
    };
  }

  /** A recording long enough to be read for `length` frames of audio of `shape` from `from`. */
  #recording(shape: EditShape, from: number, length: number): AssetId {
    const next = this.#next;
    const rate = pick(next, this.#rates);
    const frames = from + punchTakeFrames(length, shape.sampleRate, rate) + Math.floor(next() * 8);
    const id = unsafeBrandId<'AssetId'>(`0000aaaa-${this.#id('take')}`);
    this.assets.set(id, {
      id,
      displayName: 'Take',
      origin: AssetOrigin.Recorded,
      sampleRate: rate,
      channelLayout: shape.layout,
      length: derivedSampleCount(frames),
      storageKey: `content:${id}`,
      edits: [],
    });
    this.sources.set(id, noise(next, shape.layout.roles.length, frames));
    return id;
  }

  /** A punch stack for a range of `length` frames of audio of `shape`, with a few takes. */
  stack(shape: EditShape, length: number): TakeStackId {
    const next = this.#next;
    const preRoll = Math.floor(next() * 12);
    const takes: Take[] = Array.from({ length: 1 + Math.floor(next() * 3) }, () => {
      const compensation = Math.floor(next() * (preRoll + 9)) - preRoll;
      return {
        id: unsafeBrandId<'TakeId'>(`0000bbbb-${this.#id('take')}`),
        asset: this.#recording(shape, preRoll + compensation, length),
        name: 'Take',
        note: '',
        state: next() < 0.2 ? TakeState.Rejected : TakeState.Kept,
        compensation,
      };
    });
    const kept = takes.filter((take) => take.state === TakeState.Kept);
    const chosen: TakeId | undefined = next() < 0.85 ? kept[0]?.id : undefined;
    const id = unsafeBrandId<'TakeStackId'>(`0000cccc-${this.#id('stack')}`);
    const stack: TakeStack = {
      id,
      name: 'Punch',
      takes,
      ...(chosen === undefined ? {} : { chosen }),
      punch: {
        length: derivedSampleCount(length),
        preRoll: derivedSampleCount(preRoll),
        postRoll: derivedSampleCount(Math.floor(next() * 5)),
        crossfade: {
          length: derivedSampleCount(Math.floor(next() * (Math.floor(length / 2) + 1))),
          shape: pick(next, SHAPES),
        },
        resampler: TEST_ENGINE.resampler,
      },
    };
    this.stacks.set(id, expectSuccess(validateTakeStack(stack, this.assets)));
    return id;
  }
}
