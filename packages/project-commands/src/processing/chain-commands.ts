/**
 * The commands that change a project's chains of processors (ADR-0060).
 *
 * A chain is added, changed and removed whole, each with its inverse, so one
 * undo restores it exactly, and a change to a chain several operations and
 * targets name reaches all of them in that one step, which is what sharing a
 * chain means (REQ-EDIT-014). Every change is checked where the chain is
 * heard (`chain-checks.ts`), and a chain anything still names cannot be
 * removed, as an asset cannot.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  FailureKind,
  chainUseCount,
  chainUsers,
  fail,
  failure,
  isWellFormedId,
  succeed,
  type DomainResult,
  unsafeBrandId,
  type EffectChain,
  type EffectChainId,
  type ProcessorCatalogue,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  readEffectChain,
  writeEffectChain,
  type ProjectState,
} from '@audiogubbins/project-format';

import { jsonArgument, readNested, refusedBy, textArgument } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  type ProjectCommand,
} from '../project-command.js';
import { sharesIdentifiers } from './chain-checks.js';
import { chainChangeDescription } from './chain-descriptions.js';

function withChains(
  state: ProjectState,
  chains: ProjectState['project']['effectChains'],
): ProjectState {
  return { ...state, project: { ...state.project, effectChains: chains } };
}

/** The chain the argument `chain` holds, read by the project format's reader. */
function chainArgument(invocation: CommandInvocation) {
  const value = jsonArgument(invocation, 'chain');
  return value.ok ? readNested(readEffectChain, value.value, 'chain') : value;
}

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The chain the argument `chainId` names in the project. */
function namedChain(state: ProjectState, invocation: CommandInvocation): DomainResult<EffectChain> {
  const text = textArgument(invocation, 'chainId');
  if (!text.ok) return text;
  if (!isWellFormedId(text.value)) {
    return rejected('chain.id-malformed', 'The chain identifier is not one AudioGubbins makes.');
  }
  const chain = state.project.effectChains.get(unsafeBrandId<'EffectChainId'>(text.value));
  return chain === undefined
    ? rejected('chain.unknown', 'The project has no chain with that identifier.')
    : succeed(chain);
}

/** The invocation that adds `chain`. */
export function addChainInvocation(chain: EffectChain): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddChain,
    arguments: { chain: canonicalJson(writeEffectChain(chain)) },
  };
}

/** The invocation that changes the chain of `chain`'s identifier to `chain`. */
export function setChainInvocation(chain: EffectChain): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetChain,
    arguments: { chain: canonicalJson(writeEffectChain(chain)) },
  };
}

/** The invocation that removes the chain `id`. */
export function removeChainInvocation(id: EffectChainId): CommandInvocation {
  return { commandId: ProjectCommandId.RemoveChain, arguments: { chainId: id } };
}

function addChain(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const named = namedChain(state, invocation);
  if (!named.ok) return refusedBy(named);
  const chain = named.value;
  if (chainUseCount(chainUsers(state.project, chain.id)) > 0) {
    return refusal(
      'chain.in-use',
      'Something in the project still processes audio with this chain, so it cannot be removed.',
    );
  }
  const chains = new Map(state.project.effectChains);
  chains.delete(chain.id);
  return applied(
    withChains(state, chains),
    addChainInvocation(chain),
    'Remove a chain of processors',
  );
}

function setChain(
  state: ProjectState,
  invocation: CommandInvocation,
  catalogue: ProcessorCatalogue,
): CommandOutcome<ProjectState> {
  const chain = chainArgument(invocation);
  if (!chain.ok) return refusedBy(chain);
  const before = state.project.effectChains.get(chain.value.id);
  if (before === undefined)
    return refusal('chain.unknown', 'The project has no chain with that identifier.');
  if (canonicalJson(writeEffectChain(before)) === canonicalJson(writeEffectChain(chain.value))) {
    return unchanged('chain.unchanged', 'The chain is already as asked.');
  }
  if (sharesIdentifiers(state, chain.value)) {
    return refusal(
      'chain.duplicate-slot',
      'A processor of the chain has the identifier of one already in the project.',
    );
  }
  const next = withChains(
    state,
    new Map([...state.project.effectChains, [chain.value.id, chain.value]]),
  );
  return applied(
    next,
    setChainInvocation(before),
    chainChangeDescription(before, chain.value, catalogue),
  );
}

function removeChain(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const chain = chainArgument(invocation);
  if (!chain.ok) return refusedBy(chain);
  if (state.project.effectChains.has(chain.value.id)) {
    return refusal('chain.duplicate-id', 'The project already has a chain with that identifier.');
  }
  if (sharesIdentifiers(state, chain.value)) {
    return refusal(
      'chain.duplicate-slot',
      'A processor of the chain has the identifier of one already in the project.',
    );
  }
  const next = withChains(
    state,
    new Map([...state.project.effectChains, [chain.value.id, chain.value]]),
  );
  return applied(next, removeChainInvocation(chain.value.id), 'Add a chain of processors');
}

/** The commands that add, change and remove chains, checked against `catalogue`. */
export function chainCommands(catalogue: ProcessorCatalogue): readonly ProjectCommand[] {
  return [
    projectCommand({
      id: ProjectCommandId.AddChain,
      label: 'Add a chain of processors',
      category: CommandCategory.Edit,
      description: 'Adds a chain of processors to the project, for a rack or a range to name.',
      provenance: NO_PROVENANCE,
      run: (state, invocation) => removeChain(state, invocation),
    }),
    projectCommand({
      id: ProjectCommandId.SetChain,
      label: 'Change a chain of processors',
      category: CommandCategory.Edit,
      description: 'Changes a chain of processors, wherever the project names it.',
      provenance: NO_PROVENANCE,
      run: (state, invocation) => setChain(state, invocation, catalogue),
    }),
    projectCommand({
      id: ProjectCommandId.RemoveChain,
      label: 'Remove a chain of processors',
      category: CommandCategory.Edit,
      description: 'Removes a chain of processors nothing in the project names.',
      provenance: NO_PROVENANCE,
      run: (state, invocation) => addChain(state, invocation),
    }),
  ];
}
