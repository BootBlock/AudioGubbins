import { describe, expect, it } from 'vitest';

import type { ChainSlot, EffectChain, ParallelGroup } from '@audiogubbins/domain';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { chainDifferences } from './chain-differences.js';
import { fixtureState, processor } from './testing/states.js';

function setup() {
  const { fixture, chain } = fixtureState(sampleProject());
  const group = (...branches: (readonly ChainSlot[])[]): ParallelGroup => ({
    kind: 'group',
    id: fixture.ids.next<'ProcessorGroupId'>(),
    enabled: true,
    soloed: false,
    mix: 1,
    summing: 'sum',
    branches: branches.map((slots) => ({ slots })),
  });
  const versions = (before: EffectChain, after: EffectChain) =>
    chainDifferences(new Map([[before.id, before]]), new Map([[after.id, after]]));
  return { fixture, chain, group, versions };
}

describe('the difference of two versions of a chain of slots (REQ-STOR-195)', () => {
  it('calls a processor moved into a group’s branch moved, with where it was and is', () => {
    const { fixture, chain, group, versions } = setup();
    const eq = processor(fixture, 'eq');
    const reverb = processor(fixture, 'reverb');
    const parallel = group([reverb], []);
    const before = { ...chain, slots: [eq, parallel] };
    const after = {
      ...chain,
      slots: [{ ...parallel, branches: [{ slots: [reverb] }, { slots: [eq] }] }],
    };
    const [difference] = versions(before, after);
    expect(difference?.slots).toEqual([
      expect.objectContaining({
        id: eq.id,
        change: 'changed',
        before: { index: 0 },
        after: { group: { id: parallel.id, branch: 1 }, index: 0 },
        moved: true,
      }),
    ]);
  });

  it('does not call the slots of a list moved because one was inserted before them in it', () => {
    const { fixture, chain, group, versions } = setup();
    const first = processor(fixture, 'eq');
    const second = processor(fixture, 'compressor');
    const parallel = group([first, second]);
    const inserted = processor(fixture, 'gate');
    const after = {
      ...chain,
      slots: [{ ...parallel, branches: [{ slots: [inserted, first, second] }] }],
    };
    const [difference] = versions({ ...chain, slots: [parallel] }, after);
    expect(difference?.slots.map((slot) => [slot.typeKey, slot.change, slot.moved])).toEqual([
      ['gate', 'added', false],
    ]);
  });

  it('names a changed mix, bypass, summing law and branch count of a group, and a processor’s version and state', () => {
    const { fixture, chain, group, versions } = setup();
    const denoiser = {
      ...processor(fixture, 'denoiser'),
      state: { kind: 'noise-profile', values: [1, 2] },
    };
    const parallel = group([denoiser]);
    const before = { ...chain, slots: [parallel] };
    const after = {
      ...chain,
      slots: [
        {
          ...parallel,
          enabled: false,
          mix: 0.5,
          summing: 'mean' as const,
          branches: [
            {
              slots: [
                {
                  ...denoiser,
                  version: { implementation: 1, parameters: 1, resampler: 1 },
                  state: { kind: 'noise-profile', values: [1, 3] },
                },
              ],
            },
            { slots: [] },
          ],
        },
      ],
    };
    expect(versions(before, after)[0]?.slots.map((slot) => [slot.kind, slot.fields])).toEqual([
      ['group', ['enabled', 'mix', 'summing', 'branches']],
      ['processor', ['version', 'state']],
    ]);
  });

  it('lists every slot inside a group that was removed, so none of its processors is lost from the record', () => {
    const { fixture, chain, group, versions } = setup();
    const inner = processor(fixture, 'eq');
    const parallel = group([inner]);
    const removed = versions({ ...chain, slots: [parallel] }, { ...chain, slots: [] });
    expect(removed[0]?.slots.map((slot) => [slot.kind, slot.change])).toEqual([
      ['group', 'removed'],
      ['processor', 'removed'],
    ]);
  });
});
