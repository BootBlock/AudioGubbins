import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  assetPlan,
  createDeterministicIdGenerator,
  instantiateProcessor,
  sampleCount,
  type EditOperation,
  type EffectChain,
  type RegionOperation,
} from '@audiogubbins/domain';
import {
  deepestChain,
  expectFailureCode,
  expectSuccess,
  TEST_CATALOGUE,
  TEST_ENGINE,
  TEST_FILTER,
  TEST_UPMIXER,
} from '@audiogubbins/domain/testing';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { ProjectCommandId } from '../project-command.js';
import { applyInvocation, withdrawInvocation } from '../editing/edit-commands.js';
import {
  addRegionWithProcessing,
  applyRegionEditInvocation,
  changeRegionInvocations,
  removeRegionInvocation,
  withdrawRegionEditInvocation,
} from '../editing/region-invocations.js';
import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
} from '../testing/bus-runs.js';
import { referenceState } from '../testing/reference-state.js';
import {
  extendedRackInvocation,
  independentChainInvocations,
  rackEachInvocations,
  setEditChainInvocation,
  setRackInvocation,
  type RackTarget,
} from './rack-commands.js';
import { addSlotInvocation } from './slot-commands.js';

const bus = projectBus();
const fixture = sampleProject();
const { state, assets } = referenceState(fixture);
const { footstep, rain } = assets;
const loop = fixture.regions.loop;
const ids = fixture.ids;

const FOOTSTEP: RackTarget = { kind: 'asset', asset: footstep };
const RAIN: RackTarget = { kind: 'asset', asset: rain };

function chainOf(...slots: EffectChain['slots']): EffectChain {
  return { id: ids.next<'EffectChainId'>(), slots };
}

function filter() {
  return instantiateProcessor(ids.next<'ProcessorId'>(), TEST_FILTER);
}

const at = (frames: number) => expectSuccess(sampleCount(frames));

function rackEdit(chain: EffectChain, start: number, end: number): EditOperation {
  return {
    id: ids.next<'EditOperationId'>(),
    kind: 'process',
    range: { start: at(start), end: at(end) },
    edit: { kind: 'rack', chain: chain.id },
  };
}

function regionRackEdit(chain: EffectChain, start: number, end: number): RegionOperation {
  return {
    id: ids.next<'EditOperationId'>(),
    basis: 0,
    range: { start: at(start), end: at(end) },
    edit: { kind: 'rack', chain: chain.id },
  };
}

/** Runs `invocation`, checks it applied, reads back, and is undone exactly by its inverses. */
function appliedAndUndone(from: ProjectState, invocation: CommandInvocation) {
  return groupAppliedAndUndone(from, [invocation]);
}

/** Runs the group, checks it applied, reads back, is undone exactly, and redone by its forwards. */
function groupAppliedAndUndone(
  from: ProjectState,
  invocations: readonly CommandInvocation[],
): { readonly next: ProjectState; readonly description: string } {
  const [first, ...rest] = invocations;
  if (first === undefined) throw new Error('A group holds an invocation.');
  const result = bus.executeGroup(from, 'Change', [first, ...rest]);
  const { next } = appliedOf(result);
  assertReadsBack(next);
  let undone = next;
  for (const inverse of entryOf(result).inverse) {
    undone = appliedOf(bus.execute(undone, inverse)).next;
    assertReadsBack(undone);
  }
  expect(undone).toEqual(from);
  expect(after(from, ...entryOf(result).forward)).toEqual(next);
  const one = bus.execute(from, first);
  return { next, description: one.kind === 'applied' ? (one.entry?.description ?? '') : '' };
}

function after(from: ProjectState, ...invocations: readonly CommandInvocation[]): ProjectState {
  let next = from;
  for (const invocation of invocations) next = appliedOf(bus.execute(next, invocation)).next;
  return next;
}

/** The target as `of` holds it now. */
function current(of: ProjectState, target: RackTarget): RackTarget {
  const asset = of.project.assets.get(target.asset.id);
  if (asset === undefined) throw new Error('The asset is in the project.');
  if (target.kind === 'asset') return { kind: 'asset', asset };
  const region = of.project.regions.get(target.region.id);
  if (region === undefined) throw new Error('The region is in the project.');
  return { kind: 'region', region, asset };
}

