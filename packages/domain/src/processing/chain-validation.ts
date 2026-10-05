/**
 * Whether a chain is whole, and what it makes of a layout.
 *
 * A chain arrives from a command, a project document, a person's library or
 * the clipboard, so it is checked here by one rule wherever it is read
 * (REQ-EXEC-136.12). Its shape is checked without the processors' descriptors,
 * since a document is read before anything runs it; what each processor
 * accepts and makes is checked against the catalogue of processor types this
 * build has, which refuses a type or a version it does not know with the
 * reason (REQ-AUDIO-145, REQ-STOR-052).
 */

import { layoutsMatch, type ChannelLayout } from '../audio/channel-layout.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import {
  appliedSlots,
  processorsOf,
  validateProcessorInstance,
  type ChainSlot,
  type EffectChain,
  type ProcessorInstance,
} from './effect-chain.js';
import type { ProcessorDescriptor } from './processor-descriptor.js';
import { MAXIMUM_STATE_VALUES } from './processor-version.js';

/** The processor types a build has, by type key. */
export type ProcessorCatalogue = ReadonlyMap<string, ProcessorDescriptor>;

/** The most slots a chain holds, counting those inside its groups. */
export const MAXIMUM_CHAIN_SLOTS = 256;

/** The deepest a group may sit inside other groups. */
export const MAXIMUM_GROUP_DEPTH = 8;

/** The most branches one group holds. */
export const MAXIMUM_GROUP_BRANCHES = 16;

function refused(summary: string, at: string): DomainResult<never> {
  return fail(
    failure('effect-chain.malformed', FailureKind.Rejected, summary, { details: { at } }),
  );
}

/** Why a list of slots does not hold, or `undefined`, counting its slots into `seen`. */
function slotsProblem(
  slots: readonly ChainSlot[],
  depth: number,
  seen: Set<string>,
  at: string,
): { readonly summary: string; readonly at: string } | undefined {
  for (const [index, slot] of slots.entries()) {
    const here = `${at}/${String(index)}`;
    if (seen.has(slot.id))
      return { summary: 'Two slots of the chain share an identifier.', at: here };
    seen.add(slot.id);
    if (seen.size > MAXIMUM_CHAIN_SLOTS) {
      return { summary: `A chain holds at most ${String(MAXIMUM_CHAIN_SLOTS)} slots.`, at: here };
    }
    if (!Number.isFinite(slot.mix) || slot.mix < 0 || slot.mix > 1) {
      return { summary: 'A slot’s mix lies outside 0 to 1.', at: here };
    }
    if (slot.kind === 'processor') {
      if (slot.state !== undefined && slot.state.values.length > MAXIMUM_STATE_VALUES) {
        return {
          summary: 'A processor’s state holds more values than any processor keeps.',
          at: here,
        };
      }
      if (slot.state?.values.some((value) => !Number.isFinite(value)) === true) {
        return {
          summary: 'A processor’s state holds a value that is not a finite number.',
          at: here,
        };
      }
      continue;
    }
    if (depth >= MAXIMUM_GROUP_DEPTH) {
      return { summary: `Groups nest at most ${String(MAXIMUM_GROUP_DEPTH)} deep.`, at: here };
    }
    if (slot.branches.length === 0 || slot.branches.length > MAXIMUM_GROUP_BRANCHES) {
      return {
        summary: `A group holds from 1 to ${String(MAXIMUM_GROUP_BRANCHES)} branches.`,
        at: here,
      };
    }
    for (const [place, branch] of slot.branches.entries()) {
      const problem = slotsProblem(
        branch.slots,
        depth + 1,
        seen,
        `${here}/branches/${String(place)}`,
      );
      if (problem !== undefined) return problem;
    }
  }
  return undefined;
}

/**
 * The chain where its shape holds: unique slot identifiers, mixes from 0 to 1,
 * groups with branches, nesting and size within their bounds, and state of
 * finite values within its bound.
 */
