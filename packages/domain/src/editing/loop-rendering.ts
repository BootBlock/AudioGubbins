/**
 * How a looping region's processing is rendered across its loop (ADR-0107):
 * the one answer the region's plan realises and the Inspector and the loop
 * analysis say, so what the person is told is what is heard.
 *
 * The processing upstream of a loop is its asset's rack and its region's
 * (ADR-0060's order). A loop chooses `wrapped` or `from-start`; a choice of
 * `wrapped` is rendered `from-start` where nothing upstream processes, since
 * the two then sound the same, and where a processor upstream measures its
 * whole input before it plays: the engine measures each processed stream over
 * that stream's own input (`ChainProcessing.prepare`), and a plan cannot hand
 * the ordinary run's measurement to the wrapped run, so the two would meet at
 * the loop's start with two answers.
 */

import { appliedProcessors, chainListening } from '../processing/chain-listening.js';
import type { ProcessorCatalogue } from '../processing/chain-validation.js';
import type { EffectChain } from '../processing/effect-chain.js';
import { EVERY_QUALITY_SETTINGS } from '../processing/quality-mode.js';
import type { Asset } from '../project/asset.js';
import { ProcessingAcrossLoop, type Region } from '../project/timeline.js';
import type { SampleRate } from '../time/sample-time.js';
import type { ProjectChains } from './operation-validation.js';

/** Why a loop renders its processing from the region's start. */
export type FromStartCause =
  /** The person chose it for the loop. */
  | { readonly kind: 'chosen' }
  /** Nothing upstream of the loop processes its audio, so both choices sound the same. */
  | { readonly kind: 'unprocessed' }
  /** The labels of the processors upstream that measure their whole input, each once. */
  | { readonly kind: 'whole-pass'; readonly processors: readonly string[] };

/** How a loop's processing is rendered across it. */
export type LoopRendering =
  /** Wrapped, by `racks`: the asset's rack, then the region's, each where it processes. */
  | { readonly kind: 'wrapped'; readonly racks: readonly EffectChain[] }
  | { readonly kind: 'from-start'; readonly cause: FromStartCause };

/** What the answer reads besides the asset and the region. */
export interface LoopRenderingContext {
  readonly chains: ProjectChains;
  readonly catalogue: ProcessorCatalogue;
}

/**
 * The racks upstream of `region`'s loop that process: its asset's, then its
 * own, each where the project has it and it applies a processor. A rack the
 * project lacks is passed over here; the region's plan refuses it.
 */
function processingRacks(
  asset: Asset,
  region: Region,
  chains: ProjectChains,
): readonly EffectChain[] {
  const racks: EffectChain[] = [];
  for (const id of [asset.rack, region.rack]) {
    const chain = id === undefined ? undefined : chains.get(id);
    if (chain !== undefined && !appliedProcessors(chain.slots).next().done) racks.push(chain);
  }
  return racks;
}

/**
 * How `region`'s loop renders the processing upstream of it, or `undefined`
 * where the region does not loop (ADR-0107).
 */
export function loopRendering(
  asset: Asset,
  region: Region,
  context: LoopRenderingContext,
): LoopRendering | undefined {
  const { loop } = region;
  if (loop === undefined) return undefined;
  const racks = processingRacks(asset, region, context.chains);
  if (racks.length === 0) return { kind: 'from-start', cause: { kind: 'unprocessed' } };
  if (loop.processingAcrossLoop === ProcessingAcrossLoop.FromStart) {
    return { kind: 'from-start', cause: { kind: 'chosen' } };
  }
  const measuring: string[] = [];
  for (const rack of racks) {
    for (const processor of appliedProcessors(rack.slots)) {
      const descriptor = context.catalogue.get(processor.typeKey);
      if (descriptor?.wholePass === true && !measuring.includes(descriptor.label)) {
        measuring.push(descriptor.label);
      }
    }
  }
  return measuring.length > 0
    ? { kind: 'from-start', cause: { kind: 'whole-pass', processors: measuring } }
    : { kind: 'wrapped', racks };
}

/**
 * How many whole cycles of a loop's body of `body` frames the wrapped run
 * warms up over (ADR-0107): the fewest that cover the lead-in `racks` declare
 * at `sampleRate`, added from one rack to the next, and at least one. A plan
 * names no quality, and a lead-in may follow one, so the lead-in covered is
 * the most any quality gives, and the plan holds at whatever quality renders
 * it. `least` frames are covered too: the splice into the loop's start reads
 * that many of the warm-up's last frames, which must be there to read.
 */
export function warmUpCycles(
  racks: readonly EffectChain[],
  catalogue: ProcessorCatalogue,
  sampleRate: SampleRate,
  body: number,
  least: number,
): number {
  let leadIn = 0;
  for (const quality of EVERY_QUALITY_SETTINGS) {
    let total = 0;
    for (const rack of racks) {
      total += chainListening(rack, catalogue, { sampleRate, quality }).partWay.leadIn;
    }
    leadIn = Math.max(leadIn, total);
  }
  return Math.max(1, Math.ceil(Math.max(leadIn, least) / body));
}
