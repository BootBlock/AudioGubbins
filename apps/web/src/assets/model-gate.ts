/**
 * Whether the chains an entry's plan runs can run, for want of a model
 * (ADR-0062, REQ-AUDIO-139): a processor whose model pack is missing, damaged,
 * for another runtime or beyond this device cannot run, so the entry it would
 * process cannot be heard, and says why rather than play the sound without it.
 * The project stays valid: its instances keep their settings, and the entry
 * opens once the pack is present.
 *
 * Only what the chain applies is asked of: a processor or a group that is
 * bypassed, or not soloed where another is, runs nothing.
 */

import {
  appliedSlots,
  streamChain,
  type ChainSlot,
  type EditPlan,
  type EffectChain,
  type ProcessorInstance,
} from '@audiogubbins/domain';

/** Why `processor` cannot run, as a reader is told, or nothing where it can. */
export type ModelGate = (processor: ProcessorInstance) => string | undefined;

function slotsRefusal(slots: readonly ChainSlot[], gate: ModelGate): string | undefined {
  for (const slot of appliedSlots(slots)) {
    const refusal =
      slot.kind === 'processor'
        ? gate(slot)
        : slot.branches.reduce<string | undefined>(
            (found, branch) => found ?? slotsRefusal(branch.slots, gate),
            undefined,
          );
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

/** Why `chain` cannot run, the first processor's reason, or nothing where every one can. */
export function chainModelRefusal(chain: EffectChain, gate: ModelGate): string | undefined {
  return slotsRefusal(chain.slots, gate);
}

/**
 * Why a chain `plan` runs cannot run, a spectral edit's among them
 * (`streamChain`), the first processor's reason, or nothing where every one
 * can.
 */
export function planModelRefusal(plan: EditPlan, gate: ModelGate): string | undefined {
  for (const stream of plan.streams) {
    const run = streamChain(stream.processing);
    const refusal = run === undefined ? undefined : chainModelRefusal(run.chain, gate);
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}
