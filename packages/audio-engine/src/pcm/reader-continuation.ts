/**
 * Which readers a reading of a plan keeps when it goes on into a plan that
 * continues it (ADR-0104), and letting go of the rest.
 *
 * A reader may go on only where nothing its state was made from reads
 * differently in the new plan (`plan-divergence.ts` says where each stream may
 * first differ): a stream's segments hold no state, so their reader takes the
 * new segments and goes on; a chain's run goes on where its input and its
 * automation are the same as far as the run has read it or measured it, and
 * takes the new plan's automation; a conversion, and a varispeed, go on where
 * what they read is the same as far as their resampler has read; a render, a
 * stretch and a spectral edit read around every frame they give, so they go on
 * only where nothing they read changes at all; and a file goes on where the new
 * plan's record of it names the same audio. A mix holds only the outputs it
 * sums, so every mix is made again. Whatever is let go is made again, from the
 * new plan, by the next read that needs it.
 */

import type { AssetId, EditPlan, EffectChain, PlanStream, SampleRate } from '@audiogubbins/domain';

import type { MixedContent } from './mixed-content.js';
import {
  ConvertedContent,
  StreamContent,
  type ContentReader,
  type FileContent,
  type MediaEntry,
  type ProcessedOutput,
} from './plan-content.js';
import { planDivergence, type PlanDivergence } from './plan-divergence.js';
import type { ProcessedContent } from './processed-content.js';

/** The readers a reading has made, by what they read, as the reading keeps them. */
export interface MadeReaders {
  readonly streams: Map<number, StreamContent>;
  readonly outputs: Map<number, StreamContent | ProcessedOutput>;
  /** The runs of the chains the reading runs itself, by the place of their stream. */
  readonly runs: Map<number, ProcessedContent>;
  /** Each conversion, by {@link conversionKey}. */
  readonly converted: Map<string, ConvertedContent>;
  readonly files: Map<AssetId, FileContent>;
  readonly mixes: Map<string, MixedContent>;
}

/** The key of a conversion of the stream at `place` to `rate`. */
export function conversionKey(place: number, rate: SampleRate): string {
  return `${String(place)}@${String(rate)}`;
}

/** The place of the stream a conversion's key names. */
function conversionPlace(key: string): number {
  return Number.parseInt(key, 10);
}

/** Whether two records of an asset name one file's audio, which reads alike. */
function sameEntry(before: MediaEntry | undefined, after: MediaEntry | undefined): boolean {
  return (
    after !== undefined &&
    before?.identity === after.identity &&
    before.sampleRate === after.sampleRate &&
    before.channels === after.channels &&
    before.length === after.length
  );
}

/** Whether a resampler that has read its source to `consumed` holds nothing a change at `differs` reaches. */
function readBefore(consumed: number | undefined, differs: number): boolean {
  return consumed === undefined || differs >= consumed;
}

/**
 * Whether the reader of what the stream at `place` makes may go on into the
 * new plan, and, where it is a chain's own run, takes the new plan's
 * automation of the chain.
 */
function keepsOutput(
  place: number,
  output: StreamContent | ProcessedOutput,
  run: ProcessedContent | undefined,
  divergence: PlanDivergence,
  after: PlanStream | undefined,
): boolean {
  const processing = after?.processing;
  if (!divergence.sameDefinition(place)) return false;
  if (processing === undefined) return true;
  const differs = divergence.input(place);
  if (processing.kind === 'varispeed' && output instanceof ConvertedContent) {
    return readBefore(output.consumedTo, differs);
  }
  if (processing.kind !== 'chain' || run !== output) return differs === Number.POSITIVE_INFINITY;
  const { reach } = run;
  if (reach !== undefined && differs < Math.max(reach.consumedTo, reach.measuredTo)) return false;
  return run.automate(processing.automation).ok;
}

/**
 * Lets go of each reader in `made` that cannot go on from the plan `before`
 * into `after`, read from the files `entries` names in each, gives the stream
 * contents kept their new segments, and answers the readers let go; `chains`
 * is the chain each processed stream runs now, as values changed while it
 * played have left it.
 */
export function continueReaders(
  made: MadeReaders,
  plans: { readonly before: EditPlan; readonly after: EditPlan },
  entries: {
    readonly before: ReadonlyMap<AssetId, MediaEntry>;
    readonly after: ReadonlyMap<AssetId, MediaEntry>;
  },
  chains: (place: number) => EffectChain | undefined,
): ReadonlySet<ContentReader> {
  const sameFile = (asset: AssetId): boolean =>
    sameEntry(entries.before.get(asset), entries.after.get(asset));
  const divergence = planDivergence(plans.before, plans.after, {
    chain: chains,
    run: (place) => made.runs.get(place)?.reach,
    conversion: (place, rate) => made.converted.get(conversionKey(place, rate))?.lookahead,
    varispeed: (place) => {
      const output = made.outputs.get(place);
      return output instanceof ConvertedContent ? output.lookahead : undefined;
    },
    sameFile,
  });
  const released = new Set<ContentReader>();
  const letGo = (reader: ContentReader): void => {
    reader.release();
    released.add(reader);
  };
  for (const [place, output] of made.outputs) {
    const run = made.runs.get(place);
    if (keepsOutput(place, output, run, divergence, plans.after.streams[place])) continue;
    if (!(output instanceof StreamContent)) letGo(output);
    made.outputs.delete(place);
    made.runs.delete(place);
  }
  for (const [key, converted] of made.converted) {
    const place = conversionPlace(key);
    if (
      divergence.sameDefinition(place) &&
      readBefore(converted.consumedTo, divergence.output(place))
    ) {
      continue;
    }
    letGo(converted);
    made.converted.delete(key);
  }
  for (const [asset, file] of made.files) {
    if (sameFile(asset)) continue;
    letGo(file);
    made.files.delete(asset);
  }
  for (const [place, content] of made.streams) {
    const stream = plans.after.streams[place];
    if (stream !== undefined && divergence.sameDefinition(place)) content.redefine(stream);
    else made.streams.delete(place);
  }
  made.mixes.clear();
  return released;
}