describe('a chain enters with what first names it and leaves with what last names it', () => {
  it('adds a rack’s chain given whole with the rack, and takes it away with the rack', () => {
    const chain = chainOf(filter());
    const racked = appliedAndUndone(state, setRackInvocation(FOOTSTEP, chain));
    expect(racked.next.project.effectChains.get(chain.id)).toEqual(chain);
    expect(racked.next.project.assets.get(footstep.id)?.rack).toBe(chain.id);
    expect(racked.description).toBe('Give “Gravel footstep” a rack');

    const taken = appliedAndUndone(
      racked.next,
      setRackInvocation(current(racked.next, FOOTSTEP), undefined),
    );
    expect(taken.next.project.effectChains.has(chain.id)).toBe(false);
    expect(taken.next.project.assets.get(footstep.id)?.rack).toBeUndefined();
  });

  it('keeps a shared chain where a target stops naming it, and removes it with the last', () => {
    const chain = chainOf(filter());
    const shared = after(
      state,
      setRackInvocation(FOOTSTEP, chain),
      setRackInvocation(RAIN, chain.id),
    );
    const one = appliedAndUndone(shared, setRackInvocation(current(shared, RAIN), undefined)).next;
    expect(one.project.effectChains.get(chain.id)).toEqual(chain);
    const none = appliedAndUndone(one, setRackInvocation(current(one, FOOTSTEP), undefined)).next;
    expect(none.project.effectChains.has(chain.id)).toBe(false);
  });

  it('removes the chain a replaced rack leaves nothing naming, the replacement given whole', () => {
    const before = chainOf(filter());
    const racked = after(state, setRackInvocation(FOOTSTEP, before));
    const replacement = chainOf(filter());
    const { next } = appliedAndUndone(
      racked,
      setRackInvocation(current(racked, FOOTSTEP), replacement),
    );
    expect([...next.project.effectChains.keys()]).toContain(replacement.id);
    expect(next.project.effectChains.has(before.id)).toBe(false);
  });

  it('removes a removed region’s rack chain nothing else names, which undo restores', () => {
    const region: RackTarget = { kind: 'region', region: loop, asset: footstep };
    const chain = chainOf(filter());
    const racked = after(state, setRackInvocation(region, chain));
    const { next } = appliedAndUndone(racked, removeRegionInvocation(loop));
    expect(next.project.regions.has(loop.id)).toBe(false);
    expect(next.project.effectChains.has(chain.id)).toBe(false);
  });

  it('removes a removed asset’s rack chain nothing else names, which undo restores', () => {
    const chain = chainOf(filter());
    const racked = after(state, setRackInvocation(RAIN, chain));
    const { next } = appliedAndUndone(racked, {
      commandId: ProjectCommandId.RemoveAsset,
      arguments: { assetId: rain.id },
    });
    expect(next.project.assets.has(rain.id)).toBe(false);
    expect(next.project.effectChains.has(chain.id)).toBe(false);
  });

  it('adds a range’s chain with its rack edit and removes it as the edit is withdrawn', () => {
    const chain = chainOf(filter());
    const edit = rackEdit(chain, 0, 1_000);
    const applied = appliedAndUndone(state, applyInvocation(footstep, edit, chain)).next;
    expect(applied.project.effectChains.get(chain.id)).toEqual(chain);
    const withdrawn = appliedAndUndone(applied, withdrawInvocation(footstep, edit)).next;
    expect(withdrawn.project.effectChains.has(chain.id)).toBe(false);

    const regionEdit = regionRackEdit(chain, 0, 1_000);
    const processed = appliedAndUndone(
      state,
      applyRegionEditInvocation(loop, regionEdit, chain),
    ).next;
    const unprocessed = appliedAndUndone(
      processed,
      withdrawRegionEditInvocation(loop, regionEdit),
    ).next;
    expect(unprocessed.project.effectChains.has(chain.id)).toBe(false);
  });

  it('refuses to name by its identifier a chain nothing names, or a chain given whole that differs', () => {
    const chain = chainOf(filter());
    const named = after(state, applyInvocation(footstep, rackEdit(chain, 0, 1_000), chain));
    const orphaned: ProjectState = {
      ...state,
      project: { ...state.project, effectChains: new Map([[chain.id, chain]]) },
    };
    expect(refusalCodeOf(bus.execute(orphaned, setRackInvocation(RAIN, chain.id)))).toBe(
      'chain.unnamed',
    );
    expect(
      refusalCodeOf(bus.execute(orphaned, applyInvocation(footstep, rackEdit(chain, 0, 10)))),
    ).toBe('chain.unnamed');
    expect(
      refusalCodeOf(bus.execute(named, setRackInvocation(RAIN, { ...chain, slots: [] }))),
    ).toBe('chain.duplicate-id');
    expect(
      appliedOf(bus.execute(named, setRackInvocation(RAIN, chain))).next.project.assets.get(rain.id)
        ?.rack,
    ).toBe(chain.id);
  });

  it('splits a region whose range rack edit is withdrawn and applied again in one change', () => {
    const chain = chainOf(filter());
    const edit = regionRackEdit(chain, 0, 1_000);
    const processed = after(state, applyRegionEditInvocation(loop, edit, chain));
    const old = processed.project.regions.get(loop.id);
    if (old === undefined) throw new Error('The region is in the project.');
    const clipped = { ...edit, range: { start: at(0), end: at(500) } };
    const second = {
      ...old,
      id: ids.next<'RegionId'>(),
      displayName: 'Second',
      operations: [edit],
    };
    const { next } = groupAppliedAndUndone(processed, [
      ...changeRegionInvocations(
        old,
        { ...old, operations: [clipped] },
        processed.project.effectChains,
      ),
      ...addRegionWithProcessing(second, processed.project.effectChains),
    ]);
    expect(next.project.effectChains.get(chain.id)).toEqual(chain);
    expect(next.project.regions.get(loop.id)?.operations).toEqual([clipped]);
  });
});

