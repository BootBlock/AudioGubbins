import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  AssetOrigin,
  TakeState,
  createDeterministicIdGenerator,
  derivedSampleCount,
  type EditOperation,
  type Take,
  type TakeStack,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import {
  punchedState,
  randomAssetRecord,
  seededRandom,
} from '@audiogubbins/project-format/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { ProjectCommandId } from '../project-command.js';
import { addAssetInvocation } from '../project-invocations.js';
import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
  unchangedCodeOf,
} from '../testing/bus-runs.js';
import {
  addPunchInvocation,
  addTakeInvocation,
  branchTakeStackInvocation,
  chooseTakeInvocation,
  consolidateTakeStackInvocation,
  createTakeStackInvocation,
  duplicateTakeInvocation,
  keepTakeInvocation,
  rejectTakeInvocation,
  removePunchInvocation,
  removeTakeInvocation,
  removeTakeStackInvocation,
  renameTakeInvocation,
  renameTakeStackInvocation,
  restoreTakeInvocation,
  setTakeCompensationInvocation,
  setTakeNoteInvocation,
  setTakeStackInvocation,
  withdrawTakeInvocation,
} from './take-invocations.js';

const FIXTURE = sampleProject();
const START = punchedState(FIXTURE);
const IDS = createDeterministicIdGenerator(4_242);
const bus = projectBus();

const STACK = [...START.project.takeStacks.values()][0];
const [EARLY, CHOSEN] = STACK?.takes ?? [];
if (STACK === undefined || EARLY === undefined || CHOSEN === undefined) {
  throw new Error('The punched state has a stack of two takes.');
}
const FOOTSTEP = START.project.assets.get(FIXTURE.assets.footstep.id);
const PUNCH = FOOTSTEP?.edits.at(-1);
if (FOOTSTEP === undefined || PUNCH === undefined) throw new Error('The footstep is punched.');

function run(invocation: CommandInvocation, state: ProjectState = START) {
  return bus.execute(state, invocation);
}

/** The state `invocation` makes, checked to read back and to be undone by its inverse. */
function appliedAndUndone(
  invocation: CommandInvocation,
  state: ProjectState = START,
): ProjectState {
  const result = run(invocation, state);
  const { next } = appliedOf(result);
  assertReadsBack(next);
  let undone = next;
  for (const inverse of entryOf(result).inverse) undone = appliedOf(run(inverse, undone)).next;
  expect(undone).toEqual(state);
  return next;
}

function stackIn(state: ProjectState, id = STACK?.id): TakeStack {
  const stack = id === undefined ? undefined : state.project.takeStacks.get(id);
  if (stack === undefined) throw new Error('The stack is in the project.');
  return stack;
}

function takeIn(state: ProjectState, take: Take): Take | undefined {
  return stackIn(state).takes.find((each) => each.id === take.id);
}

describe('choosing, rejecting, keeping, removing and restoring takes', () => {
  it('chooses a kept take, and refuses one that is rejected or removed', () => {
    expect(unchangedCodeOf(run(chooseTakeInvocation(STACK, CHOSEN)))).toBe('take.already-chosen');
    expect(refusalCodeOf(run(chooseTakeInvocation(STACK, EARLY)))).toBe('take.not-kept');
    const kept = appliedAndUndone(keepTakeInvocation(STACK, EARLY));
    const chosen = appliedAndUndone(chooseTakeInvocation(STACK, EARLY), kept);
    expect(stackIn(chosen).chosen).toBe(EARLY.id);
  });

  it('gives up the choice when the chosen take is rejected or removed, and undo gives it back', () => {
    const rejected = appliedAndUndone(rejectTakeInvocation(STACK, CHOSEN));
    expect(stackIn(rejected).chosen).toBeUndefined();
    expect(takeIn(rejected, CHOSEN)?.state).toBe(TakeState.Rejected);
    const removed = appliedAndUndone(removeTakeInvocation(STACK, CHOSEN));
    expect(stackIn(removed).chosen).toBeUndefined();
    expect(takeIn(removed, CHOSEN)?.state).toBe(TakeState.Removed);
  });

  it('moves a take only along the ways its state allows', () => {
    const removed = appliedAndUndone(removeTakeInvocation(STACK, EARLY));
    expect(unchangedCodeOf(run(removeTakeInvocation(STACK, EARLY), removed))).toBe(
      'take.state-unchanged',
    );
    expect(refusalCodeOf(run(keepTakeInvocation(STACK, EARLY), removed))).toBe(
      'take.state-refused',
    );
    expect(refusalCodeOf(run(rejectTakeInvocation(STACK, EARLY), removed))).toBe(
      'take.state-refused',
    );
    expect(refusalCodeOf(run(chooseTakeInvocation(STACK, EARLY), removed))).toBe('take.not-kept');
    const restored = appliedAndUndone(restoreTakeInvocation(STACK, EARLY), removed);
    expect(takeIn(restored, EARLY)?.state).toBe(TakeState.Kept);
    expect(refusalCodeOf(run(restoreTakeInvocation(STACK, EARLY)))).toBe('take.state-refused');
    expect(unchangedCodeOf(run(keepTakeInvocation(STACK, CHOSEN)))).toBe('take.state-unchanged');
  });
});

