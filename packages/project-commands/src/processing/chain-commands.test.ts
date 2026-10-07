import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  assetPlan,
  instantiateProcessor,
  sampleCount,
  type EffectChain,
  type EditOperation,
} from '@audiogubbins/domain';
import {
  CUTOFF,
  expectFailureCode,
  expectSuccess,
  TEST_CATALOGUE,
  TEST_FILTER,
  TEST_LIMITER,
  TEST_UPMIXER,
  deepestChain,
} from '@audiogubbins/domain/testing';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { applyInvocation } from '../editing/edit-commands.js';
import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
} from '../testing/bus-runs.js';
import { referenceState } from '../testing/reference-state.js';
import { addChainInvocation, removeChainInvocation, setChainInvocation } from './chain-commands.js';
import { setEditChainInvocation, setRackInvocation } from './rack-commands.js';

const bus = projectBus();
const fixture = sampleProject();
const { state, assets } = referenceState(fixture);
const { footstep } = assets;
const ids = fixture.ids;

function chainOf(...slots: EffectChain['slots']): EffectChain {
  return { id: ids.next<'EffectChainId'>(), slots };
}

function filter() {
  return instantiateProcessor(ids.next<'ProcessorId'>(), TEST_FILTER);
}

/** Runs `invocation`, checks it applied, reads back, and is undone exactly by its inverses. */
function appliedAndUndone(from: ProjectState, invocation: CommandInvocation) {
  const result = bus.execute(from, invocation);
  const { next } = appliedOf(result);
  assertReadsBack(next);
  let undone = next;
  for (const inverse of entryOf(result).inverse)
    undone = appliedOf(bus.execute(undone, inverse)).next;
  expect(undone).toEqual(from);
  return { next, entry: entryOf(result) };
}

function after(from: ProjectState, ...invocations: readonly CommandInvocation[]): ProjectState {
  let next = from;
  for (const invocation of invocations) next = appliedOf(bus.execute(next, invocation)).next;
  return next;
}

function rackEdit(chain: EffectChain, start: number, end: number): EditOperation {
  return {
    id: ids.next<'EditOperationId'>(),
    kind: 'process',
    range: { start: expectSuccess(sampleCount(start)), end: expectSuccess(sampleCount(end)) },
    edit: { kind: 'rack', chain: chain.id },
  };
}