describe('the builders of rack changes', () => {
  it('makes a target’s every naming of a shared chain name a copy, the others keeping it', () => {
    const chain = chainOf(filter());
    const edit = rackEdit(chain, 0, 1_000);
    const shared = after(
      state,
      setRackInvocation(FOOTSTEP, chain),
      applyInvocation(footstep, edit),
      setRackInvocation(RAIN, chain.id),
    );
    const copy = chainOf(filter());
    const invocations = independentChainInvocations(current(shared, FOOTSTEP), chain.id, copy);
    expect(invocations).toHaveLength(2);
    const { next } = groupAppliedAndUndone(shared, invocations);
    const own = next.project.assets.get(footstep.id);
    expect(own?.rack).toBe(copy.id);
    const pointed = own?.edits.find((one) => one.id === edit.id);
    expect(pointed?.kind === 'process' && pointed.edit).toEqual({ kind: 'rack', chain: copy.id });
    expect(next.project.assets.get(rain.id)?.rack).toBe(chain.id);
    expect(next.project.effectChains.get(chain.id)).toEqual(chain);
  });

  it('gives targets a copy each or one shared, removing a rack replaced with the last to name it', () => {
    const saved = chainOf(filter());
    const old = chainOf(filter());
    const racked = after(state, setRackInvocation(FOOTSTEP, old), setRackInvocation(RAIN, old.id));
    const targets = [current(racked, FOOTSTEP), current(racked, RAIN)];
    const copies = groupAppliedAndUndone(
      racked,
      rackEachInvocations(targets, saved, false, createDeterministicIdGenerator(5)),
    ).next;
    const [one, other] = [footstep.id, rain.id].map((id) => copies.project.assets.get(id)?.rack);
    expect(one).not.toBe(other);
    expect(copies.project.effectChains.has(old.id)).toBe(false);
    const shared = groupAppliedAndUndone(
      racked,
      rackEachInvocations(targets, saved, true, createDeterministicIdGenerator(6)),
    ).next;
    expect(shared.project.assets.get(footstep.id)?.rack).toBe(
      shared.project.assets.get(rain.id)?.rack,
    );
    expect(shared.project.effectChains.has(old.id)).toBe(false);
    expect(shared.project.effectChains.size).toBe(state.project.effectChains.size + 1);
  });

  it('extends a target’s rack in a chain of its own, its old rack kept for another that shares it', () => {
    const old = chainOf(filter());
    const racked = after(state, setRackInvocation(FOOTSTEP, old), setRackInvocation(RAIN, old.id));
    const treatment = chainOf(filter());
    const { next } = appliedAndUndone(
      racked,
      extendedRackInvocation(racked.project, current(racked, FOOTSTEP), treatment, ids),
    );
    const own = next.project.effectChains.get(treatment.id);
    expect(own?.slots).toHaveLength(2);
    expect(own?.slots[1]).toEqual(treatment.slots[0]);
    expect(own?.slots[0]?.id).not.toBe(old.slots[0]?.id);
    expect(next.project.effectChains.get(old.id)).toEqual(old);
  });
});

