import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  SummingLaw,
  findSlot,
  instantiateProcessor,
  type EffectChain,
  type ParallelGroup,
} from '@audiogubbins/domain';
import { TEST_FILTER, TEST_LIMITER, deepestChain } from '@audiogubbins/domain/testing';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
  unchangedCodeOf,
} from '../testing/bus-runs.js';
import { referenceState } from '../testing/reference-state.js';
import { setRackInvocation } from './rack-commands.js';
import {
  addSlotInvocation,
  moveSlotInvocation,
  removeSlotInvocation,
  removeSlotsInvocations,
  setSlotControlInvocation,
} from './slot-commands.js';

const bus = projectBus();
const fixture = sampleProject();
const { state, assets } = referenceState(fixture);
const ids = fixture.ids;

const filter = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_FILTER);
const limiter = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_LIMITER);
const inner = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_FILTER);
const group: ParallelGroup = {
  kind: 'group',
  id: ids.next<'ProcessorGroupId'>(),
  enabled: true,
  soloed: false,
  mix: 1,
  summing: SummingLaw.Sum,
  branches: [{ slots: [inner] }, { slots: [] }],
};
const chain: EffectChain = { id: ids.next<'EffectChainId'>(), slots: [filter, group, limiter] };
const racked: ProjectState = appliedOf(
  bus.execute(state, setRackInvocation({ kind: 'asset', asset: assets.footstep }, chain)),
).next;

/** The chain as `of` holds it. */
function chainIn(of: ProjectState): EffectChain {
  const held = of.project.effectChains.get(chain.id);
  if (held === undefined) throw new Error('The chain is in the project.');
  return held;
}

/** Runs `invocation`, checks it applied, reads back and is undone exactly; its state and step's name. */
function appliedAndUndone(from: ProjectState, invocation: CommandInvocation) {
  const result = bus.execute(from, invocation);
  const { next } = appliedOf(result);
  assertReadsBack(next);
  let undone = next;
  for (const inverse of entryOf(result).inverse)
    undone = appliedOf(bus.execute(undone, inverse)).next;
  expect(undone).toEqual(from);
  return { next, description: entryOf(result).description };
}

describe('the slot commands (ADR-0060, REQ-AUDIO-017)', () => {
  it('adds a processor at a place in a group’s branch, named in the processor’s own words', () => {
    const added = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_LIMITER);
    const { next, description } = appliedAndUndone(
      racked,
      addSlotInvocation(chain.id, { group: { id: group.id, branch: 1 }, index: 0 }, added),
    );
    expect(findSlot(chainIn(next), added.id)?.place).toEqual({
      group: { id: group.id, branch: 1 },
      index: 0,
    });
    expect(description).toBe('Add “Look-ahead limiter” to a rack');
  });

  it('refuses a slot whose identifier the project holds, a place the chain lacks, and a group past the bounds', () => {
    expect(
      refusalCodeOf(bus.execute(racked, addSlotInvocation(chain.id, { index: 0 }, limiter))),
    ).toBe('chain.duplicate-slot');
    const fresh = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_FILTER);
    expect(
      refusalCodeOf(bus.execute(racked, addSlotInvocation(chain.id, { index: 9 }, fresh))),
    ).toBe('slot.place-unknown');
    // The deepest group the domain allows, which goes at the top of a chain
    // and nowhere inside a group.
    const [deepest] = deepestChain(ids).slots;
    if (deepest === undefined) throw new Error('The deepest chain holds a group.');
    expect(
      appliedOf(bus.execute(racked, addSlotInvocation(chain.id, { index: 0 }, deepest))).next,
    ).toBeDefined();
    expect(
      refusalCodeOf(
        bus.execute(
          racked,
          addSlotInvocation(chain.id, { group: { id: group.id, branch: 1 }, index: 0 }, deepest),
        ),
      ),
    ).toBe('effect-chain.malformed');
  });

  it('removes a group with all it holds, put back where it was by undo', () => {
    const { next, description } = appliedAndUndone(racked, removeSlotInvocation(group.id));
    expect(chainIn(next).slots).toEqual([filter, limiter]);
    expect(description).toBe('Remove a parallel group from a rack');
  });

  it('removes each named slot once, a slot inside a named group going with the group', () => {
    const invocations = removeSlotsInvocations(racked, [
      inner.id,
      group.id,
      limiter.id,
      limiter.id,
    ]);
    expect(invocations).toEqual([removeSlotInvocation(group.id), removeSlotInvocation(limiter.id)]);
    const [first, ...rest] = invocations;
    if (first === undefined) throw new Error('Something is removed.');
    const result = bus.executeGroup(racked, 'Remove', [first, ...rest]);
    expect(chainIn(appliedOf(result).next).slots).toEqual([filter]);
  });

  it('moves a slot into a branch and back, and says when it is there already', () => {
    const { next, description } = appliedAndUndone(
      racked,
      moveSlotInvocation(limiter.id, { group: { id: group.id, branch: 0 }, index: 1 }),
    );
    expect(chainIn(next).slots).toEqual([
      filter,
      { ...group, branches: [{ slots: [inner, limiter] }, { slots: [] }] },
    ]);
    expect(description).toBe('Move “Look-ahead limiter”');
    expect(unchangedCodeOf(bus.execute(racked, moveSlotInvocation(limiter.id, { index: 2 })))).toBe(
      'slot.unchanged',
    );
    expect(
      refusalCodeOf(
        bus.execute(
          racked,
          moveSlotInvocation(group.id, { group: { id: group.id, branch: 0 }, index: 0 }),
        ),
      ),
    ).toBe('slot.place-unknown');
  });

  it('bypasses, solos and mixes a processor or a group, and sets how a group adds its branches', () => {
    expect(
      appliedAndUndone(
        racked,
        setSlotControlInvocation(filter.id, { control: 'enabled', value: false }),
      ).description,
    ).toBe('Bypass “Low-pass filter”');
    expect(
      appliedAndUndone(
        racked,
        setSlotControlInvocation(group.id, { control: 'soloed', value: true }),
      ).description,
    ).toBe('Solo a parallel group');
    const mixed = appliedAndUndone(
      racked,
      setSlotControlInvocation(inner.id, { control: 'mix', value: 0.25 }),
    );
    expect(findSlot(chainIn(mixed.next), inner.id)?.slot.mix).toBe(0.25);
    const summed = appliedAndUndone(
      racked,
      setSlotControlInvocation(group.id, { control: 'summing', value: SummingLaw.EqualPower }),
    );
    expect(findSlot(chainIn(summed.next), group.id)?.slot).toMatchObject({
      summing: 'equal-power',
    });
  });

  it('refuses a mix outside 0 to 1, a law for a processor, and says when a control is set already', () => {
    expect(
      refusalCodeOf(
        bus.execute(racked, setSlotControlInvocation(filter.id, { control: 'mix', value: 1.5 })),
      ),
    ).toBe('effect-chain.malformed');
    expect(
      refusalCodeOf(
        bus.execute(
          racked,
          setSlotControlInvocation(filter.id, { control: 'summing', value: SummingLaw.Mean }),
        ),
      ),
    ).toBe('slot.not-group');
    expect(
      unchangedCodeOf(
        bus.execute(
          racked,
          setSlotControlInvocation(filter.id, { control: 'enabled', value: true }),
        ),
      ),
    ).toBe('slot.unchanged');
  });
});
