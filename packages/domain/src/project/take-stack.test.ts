import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { FadeShape } from '../editing/fades.js';
import { unsafeBrandId } from '../identity/branded-id.js';
import { assetOf, frames, operationId, range } from '../testing/editing-fixtures.js';
import { expectSuccess } from '../testing/unwrap.js';
import { sampleRate } from '../time/sample-time.js';
import { assetUsers, createProject, isAssetInUse } from './project.js';
import { TakeState, chosenTake, defaultPunchCrossfade, type TakeStack } from './take-stack.js';
import { punchStackOf, stackUsers } from './take-users.js';

const RECORDING = assetOf('recording', 500);
const TARGET = assetOf('target', 1_000);
const STACK = unsafeBrandId<'TakeStackId'>('0000cccc-stack');
const KEPT = unsafeBrandId<'TakeId'>('0000dddd-kept');
const REMOVED = unsafeBrandId<'TakeId'>('0000dddd-removed');

const STACK_VALUE: TakeStack = {
  id: STACK,
  name: 'Verse',
  takes: [
    {
      id: KEPT,
      asset: RECORDING.id,
      name: 'One',
      note: '',
      state: TakeState.Kept,
      compensation: 0,
    },
    {
      id: REMOVED,
      asset: RECORDING.id,
      name: 'Two',
      note: '',
      state: TakeState.Removed,
      compensation: 0,
    },
  ],
  chosen: KEPT,
};

const PUNCH = {
  id: operationId('punch'),
  kind: 'process',
  range: range(10, 20),
  edit: { kind: 'punch', stack: STACK },
} as const;

function projectWith(stacks: readonly TakeStack[]) {
  return {
    ...createProject(unsafeBrandId<'ProjectId'>('0000ffff-project'), 'Project', {
      sampleRate: TARGET.sampleRate,
      channelLayout: StandardLayouts.stereo,
    }),
    assets: new Map([
      [RECORDING.id, RECORDING],
      [TARGET.id, { ...TARGET, edits: [PUNCH] }],
    ]),
    takeStacks: new Map(stacks.map((stack) => [stack.id, stack])),
  };
}

describe('take stacks in a project', () => {
  it('start empty', () => {
    expect(projectWith([]).takeStacks.size).toBe(0);
    expect(
      createProject(unsafeBrandId<'ProjectId'>('0000ffff-project'), 'Project', {
        sampleRate: TARGET.sampleRate,
        channelLayout: StandardLayouts.stereo,
      }).takeStacks.size,
    ).toBe(0);
  });

  it('keep a recording in use while any take names it, removed takes among them', () => {
    expect(assetUsers(projectWith([STACK_VALUE]), RECORDING.id).takes).toBe(2);
    expect(isAssetInUse(projectWith([STACK_VALUE]), RECORDING.id)).toBe(true);
    expect(isAssetInUse(projectWith([]), RECORDING.id)).toBe(false);
  });

  it('are named by the punch edits that read them', () => {
    expect(punchStackOf(PUNCH)).toBe(STACK);
    expect(punchStackOf({ ...PUNCH, edit: { kind: 'silence' } })).toBeUndefined();
    expect(stackUsers(projectWith([STACK_VALUE]), STACK)).toEqual([
      { asset: TARGET.id, operation: PUNCH.id, range: PUNCH.range },
    ]);
    expect(stackUsers(projectWith([STACK_VALUE]), unsafeBrandId('0000cccc-other'))).toEqual([]);
  });

  it('give the take they choose, or none', () => {
    expect(chosenTake(STACK_VALUE)?.id).toBe(KEPT);
    const { chosen: _chosen, ...unchosen } = STACK_VALUE;
    expect(chosenTake(unchosen)).toBeUndefined();
  });
});

describe('the default crossfade of a punch', () => {
  it('is ten milliseconds of equal power, shortened to half a shorter range', () => {
    const rate = expectSuccess(sampleRate(44_100));
    expect(defaultPunchCrossfade(rate, 10_000)).toEqual({
      length: frames(441),
      shape: FadeShape.EqualPower,
    });
    expect(defaultPunchCrossfade(rate, 501).length).toBe(250);
  });
});
