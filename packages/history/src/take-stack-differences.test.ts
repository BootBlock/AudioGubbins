import { describe, expect, it } from 'vitest';

import {
  FadeShape,
  TakeState,
  derivedSampleCount,
  unsafeBrandId,
  type AssetId,
  type Take,
  type TakeStack,
} from '@audiogubbins/domain';
import {
  RecordingEnding,
  type AssetProvenance,
  type ProjectState,
  type RecordedProvenance,
} from '@audiogubbins/project-format';
import { punchedState } from '@audiogubbins/project-format/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { affectedBy } from './affected-entities.js';
import { differenceNames } from './difference-names.js';
import type { FieldOf } from './entity-fields.js';
import { diffStates, type StateDifference } from './state-diff.js';
import { NOTHING_AFFECTED } from './testing/histories.js';

/** The reference state with a punch stack of two takes, the second chosen, and that stack. */
function punched(): { readonly state: ProjectState; readonly stack: TakeStack } {
  const state = punchedState(sampleProject());
  const [stack] = state.project.takeStacks.values();
  if (stack === undefined) throw new Error('The punched state has a take stack.');
  return { state, stack };
}

function withStacks(state: ProjectState, ...stacks: readonly TakeStack[]): ProjectState {
  return {
    ...state,
    project: { ...state.project, takeStacks: new Map(stacks.map((stack) => [stack.id, stack])) },
  };
}

const NONE = { added: [], removed: [], changed: [] } as const;

/** A difference in take stacks alone. */
function onlyStacks(takeStacks: StateDifference['takeStacks']): StateDifference {
  return {
    project: [],
    assets: NONE,
    sources: NONE,
    tracks: NONE,
    buses: NONE,
    clips: NONE,
    regions: NONE,
    markers: NONE,
    effectChains: [],
    takeStacks,
  };
}

/** `stack` with the take at `index` changed by `change`. */
function retaken(stack: TakeStack, index: number, change: Partial<Take>): TakeStack {
  return {
    ...stack,
    takes: stack.takes.map((take, at) => (at === index ? { ...take, ...change } : take)),
  };
}

/** `stack`'s first take, which the punched state rejected. */
function firstTake(stack: TakeStack): Take {
  const [first] = stack.takes;
  if (first === undefined) throw new Error('The punch stack has two takes.');
  return first;
}

function punchOf(stack: TakeStack): NonNullable<TakeStack['punch']> {
  if (stack.punch === undefined) throw new Error('The punch stack has a punch.');
  return stack.punch;
}

describe('the difference of two states in their take stacks (REQ-STOR-195)', () => {
  it('lists a stack only the later state holds as added, and only the earlier as removed', () => {
    const { state, stack } = punched();
    const without = withStacks(state);
    expect(diffStates(without, state)).toEqual(
      onlyStacks({ added: [stack.id], removed: [], changed: [] }),
    );
    expect(diffStates(state, without)).toEqual(
      onlyStacks({ added: [], removed: [stack.id], changed: [] }),
    );
  });

  it('finds no difference between stacks that hold the same values in other objects', () => {
    const { state, stack } = punched();
    const punch = punchOf(stack);
    const rebuilt: TakeStack = {
      ...stack,
      takes: stack.takes.map((take) => ({ ...take })),
      punch: { ...punch, crossfade: { ...punch.crossfade } },
    };
    expect(diffStates(state, withStacks(state, rebuilt))).toEqual(onlyStacks(NONE));
  });

  const changes: readonly (readonly [
    string,
    (stack: TakeStack) => TakeStack,
    readonly FieldOf<TakeStack>[],
  ])[] = [
    ['renamed', (stack) => ({ ...stack, name: 'Footstep punch, second pass' }), ['name']],
    [
      'with another take chosen',
      (stack) => ({ ...stack, chosen: firstTake(stack).id }),
      ['chosen'],
    ],
    [
      'with no take chosen',
      ({ id, name, takes, punch }) => ({
        id,
        name,
        takes,
        ...(punch === undefined ? {} : { punch }),
      }),
      ['chosen'],
    ],
    [
      'with its chosen take rejected',
      (stack) => retaken(stack, 1, { state: TakeState.Rejected }),
      ['takes'],
    ],
    ['with a take removed', (stack) => retaken(stack, 0, { state: TakeState.Removed }), ['takes']],
    [
      'with a take re-noted',
      (stack) => retaken(stack, 0, { note: 'Late, and scuffed.' }),
      ['takes'],
    ],
    ['with a take renamed', (stack) => retaken(stack, 1, { name: 'Keeper' }), ['takes']],
    [
      'with a take placed by another latency',
      (stack) => retaken(stack, 1, { compensation: -128 }),
      ['takes'],
    ],
    [
      'with a take reading another asset',
      (stack) => retaken(stack, 1, { asset: firstTake(stack).asset }),
      ['takes'],
    ],
    [
      'with a take duplicated',
      (stack) => ({
        ...stack,
        takes: [
          ...stack.takes,
          {
            ...firstTake(stack),
            id: unsafeBrandId<'TakeId'>('00000000-0000-4000-8000-0000000000d1'),
          },
        ],
      }),
      ['takes'],
    ],
    [
      'with a longer pre-roll',
      (stack) => ({ ...stack, punch: { ...punchOf(stack), preRoll: derivedSampleCount(9_600) } }),
      ['punch'],
    ],
    [
      'with another crossfade shape',
      (stack) => {
        const punch = punchOf(stack);
        return {
          ...stack,
          punch: { ...punch, crossfade: { ...punch.crossfade, shape: FadeShape.Linear } },
        };
      },
      ['punch'],
    ],
    [
      'with another resampler',
      (stack) => ({ ...stack, punch: { ...punchOf(stack), resampler: 2 } }),
      ['punch'],
    ],
    [
      'with its punch taken away',
      ({ id, name, takes, chosen }) => ({
        id,
        name,
        takes,
        ...(chosen === undefined ? {} : { chosen }),
      }),
      ['punch'],
    ],
    [
      'renamed and with another take chosen',
      (stack) => ({ ...stack, name: 'Footstep', chosen: firstTake(stack).id }),
      ['name', 'chosen'],
    ],
  ];

  it.each(changes)('names a stack %s, and nothing else', (_, change, fields) => {
    const { state, stack } = punched();
    const after = withStacks(state, change(stack));
    expect(diffStates(state, after)).toEqual(
      onlyStacks({ added: [], removed: [], changed: [{ id: stack.id, fields }] }),
    );
  });

  it('counts a changed stack among the entities a change affected, and nothing else', () => {
    const { state, stack } = punched();
    const chosen = withStacks(state, { ...stack, chosen: firstTake(stack).id });
    expect(affectedBy(state, chosen)).toEqual({ ...NOTHING_AFFECTED, takeStacks: [stack.id] });
    expect(affectedBy(state, withStacks(state))).toEqual({
      ...NOTHING_AFFECTED,
      takeStacks: [stack.id],
    });
  });

  it('names a stack by its own name, from the state that holds it', () => {
    const { state, stack } = punched();
    const renamed = withStacks(state, { ...stack, name: 'Footstep, best' });
    const names = (before: ProjectState, after: ProjectState): ReadonlyMap<string, string> =>
      differenceNames(before, after, diffStates(before, after)).entities;
    expect(names(state, renamed).get(stack.id)).toBe('Footstep, best');
    expect(names(state, withStacks(state)).get(stack.id)).toBe('Footstep punch');
    expect(names(withStacks(state), state).get(stack.id)).toBe('Footstep punch');
  });
});