describe('the chain and rack commands (ADR-0060)', () => {
  it('adds a chain, undone by removing it, and refuses one whose processor shares an identifier', () => {
    const chain = chainOf(filter());
    const { next } = appliedAndUndone(state, addChainInvocation(chain));
    expect(next.project.effectChains.get(chain.id)).toEqual(chain);
    const copy = { ...chain, id: ids.next<'EffectChainId'>() };
    expect(refusalCodeOf(bus.execute(next, addChainInvocation(copy)))).toBe('chain.duplicate-slot');
  });

  it('carries a chain whose groups nest as deep as the domain allows through every argument, undo and redo', () => {
    const deep = deepestChain(ids);
    const added = appliedAndUndone(state, addChainInvocation(deep));
    expect(added.next.project.effectChains.get(deep.id)).toEqual(deep);

    // A change's inverse and a removal's carry the whole chain as it was, so
    // undoing either reads the deepest chain back from its argument's text.
    const [outer] = deep.slots;
    if (outer?.kind !== 'group') throw new Error('The deepest chain opens with a group.');
    const changed = appliedAndUndone(
      added.next,
      setChainInvocation({ ...deep, slots: [{ ...outer, mix: 0.5 }] }),
    );
    const removed = appliedAndUndone(added.next, removeChainInvocation(deep.id));
    expect(removed.next.project.effectChains.has(deep.id)).toBe(false);

    for (const [from, { next, entry }] of [
      [state, added],
      [added.next, changed],
      [added.next, removed],
    ] as const) {
      expect(after(from, ...entry.forward)).toEqual(next);
    }
  });

  it('names what a change to a chain did, in the processor’s own words', () => {
    const one = filter();
    const chain = chainOf(one);
    const added = after(state, addChainInvocation(chain));
    const louder = { ...one, values: new Map([...one.values, [CUTOFF, 2_000]]) };
    expect(
      appliedAndUndone(added, setChainInvocation({ ...chain, slots: [louder] })).entry.description,
    ).toBe('Change the cutoff frequency of “Low-pass filter”');
    expect(
      appliedAndUndone(added, setChainInvocation({ ...chain, slots: [{ ...one, enabled: false }] }))
        .entry.description,
    ).toBe('Bypass “Low-pass filter”');
    const limiter = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_LIMITER);
    expect(
      appliedAndUndone(added, setChainInvocation({ ...chain, slots: [one, limiter] })).entry
        .description,
    ).toBe('Add “Look-ahead limiter” to a rack');
  });

  it('changes a shared chain everywhere it is named in one step, which one undo restores', () => {
    const chain = chainOf(filter());
    const shared = after(
      state,
      addChainInvocation(chain),
      applyInvocation(footstep, rackEdit(chain, 0, 1_000)),
      setRackInvocation({ kind: 'asset', asset: footstep }, chain.id),
    );
    const changed = {
      ...chain,
      slots: [...chain.slots, instantiateProcessor(ids.next<'ProcessorId'>(), TEST_LIMITER)],
    };
    const { next } = appliedAndUndone(shared, setChainInvocation(changed));
    const asset = next.project.assets.get(footstep.id);
    if (asset === undefined) throw new Error('The footstep is in the project.');
    const plan = expectSuccess(
      assetPlan(asset, { chains: next.project.effectChains, catalogue: TEST_CATALOGUE }),
    );
    const ran = plan.streams.flatMap((stream) =>
      stream.processing?.kind === 'chain' ? [stream.processing.chain] : [],
    );
    expect(ran).toHaveLength(2);
    expect(ran.every((one) => one.slots.length === 2)).toBe(true);
  });

  it('refuses to remove a chain something names, and lets a range’s chain change its layout, the asset then unavailable with the reason', () => {
    const chain = chainOf(filter());
    const named = after(
      state,
      addChainInvocation(chain),
      applyInvocation(footstep, rackEdit(chain, 0, 1_000)),
    );
    expect(refusalCodeOf(bus.execute(named, removeChainInvocation(chain.id)))).toBe('chain.in-use');
    const upmixed = {
      ...chain,
      slots: [instantiateProcessor(ids.next<'ProcessorId'>(), TEST_UPMIXER)],
    };
    const upmixing = appliedAndUndone(named, setChainInvocation(upmixed)).next;
    const asset = upmixing.project.assets.get(footstep.id);
    if (asset === undefined) throw new Error('The asset is still in the project.');
    const context = { chains: upmixing.project.effectChains, catalogue: TEST_CATALOGUE };
    expect(expectFailureCode(assetPlan(asset, context))).toBe('editing.rack-changes-layout');
  });

  it('gives an asset a rack and takes it away, and points a range at a copy to make it independent', () => {
    const chain = chainOf(filter());
    const edit = rackEdit(chain, 0, 1_000);
    const named = after(state, addChainInvocation(chain), applyInvocation(footstep, edit));
    const target = { kind: 'asset', asset: footstep } as const;
    const { next: racked } = appliedAndUndone(named, setRackInvocation(target, chain.id));
    expect(racked.project.assets.get(footstep.id)?.rack).toBe(chain.id);
    appliedAndUndone(racked, setRackInvocation(target, undefined));
    const copy = chainOf(filter());
    const withCopy = after(named, addChainInvocation(copy));
    const { next } = appliedAndUndone(withCopy, setEditChainInvocation(target, edit.id, copy.id));
    const pointed = next.project.assets.get(footstep.id)?.edits.find((one) => one.id === edit.id);
    expect(
      pointed?.kind === 'process' && pointed.edit.kind === 'rack' ? pointed.edit.chain : undefined,
    ).toBe(copy.id);
  });
});
