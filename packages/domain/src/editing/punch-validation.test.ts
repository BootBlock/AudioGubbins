import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '../audio/channel-layout.js';
import { unsafeBrandId, type TakeId } from '../identity/branded-id.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import { TakeState, type Take, type TakeStack } from '../project/take-stack.js';
import {
  assetOf,
  editingEntities,
  frames,
  operationId,
  OTHER_RATE,
  range,
} from '../testing/editing-fixtures.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { sourceShape } from './edit-shape.js';
import { FadeShape } from './fades.js';
import { validateChain, validateOperation } from './operation-validation.js';
import type { EditOperation } from './operations.js';
import { validateRegion } from './placement-validation.js';
import { validateTakeStack, validateTakeStackInProject } from './take-stack-validation.js';
import { createProject } from '../project/project.js';

const TARGET = assetOf('target', 1_000);
const STACK = unsafeBrandId<'TakeStackId'>('0000cccc-stack');
const TAKE = unsafeBrandId<'TakeId'>('0000dddd-take');

function recording(
  name: string,
  length: number,
  rate = TARGET.sampleRate,
  layout: ChannelLayout = StandardLayouts.stereo,
): Asset {
  return { ...assetOf(name, length, [], layout, rate), origin: AssetOrigin.Recorded };
}

const RECORDING = recording('recording', 130);

function take(changes: Partial<Take> = {}): Take {
  return {
    id: TAKE,
    asset: RECORDING.id,
    name: 'Take 1',
    note: '',
    state: TakeState.Kept,
    compensation: 0,
    ...changes,
  };
}

function stack(changes: Partial<TakeStack> = {}): TakeStack {
  return {
    id: STACK,
    name: 'Verse',
    takes: [take()],
    chosen: TAKE,
    punch: {
      length: frames(100),
      preRoll: frames(20),
      postRoll: frames(10),
      crossfade: { length: frames(10), shape: FadeShape.EqualPower },
      resampler: 1,
    },
    ...changes,
  };
}

function punch(start = 200, end = 300, channels?: readonly number[]): EditOperation {
  return {
    id: operationId('punch'),
    kind: 'process',
    range: range(start, end),
    ...(channels === undefined ? {} : { channels }),
    edit: { kind: 'punch', stack: STACK },
  };
}

function refusal(
  operation: EditOperation,
  stacks: readonly TakeStack[],
  assets: readonly Asset[] = [TARGET, RECORDING],
): string {
  const result = validateOperation(
    operation,
    sourceShape(TARGET),
    editingEntities(
      new Map(assets.map((asset) => [asset.id, asset])),
      new Map(),
      new Map(stacks.map((value) => [value.id, value])),
    ),
  );
  if (result.ok) throw new Error('Expected a refusal.');
  return result.failures[0].summary;
}

function accepted(
  operation: EditOperation,
  stacks: readonly TakeStack[],
  assets: readonly Asset[] = [TARGET, RECORDING],
): boolean {
  return validateOperation(
    operation,
    sourceShape(TARGET),
    editingEntities(
      new Map(assets.map((asset) => [asset.id, asset])),
      new Map(),
      new Map(stacks.map((value) => [value.id, value])),
    ),
  ).ok;
}

describe('a punch edit where it stands', () => {
  it('stands over a range the length its stack was recorded for, with a take long enough', () => {
    expect(accepted(punch(), [stack()])).toBe(true);
    // From the pre-roll's end the recording holds exactly the range and the post-roll.
    expect(accepted(punch(), [stack({ takes: [take({ compensation: 10 })] })])).toBe(true);
  });

  it('acts on every channel, never on some', () => {
    expect(refusal(punch(200, 300, [0]), [stack()])).toBe('A punch replaces every channel.');
  });

  it('names a punch stack the project has', () => {
    expect(refusal(punch(), [])).toBe('The punch names a take stack the project does not have.');
    const { punch: _punch, ...plain } = stack();
    expect(refusal(punch(), [plain])).toBe(
      'The punch names a take stack that was not recorded for one.',
    );
  });

  it('covers exactly the length its stack was recorded for', () => {
    expect(refusal(punch(200, 299), [stack()])).toBe(
      'The punch’s range is not the length its take stack was recorded for.',
    );
  });

  it('refuses a chosen take too short, of other channels, or shifted before its start', () => {
    expect(refusal(punch(), [stack({ takes: [take({ compensation: 11 })] })])).toBe(
      'The take is shorter than the range it would replace.',
    );
    expect(refusal(punch(), [stack({ takes: [take({ compensation: -21 })] })])).toBe(
      'The take’s latency compensation reaches before its recording starts.',
    );
    const mono = recording('mono', 200, TARGET.sampleRate, StandardLayouts.mono);
    expect(refusal(punch(), [stack({ takes: [take({ asset: mono.id })] })], [TARGET, mono])).toBe(
      'The take has another number of channels than the audio it would replace.',
    );
  });

  it('reads a take at another rate for as many of its own frames as become the range', () => {
    // 100 frames at 48 kHz are ⌈100 · 44 100 / 48 000⌉ = 92 frames at 44.1 kHz.
    const exact = recording('slow', 20 + 92, OTHER_RATE);
    const short = recording('shorter', 20 + 91, OTHER_RATE);
    expect(
      accepted(punch(), [stack({ takes: [take({ asset: exact.id })] })], [TARGET, exact]),
    ).toBe(true);
    expect(refusal(punch(), [stack({ takes: [take({ asset: short.id })] })], [TARGET, short])).toBe(
      'The take is shorter than the range it would replace.',
    );
  });

  it('stands with no chosen take, whatever its takes hold', () => {
    const { chosen: _chosen, ...unchosen } = stack({ takes: [take({ compensation: 500 })] });
    expect(accepted(punch(), [unchosen])).toBe(true);
  });

  it('is never made in a region’s processing', () => {
    const result = validateRegion(
      TARGET,
      {
        id: unsafeBrandId<'RegionId'>('0000eeee-region'),
        assetId: TARGET.id,
        displayName: 'Region',
        basis: 0,
        start: frames(0),
        end: frames(1_000),
        tags: [],
        operations: [
          {
            id: operationId('punch'),
            basis: 0,
            range: range(200, 300),
            edit: { kind: 'punch', stack: STACK },
          },
        ],
      },
      new Map(),
    );
    expect(result.ok ? '' : result.failures[0].summary).toBe(
      'A punch replaces part of an asset, so it is made on the asset, never in a region’s processing.',
    );
  });
});