describe('naming, noting and compensating a take', () => {
  it('renames and notes a take, refusing a blank name and an overlong note', () => {
    const renamed = appliedAndUndone(renameTakeInvocation(STACK, CHOSEN, '  Keeper  '));
    expect(takeIn(renamed, CHOSEN)?.name).toBe('Keeper');
    expect(refusalCodeOf(run(renameTakeInvocation(STACK, CHOSEN, ' ')))).toBe('take.name-blank');
    expect(unchangedCodeOf(run(renameTakeInvocation(STACK, CHOSEN, CHOSEN.name)))).toBe(
      'take.name-unchanged',
    );
    appliedAndUndone(setTakeNoteInvocation(STACK, CHOSEN, 'Breathy.'));
    expect(refusalCodeOf(run(setTakeNoteInvocation(STACK, CHOSEN, 'x'.repeat(4_097))))).toBe(
      'take.note-too-long',
    );
  });

  it('refuses a compensation the punch cannot play, and one that is not whole', () => {
    // The chosen take holds exactly its pre-roll and the range.
    expect(refusalCodeOf(run(setTakeCompensationInvocation(STACK, CHOSEN, 1)))).toBe(
      'editing.operation-invalid',
    );
    const earlier = appliedAndUndone(setTakeCompensationInvocation(STACK, CHOSEN, -480));
    expect(takeIn(earlier, CHOSEN)?.compensation).toBe(-480);
    expect(refusalCodeOf(run(setTakeCompensationInvocation(STACK, CHOSEN, 0.5)))).toBe(
      'argument.not-a-whole-number',
    );
  });
});

