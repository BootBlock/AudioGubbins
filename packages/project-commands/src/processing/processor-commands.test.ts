import { describe, expect, it } from 'vitest';

import {
  SummingLaw,
  instantiateProcessor,
  unsafeBrandId,
  type EffectChain,
  type ParameterId,
  type ParameterValue,
} from '@audiogubbins/domain';
import { CUTOFF, GENTLE, TEST_FILTER, TEST_LIMITER } from '@audiogubbins/domain/testing';
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
import { setProcessorInvocation } from './processor-commands.js';
import { setRackInvocation } from './rack-commands.js';

const bus = projectBus();
const fixture = sampleProject();
const { state, assets } = referenceState(fixture);
const ids = fixture.ids;

const filter = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_FILTER);
const limiter = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_LIMITER);
const group = {
  kind: 'group',
  id: ids.next<'ProcessorGroupId'>(),
  enabled: true,
  soloed: false,
  mix: 1,
  summing: SummingLaw.Sum,
  branches: [{ slots: [filter] }],
} as const;
const chain: EffectChain = { id: ids.next<'EffectChainId'>(), slots: [group, limiter] };
const withChain: ProjectState = appliedOf(
  bus.execute(state, setRackInvocation({ kind: 'asset', asset: assets.footstep }, chain)),
).next;

describe('setting one processor (ADR-0060, REQ-AUDIO-086)', () => {
  it('sets a processor inside a group as one step, which one undo restores exactly', () => {
    const set = {
      ...filter,
      values: new Map<ParameterId, ParameterValue>([
        [CUTOFF, 3_000],
        [GENTLE, true],
      ]),
      state: { kind: 'noise-profile', values: [1, 2] },
    };

    const result = bus.execute(withChain, setProcessorInvocation(set));

    const { next } = appliedOf(result);
    assertReadsBack(next);
    const changed = next.project.effectChains.get(chain.id);
    expect(changed?.slots).toEqual([{ ...group, branches: [{ slots: [set] }] }, limiter]);
    const entry = entryOf(result);
    expect(entry.description).toBe('Change what “Low-pass filter” learned');
    let undone = next;
    for (const inverse of entry.inverse) undone = appliedOf(bus.execute(undone, inverse)).next;
    expect(undone).toEqual(withChain);
  });

  it('names a change of one value in the parameter’s own words', () => {
    const set = { ...filter, values: new Map([...filter.values, [CUTOFF, 4_000]]) };

    const entry = entryOf(bus.execute(withChain, setProcessorInvocation(set)));

    expect(entry.description).toBe('Change the cutoff frequency of “Low-pass filter”');
  });

  it('refuses another type, a group, a processor the project lacks, and finds no change in the same settings', () => {
    const retyped = { ...filter, typeKey: TEST_LIMITER.typeKey, values: limiter.values };
    const stranger = { ...filter, id: ids.next<'ProcessorId'>() };
    const asGroup = { ...filter, id: unsafeBrandId<'ProcessorId'>(group.id) };

    expect(refusalCodeOf(bus.execute(withChain, setProcessorInvocation(retyped)))).toBe(
      'processor.type-changed',
    );
    expect(refusalCodeOf(bus.execute(withChain, setProcessorInvocation(stranger)))).toBe(
      'processor.unknown',
    );
    expect(refusalCodeOf(bus.execute(withChain, setProcessorInvocation(asGroup)))).toBe(
      'processor.unknown',
    );
    expect(unchangedCodeOf(bus.execute(withChain, setProcessorInvocation(filter)))).toBe(
      'processor.unchanged',
    );
  });
});