describe('a chain through the rack commands', () => {
  it('carries a chain whose groups nest as deep as the domain allows through every argument, undo and redo', () => {
    const deep = deepestChain(ids);
    const racked = appliedAndUndone(state, setRackInvocation(FOOTSTEP, deep)).next;
    expect(racked.project.effectChains.get(deep.id)).toEqual(deep);
    // Taking the rack away removes the chain, so its inverse carries the
    // deepest chain whole and undoing it reads the chain back from its text.
    appliedAndUndone(racked, setRackInvocation(current(racked, FOOTSTEP), undefined));
  });

  it('changes a shared chain everywhere it is named in one step, which one undo restores', () => {
    const chain = chainOf(filter());
    const shared = after(
      state,
      setRackInvocation(FOOTSTEP, chain),
      applyInvocation(footstep, rackEdit(chain, 0, 1_000)),
    );
    const { next } = appliedAndUndone(shared, addSlotInvocation(chain.id, { index: 1 }, filter()));
    const asset = next.project.assets.get(footstep.id);
    if (asset === undefined) throw new Error('The footstep is in the project.');
    const plan = expectSuccess(
      assetPlan(asset, {
        chains: next.project.effectChains,
        catalogue: TEST_CATALOGUE,
        engine: TEST_ENGINE,
      }),
    );
    const ran = plan.streams.flatMap((stream) =>
      stream.processing?.kind === 'chain' ? [stream.processing.chain] : [],
    );
    expect(ran).toHaveLength(2);
    expect(ran.every((one) => one.slots.length === 2)).toBe(true);
  });

  it('lets a range’s chain change its layout, the asset then unavailable with the reason', () => {
    const chain = chainOf(filter());
    const named = after(state, applyInvocation(footstep, rackEdit(chain, 0, 1_000), chain));
    const upmixer = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_UPMIXER);
    const upmixing = appliedAndUndone(
      named,
      addSlotInvocation(chain.id, { index: 1 }, upmixer),
    ).next;
    const asset = upmixing.project.assets.get(footstep.id);
    if (asset === undefined) throw new Error('The asset is still in the project.');
    const context = {
      chains: upmixing.project.effectChains,
      catalogue: TEST_CATALOGUE,
      engine: TEST_ENGINE,
    };
    expect(expectFailureCode(assetPlan(asset, context))).toBe('editing.rack-changes-layout');
  });

  it('points a range at another chain given whole, removing the one it leaves nothing naming', () => {
    const chain = chainOf(filter());
    const edit = rackEdit(chain, 0, 1_000);
    const named = after(state, applyInvocation(footstep, edit, chain));
    const other = chainOf(filter());
    const { next } = appliedAndUndone(named, setEditChainInvocation(FOOTSTEP, edit.id, other));
    expect(next.project.effectChains.has(chain.id)).toBe(false);
    expect(next.project.effectChains.get(other.id)).toEqual(other);
  });
});