export function validateChainShape(chain: EffectChain): DomainResult<EffectChain> {
  const problem = slotsProblem(chain.slots, 0, new Set(), 'slots');
  return problem === undefined ? succeed(chain) : refused(problem.summary, problem.at);
}

/**
 * Every processor among `slots`, bypassed or not, checked against the
 * catalogue: a bypassed slot is still in the project, and is heard as soon as
 * it is switched on, so a type or version this build lacks is refused now.
 */
function checkInstances(
  slots: readonly ChainSlot[],
  catalogue: ProcessorCatalogue,
): DomainResult<void> {
  for (const processor of processorsOf(slots)) {
    const descriptor = catalogue.get(processor.typeKey);
    if (descriptor === undefined) return unknownType(processor);
    const valid = validateProcessorInstance(processor, descriptor);
    if (!valid.ok) return valid;
  }
  return succeed(undefined);
}

function unknownType(processor: ProcessorInstance): DomainResult<never> {
  return fail(
    failure(
      'effect-chain.unknown-processor-type',
      FailureKind.Unrecoverable,
      `This build has no processor of type "${processor.typeKey}".`,
      { details: { typeKey: processor.typeKey, processorId: processor.id } },
    ),
  );
}

/** The layout one slot passes on, applied or bypassed. */
function slotLayout(
  slot: ChainSlot,
  applied: boolean,
  catalogue: ProcessorCatalogue,
  input: ChannelLayout,
): DomainResult<ChannelLayout> {
  let output: DomainResult<ChannelLayout>;
  if (slot.kind === 'processor') {
    const descriptor = catalogue.get(slot.typeKey);
    if (descriptor === undefined) return unknownType(slot);
    const valid = validateProcessorInstance(slot, descriptor);
    if (!valid.ok) return valid;
    if (!applied) return succeed(input);
    output = descriptor.outputLayout(input, slot.values);
  } else {
    if (!applied) {
      const checked = checkInstances([slot], catalogue);
      return checked.ok ? succeed(input) : checked;
    }
    output = groupLayout(slot.branches, catalogue, input);
  }
  if (!output.ok) return output;
  if (slot.mix < 1 && !layoutsMatch(output.value, input)) {
    return fail(
      failure(
        'effect-chain.mix-across-layouts',
        FailureKind.Rejected,
        'A slot that changes the layout cannot mix its input back in: set its mix to 100 %.',
        { details: { slotId: slot.id } },
      ),
    );
  }
  return output;
}

/** The layout a group's branches agree on, or why they do not. */
function groupLayout(
  branches: readonly { readonly slots: readonly ChainSlot[] }[],
  catalogue: ProcessorCatalogue,
  input: ChannelLayout,
): DomainResult<ChannelLayout> {
  let agreed: ChannelLayout | undefined;
  for (const branch of branches) {
    const made = seriesLayout(branch.slots, catalogue, input);
    if (!made.ok) return made;
    if (agreed !== undefined && !layoutsMatch(agreed, made.value)) {
      return fail(
        failure(
          'effect-chain.branches-disagree',
          FailureKind.Rejected,
          'The branches of a group end in different layouts, so they cannot be added together.',
        ),
      );
    }
    agreed = made.value;
  }
  return succeed(agreed ?? input);
}

/** The layout a list of slots makes of `input`, checking every slot, applied or not. */
function seriesLayout(
  slots: readonly ChainSlot[],
  catalogue: ProcessorCatalogue,
  input: ChannelLayout,
): DomainResult<ChannelLayout> {
  const applied = new Set(appliedSlots(slots));
  let layout = input;
  for (const slot of slots) {
    const made = slotLayout(slot, applied.has(slot), catalogue, layout);
    if (!made.ok) return made;
    layout = made.value;
  }
  return succeed(layout);
}

/**
 * The layout the chain makes of `input`, checking every processor against the
 * catalogue, or the first reason it cannot run.
 */
export function chainOutputLayout(
  chain: Pick<EffectChain, 'slots'>,
  catalogue: ProcessorCatalogue,
  input: ChannelLayout,
): DomainResult<ChannelLayout> {
  return seriesLayout(chain.slots, catalogue, input);
}