describe('adding, duplicating and withdrawing takes', () => {
  const take = (changes: Partial<Take> = {}): Take => ({
    id: IDS.next<'TakeId'>(),
    asset: EARLY.asset,
    name: 'Take 3',
    note: '',
    state: TakeState.Kept,
    compensation: 0,
    ...changes,
  });

  it('adds a take to the end, chosen where asked, and refuses what cannot join', () => {
    const fresh = take();
    const added = appliedAndUndone(addTakeInvocation(STACK, fresh, true));
    expect(stackIn(added).takes.at(-1)).toEqual(fresh);
    expect(stackIn(added).chosen).toBe(fresh.id);
    expect(refusalCodeOf(run(addTakeInvocation(STACK, { ...fresh, id: CHOSEN.id }, false)))).toBe(
      'take.duplicate-id',
    );
    const imported = take({ asset: FIXTURE.assets.ambience.id });
    expect(refusalCodeOf(run(addTakeInvocation(STACK, imported, false)))).toBe(
      'takes.stack-invalid',
    );
    const rejected = take({ state: TakeState.Rejected });
    expect(refusalCodeOf(run(addTakeInvocation(STACK, rejected, true)))).toBe('take.not-kept');
    const late = take({ compensation: 4_000 });
    expect(refusalCodeOf(run(addTakeInvocation(STACK, late, true)))).toBe(
      'editing.operation-invalid',
    );
    const missingFlag = addTakeInvocation(STACK, fresh, true);
    const { choose: _choose, ...rest } = missingFlag.arguments ?? {};
    expect(refusalCodeOf(run({ ...missingFlag, arguments: rest }))).toBe('argument.not-a-flag');
  });

  it('withdraws only the last take, giving a choice back only from the chosen one', () => {
    expect(refusalCodeOf(run(withdrawTakeInvocation(STACK, EARLY, undefined)))).toBe(
      'take.not-last',
    );
    const withdrawn = appliedAndUndone(withdrawTakeInvocation(STACK, CHOSEN, EARLY.id), {
      ...START,
      project: {
        ...START.project,
        takeStacks: new Map([
          [STACK.id, { ...STACK, takes: [{ ...EARLY, state: TakeState.Kept }, CHOSEN] }],
        ]),
      },
    });
    expect(stackIn(withdrawn).chosen).toBe(EARLY.id);
    const added = appliedOf(run(addTakeInvocation(STACK, take(), false))).next;
    const last = stackIn(added).takes.at(-1);
    if (last === undefined) throw new Error('The stack has the take added.');
    expect(refusalCodeOf(run(withdrawTakeInvocation(STACK, last, EARLY.id), added))).toBe(
      'take.choice-not-moved',
    );
  });

  it('duplicates a take as a kept take of the same recording under its own name', () => {
    const copy = IDS.next<'TakeId'>();
    const duplicated = appliedAndUndone(duplicateTakeInvocation(STACK, EARLY, copy, 'Again'));
    expect(stackIn(duplicated).takes.at(-1)).toEqual({
      ...EARLY,
      id: copy,
      name: 'Again',
      state: TakeState.Kept,
    });
    expect(refusalCodeOf(run(duplicateTakeInvocation(STACK, EARLY, CHOSEN.id, 'Again')))).toBe(
      'take.duplicate-id',
    );
  });
});

describe('whole take stacks', () => {
  it('creates a stack once, and removes it only when no punch plays it', () => {
    expect(refusalCodeOf(run(createTakeStackInvocation(STACK)))).toBe('take-stack.duplicate-id');
    expect(refusalCodeOf(run(removeTakeStackInvocation(STACK)))).toBe('take-stack.in-use');
    const fresh: TakeStack = {
      id: IDS.next<'TakeStackId'>(),
      name: 'Verse',
      takes: [{ ...EARLY, id: IDS.next<'TakeId'>() }],
    };
    const created = appliedAndUndone(createTakeStackInvocation(fresh));
    appliedAndUndone(removeTakeStackInvocation(fresh), created);
  });

  it('renames a stack, and is set whole only with the same takes and punch', () => {
    expect(refusalCodeOf(run(renameTakeStackInvocation(STACK, '')))).toBe('take-stack.name-blank');
    appliedAndUndone(renameTakeStackInvocation(STACK, 'Bridge'));
    expect(refusalCodeOf(run(setTakeStackInvocation({ ...STACK, takes: [CHOSEN] })))).toBe(
      'take-stack.members-changed',
    );
    expect(unchangedCodeOf(run(setTakeStackInvocation(STACK)))).toBe('take-stack.unchanged');
    const unknown = { ...STACK, id: IDS.next<'TakeStackId'>() };
    expect(refusalCodeOf(run(setTakeStackInvocation(unknown)))).toBe('take-stack.unknown');
  });

  it('branches a new stack from a take, chosen in it', () => {
    const branch = IDS.next<'TakeStackId'>();
    const copy = IDS.next<'TakeId'>();
    const branched = appliedAndUndone(branchTakeStackInvocation(STACK, EARLY, branch, copy, 'B'));
    expect(stackIn(branched, branch)).toEqual({
      id: branch,
      name: 'B',
      takes: [{ ...EARLY, id: copy, state: TakeState.Kept }],
      chosen: copy,
      punch: STACK.punch,
    });
  });

  it('keeps only the chosen take active, and needs one chosen', () => {
    const consolidated = appliedAndUndone(consolidateTakeStackInvocation(STACK));
    expect(takeIn(consolidated, EARLY)?.state).toBe(TakeState.Removed);
    expect(unchangedCodeOf(run(consolidateTakeStackInvocation(STACK), consolidated))).toBe(
      'take-stack.already-consolidated',
    );
    const unchosen = appliedOf(run(rejectTakeInvocation(STACK, CHOSEN))).next;
    expect(refusalCodeOf(run(consolidateTakeStackInvocation(STACK), unchosen))).toBe(
      'take-stack.nothing-chosen',
    );
  });

  it('keeps a recording a take names in the project', () => {
    expect(
      refusalCodeOf(
        run({ commandId: ProjectCommandId.RemoveAsset, arguments: { assetId: CHOSEN.asset } }),
      ),
    ).toBe('asset.in-use');
  });
});