describe('a take stack where it stands', () => {
  const assets = new Map([[RECORDING.id, RECORDING]]);
  const summary = (value: TakeStack): string => {
    const result = validateTakeStack(value, assets);
    return result.ok ? '' : result.failures[0].summary;
  };

  it('holds takes of recordings the project has, each once', () => {
    expect(expectSuccess(validateTakeStack(stack(), assets))).toEqual(stack());
    expect(summary(stack({ takes: [take(), take()] }))).toBe(
      'Two of the stack’s takes share an identifier.',
    );
    expect(summary(stack({ takes: [take({ asset: TARGET.id })] }))).toBe(
      'A take names a recording the project does not have.',
    );
    const imported = validateTakeStack(
      stack({ takes: [take({ asset: TARGET.id })] }),
      new Map([[TARGET.id, TARGET]]),
    );
    expect(imported.ok ? '' : imported.failures[0].summary).toBe(
      'A take names an asset that was not recorded.',
    );
    expect(summary(stack({ takes: [take({ compensation: 0.5 })] }))).toBe(
      'A take’s latency compensation is not a whole number of frames.',
    );
  });

  it('chooses only a take it keeps', () => {
    const other: TakeId = unsafeBrandId<'TakeId'>('0000dddd-other');
    expect(summary(stack({ chosen: other }))).toBe(
      'The stack’s chosen take is not one of its takes.',
    );
    for (const state of [TakeState.Rejected, TakeState.Removed]) {
      expect(summary(stack({ takes: [take({ state })] }))).toBe(
        'A rejected or removed take cannot be the chosen one.',
      );
    }
  });

  it('holds a punch whose crossfades fit inside its range', () => {
    const base = stack().punch;
    if (base === undefined) throw new Error('The stack is a punch’s.');
    const withPunch = (changes: object): TakeStack => stack({ punch: { ...base, ...changes } });
    expect(summary(withPunch({ crossfade: { length: frames(51), shape: FadeShape.Linear } }))).toBe(
      'The punch’s crossfades would overlap.',
    );
    expect(summary(withPunch({ crossfade: { length: frames(50), shape: FadeShape.Linear } }))).toBe(
      '',
    );
    expect(summary(withPunch({ length: 0 }))).toBe('A punch covers no whole number of frames.');
    expect(summary(withPunch({ preRoll: -1 }))).toBe(
      'A punch’s pre-roll and post-roll are whole numbers of frames.',
    );
    expect(summary(withPunch({ resampler: 0 }))).toBe(
      'A punch names the version of the resampler a take at another rate is converted by.',
    );
  });

  it('in a project, leaves every punch that names it standing', () => {
    const project = {
      ...createProject(unsafeBrandId<'ProjectId'>('0000ffff-project'), 'Project', {
        sampleRate: TARGET.sampleRate,
        channelLayout: StandardLayouts.stereo,
      }),
      assets: new Map([
        [TARGET.id, { ...TARGET, edits: [punch()] }],
        [RECORDING.id, RECORDING],
      ]),
      takeStacks: new Map([[STACK, stack()]]),
    };
    expectSuccess(
      validateChain({ ...TARGET, edits: [punch()] }, { ...project, effectChains: new Map() }),
    );
    expectSuccess(validateTakeStackInProject(stack(), project));
    const shorter = stack({ takes: [take({ compensation: 40 })] });
    expectSuccess(validateTakeStack(shorter, project.assets));
    expect(expectFailureCode(validateTakeStackInProject(shorter, project))).toBe(
      'editing.operation-invalid',
    );
  });
});
