/**
 * The life of a chain of processors in a project (ADR-0060): it enters with
 * what first names it and leaves with what last names it, so no chain stays
 * in the project that nothing processes audio with.
 *
 * A command that names a chain names one something in the project names
 * already, by `chainId`, or gives the chain whole, as `chain`, which it adds
 * where the project lacks it. A command that stops naming a chain removes it
 * where nothing names it any more, and its inverse gives the chain whole so
 * undo puts it back. A chain nothing names, as an older document may hold, is
 * never named again: naming it by its identifier is refused, since undoing
 * that would remove it, and no undo may leave a state other than the one it
 * came from.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  chainUseCount,
  chainUsers,
  fail,
  failure,
  isWellFormedId,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type EditOperation,
  type EffectChain,
  type EffectChainId,
  type RegionOperation,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  readEffectChain,
  writeEffectChain,
  type ProjectState,
} from '@audiogubbins/project-format';

import { jsonArgument, optionalTextArgument, readNested } from '../invocation-arguments.js';
import { sharesIdentifiers } from './chain-checks.js';

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The state with its chains `chains`. */
function withChains(
  state: ProjectState,
  chains: ProjectState['project']['effectChains'],
): ProjectState {
  return { ...state, project: { ...state.project, effectChains: chains } };
}

/** The state with `chain` added, or put in place of the chain of its identifier. */
export function withChain(state: ProjectState, chain: EffectChain): ProjectState {
  return withChains(state, new Map([...state.project.effectChains, [chain.id, chain]]));
}

/** Whether anything in the project names the chain `id`. */
function isNamed(state: ProjectState, id: EffectChainId): boolean {
  return chainUseCount(chainUsers(state.project, id)) > 0;
}

/** The text of `chain` as the project document writes it. */
function writtenChain(chain: EffectChain): string {
  return canonicalJson(writeEffectChain(chain));
}

/** A chain a command names, and the state with it added where it is new. */
export interface ChainToName {
  readonly state: ProjectState;
  readonly chain: EffectChainId;
}

/**
 * The state with `chain` in it to be named: added where the project lacks a
 * chain of its identifier, or the project's own where it holds the very same
 * chain, which something names; or why it cannot be named.
 */
function withChainToName(state: ProjectState, chain: EffectChain): DomainResult<ChainToName> {
  const held = state.project.effectChains.get(chain.id);
  if (held === undefined) {
    return sharesIdentifiers(state, chain)
      ? rejected(
          'chain.duplicate-slot',
          'A processor of the chain has the identifier of one already in the project.',
        )
      : succeed({ state: withChain(state, chain), chain: chain.id });
  }
  if (writtenChain(held) !== writtenChain(chain)) {
    return rejected(
      'chain.duplicate-id',
      'The project already has another chain with that identifier.',
    );
  }
  return isNamed(state, chain.id) ? succeed({ state, chain: chain.id }) : unnamedRefusal();
}

function unnamedRefusal(): DomainResult<never> {
  return rejected(
    'chain.unnamed',
    'Nothing in the project processes audio with that chain any more, so it is not named again.',
  );
}

/**
 * The chain the invocation names, by `chainId` or whole as `chain` (see the
 * module comment), with the state it is named in; `undefined` where it names
 * none; or why what it names cannot be named.
 */
export function chainToName(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<ChainToName | undefined> {
  const text = optionalTextArgument(invocation, 'chainId');
  if (!text.ok) return text;
  const given = invocation.arguments?.['chain'];
  if (given !== undefined && given !== null) {
    if (text.value !== undefined) {
      return rejected('chain.named-twice', 'The command names a chain, or gives one, not both.');
    }
    const value = jsonArgument(invocation, 'chain');
    const chain = value.ok ? readNested(readEffectChain, value.value, 'chain') : value;
    return chain.ok ? withChainToName(state, chain.value) : chain;
  }
  if (text.value === undefined) return succeed(undefined);
  const id = unsafeBrandId<'EffectChainId'>(text.value);
  if (!isWellFormedId(text.value) || !state.project.effectChains.has(id)) {
    return rejected('rack.chain-unknown', 'The project has no chain with that identifier.');
  }
  return isNamed(state, id) ? succeed({ state, chain: id }) : unnamedRefusal();
}

/**
 * The state in which `named`, the chain a record or an operation a command
 * adds names, if any, is named: given whole as `chain` and added, or named
 * already by something; or why it cannot be.
 */
export function stateNaming(
  state: ProjectState,
  invocation: CommandInvocation,
  named: EffectChainId | undefined,
): DomainResult<ProjectState> {
  if (invocation.arguments?.['chainId'] !== undefined) {
    return rejected('chain.named-twice', 'The chain is named by what is added, not beside it.');
  }
  const found = chainToName(state, invocation);
  if (!found.ok) return found;
  if (found.value === undefined) {
    if (named === undefined || !state.project.effectChains.has(named)) return succeed(state);
    return isNamed(state, named) ? succeed(state) : unnamedRefusal();
  }
  return found.value.chain === named
    ? succeed(found.value.state)
    : rejected('chain.not-named', 'The chain given is not the one named by what is added.');
}

/** The chain an operation names, where it is a rack edit. */
export function rackChainOf(operation: EditOperation | RegionOperation): EffectChainId | undefined {
  return 'edit' in operation && operation.edit.kind === 'rack' ? operation.edit.chain : undefined;
}

/** A state once a command stopped naming a chain, and the chain where it went with that. */
export interface Unnamed {
  readonly state: ProjectState;
  readonly removed: EffectChain | undefined;
}

/** The state without the chain `id` where nothing names it any more, as the module comment says. */
export function withoutUnnamed(state: ProjectState, id: EffectChainId | undefined): Unnamed {
  const chain = id === undefined ? undefined : state.project.effectChains.get(id);
  if (chain === undefined || isNamed(state, chain.id)) return { state, removed: undefined };
  const chains = new Map(state.project.effectChains);
  chains.delete(chain.id);
  return { state: withChains(state, chains), removed: chain };
}

/**
 * The arguments that name `chain` again in an inverse: whole, where the
 * change removed it, or by its identifier; none where there is no chain.
 */
export function namingArguments(
  chain: EffectChainId | EffectChain | undefined,
): Readonly<Record<string, string>> {
  if (chain === undefined) return {};
  return typeof chain === 'string' ? { chainId: chain } : { chain: writtenChain(chain) };
}