describe('the difference of two states in how an asset was recorded (ADR-0071)', () => {
  /** The punched state's first recorded asset, and its provenance's recording. */
  function recorded(): {
    readonly state: ProjectState;
    readonly asset: AssetId;
    readonly provenance: AssetProvenance;
    readonly recording: RecordedProvenance;
  } {
    const { state, stack } = punched();
    const asset = firstTake(stack).asset;
    const provenance = state.sources.get(asset)?.provenance;
    if (provenance?.recording === undefined) throw new Error('Every take is recorded.');
    return { state, asset, provenance, recording: provenance.recording };
  }

  function withProvenance(
    state: ProjectState,
    asset: AssetId,
    provenance: AssetProvenance,
  ): ProjectState {
    const source = state.sources.get(asset);
    if (source === undefined) throw new Error('Every asset has a source.');
    return { ...state, sources: new Map(state.sources).set(asset, { ...source, provenance }) };
  }

  const changes: readonly (readonly [
    string,
    (recording: RecordedProvenance) => RecordedProvenance,
  ])[] = [
    ['started at another moment', (recording) => ({ ...recording, recordedAt: 1 })],
    [
      'made on another device',
      (recording) => ({
        ...recording,
        device: { ...recording.device, label: 'Built-in Microphone' },
      }),
    ],
    [
      'made with another profile',
      (recording) => ({ ...recording, profile: { ...recording.profile, name: 'Voice' } }),
    ],
    [
      'asked of the browser otherwise',
      (recording) => ({ ...recording, requested: { ...recording.requested, latency: 0.01 } }),
    ],
    [
      'granted otherwise',
      (recording) => ({ ...recording, granted: { ...recording.granted, noiseSuppression: false } }),
    ],
    ['longer', (recording) => ({ ...recording, length: derivedSampleCount(recording.length + 1) })],
    ['ended otherwise', (recording) => ({ ...recording, ending: RecordingEnding.DeviceLost })],
  ];

  it.each(changes)('names the source of an asset %s, and nothing else', (_, change) => {
    const { state, asset, provenance, recording } = recorded();
    const after = withProvenance(state, asset, { ...provenance, recording: change(recording) });
    expect(diffStates(state, after)).toEqual({
      ...onlyStacks(NONE),
      sources: { added: [], removed: [], changed: [{ id: asset, fields: ['provenance'] }] },
    });
  });

  it('names the source of an asset whose recording was forgotten', () => {
    const { state, asset, provenance } = recorded();
    const { importedAt, byteLength, mediaType, originProjectId } = provenance;
    const after = withProvenance(state, asset, {
      importedAt,
      byteLength,
      mediaType,
      originProjectId,
    });
    expect(diffStates(state, after).sources.changed).toEqual([
      { id: asset, fields: ['provenance'] },
    ]);
  });

  it('finds no difference between recordings that hold the same values in other objects', () => {
    const { state, asset, provenance, recording } = recorded();
    const rebuilt: RecordedProvenance = {
      ...recording,
      device: { ...recording.device },
      profile: { ...recording.profile },
      requested: { ...recording.requested },
      granted: { ...recording.granted },
    };
    const after = withProvenance(state, asset, { ...provenance, recording: rebuilt });
    expect(diffStates(state, after).sources.changed).toEqual([]);
  });
});