describe('punching in', () => {
  const punchOf = (stack: TakeStack, start: number, end: number): EditOperation => ({
    id: IDS.next<'EditOperationId'>(),
    kind: 'process',
    range: { start: derivedSampleCount(start), end: derivedSampleCount(end) },
    edit: { kind: 'punch', stack: stack.id },
  });
  const punchStack = (): TakeStack => {
    const id = IDS.next<'TakeId'>();
    return {
      ...STACK,
      id: IDS.next<'TakeStackId'>(),
      takes: [{ ...CHOSEN, id }],
      chosen: id,
    };
  };

  it('adds a punch with its new stack, and refuses one that does not fit', () => {
    const stack = punchStack();
    const withdrawn = appliedOf(run(removePunchInvocation(FOOTSTEP, PUNCH))).next;
    expect(withdrawn.project.takeStacks.has(STACK.id)).toBe(false);
    const footstep = withdrawn.project.assets.get(FOOTSTEP.id) ?? FOOTSTEP;
    appliedAndUndone(addPunchInvocation(footstep, punchOf(stack, 0, 12_000), stack), withdrawn);
    const { punch: _punch, ...plain } = stack;
    expect(
      refusalCodeOf(run(addPunchInvocation(footstep, punchOf(plain, 0, 12_000), plain), withdrawn)),
    ).toBe('punch.not-a-punch-stack');
    expect(
      refusalCodeOf(run(addPunchInvocation(footstep, punchOf(STACK, 0, 12_000), stack), withdrawn)),
    ).toBe('punch.not-its-stack');
    expect(
      refusalCodeOf(run(addPunchInvocation(footstep, punchOf(stack, 0, 11_999), stack), withdrawn)),
    ).toBe('editing.operation-invalid');
  });

  it('withdraws only the last punch, taking its stack and giving both back on undo', () => {
    const withdrawn = appliedAndUndone(removePunchInvocation(FOOTSTEP, PUNCH));
    expect(withdrawn.project.assets.get(FOOTSTEP.id)?.edits).toEqual(FOOTSTEP.edits.slice(0, -1));
    const other = { ...PUNCH, id: IDS.next<'EditOperationId'>() };
    expect(refusalCodeOf(run(removePunchInvocation(FOOTSTEP, other)))).toBe('punch.not-last');
  });

  it('is one undoable change with the recording that makes its take', () => {
    const { asset, source } = randomAssetRecord(seededRandom(5), IDS, START.project.id);
    const recorded = {
      ...asset,
      origin: AssetOrigin.Recorded,
      sampleRate: FOOTSTEP.sampleRate,
      channelLayout: FOOTSTEP.channelLayout,
      length: derivedSampleCount(20_000),
    };
    const withdrawn = appliedOf(run(removePunchInvocation(FOOTSTEP, PUNCH))).next;
    const footstep = withdrawn.project.assets.get(FOOTSTEP.id) ?? FOOTSTEP;
    const takeId = IDS.next<'TakeId'>();
    const stack: TakeStack = {
      ...punchStack(),
      takes: [{ ...CHOSEN, id: takeId, asset: recorded.id }],
      chosen: takeId,
    };
    const { provenance: _provenance, ...bare } = source;
    const result = bus.executeGroup(withdrawn, 'Record a punch', [
      addAssetInvocation(recorded, bare),
      addPunchInvocation(footstep, punchOf(stack, 12_000, 24_000), stack),
    ]);
    let state = appliedOf(result).next;
    assertReadsBack(state);
    for (const inverse of entryOf(result).inverse) state = appliedOf(run(inverse, state)).next;
    expect(state).toEqual(withdrawn);
  });
});
