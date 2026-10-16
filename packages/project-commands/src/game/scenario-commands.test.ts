import { describe, expect, it } from 'vitest';

import type { CommandInvocation, ExecutionResult } from '@audiogubbins/commands';
import type { GamePreviewScenario, PreviewSubject } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { removeRegionInvocation } from '../editing/region-invocations.js';
import { ProjectCommandId } from '../project-command.js';
import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
  unchangedCodeOf,
} from '../testing/bus-runs.js';
import { groupedState } from '../testing/grouped-state.js';
import { referenceState } from '../testing/reference-state.js';
import {
  addScenarioInvocation,
  removeGroupInvocation,
  removeScenarioInvocation,
  setScenarioInvocation,
  unassignMemberInvocation,
} from './game-invocations.js';

/**
 * The game preview's scenarios as project state (ADR-0104, ADR-0106): added,
 * changed and removed whole, each undone exactly in one step, and a group or
 * member a scenario plays kept until the scenario stops playing it.
 */

const bus = projectBus();
const fixture = sampleProject();
const reference = referenceState(fixture);
const ids = fixture.ids;
const { state, groups, members } = groupedState(
  reference.state,
  reference.assets,
  fixture.regions.loop,
  ids,
);

/** A scenario whose emitters play `subjects`, one each, by hand. */
function scenarioPlaying(
  name: string,
  ...subjects: readonly PreviewSubject[]
): GamePreviewScenario {
  return {
    id: ids.next<'GamePreviewScenarioId'>(),
    name,
    space: '3d',
    panWidth: 1_152,
    panningStrength: 0.5,
    listener: { at: { x: 0, y: 0, z: 0 }, facingTurns: 0.25 },
    emitters: subjects.map((subject, index) => ({
      id: ids.next<'PreviewEmitterId'>(),
      name: `Emitter ${String(index + 1)}`,
      subject,
      trigger: { kind: 'by-hand' },
      motion: { kind: 'still', at: { x: 1.5, y: 0, z: -2 } },
    })),
    seed: 42,
    busLevels: [],
  };
}

const CORRIDOR = scenarioPlaying(
  'Corridor',
  { kind: 'group', group: groups.gravel.id },
  { kind: 'member', member: members.footstep },
);

/** Runs `invocation`, checks it applied and reads back, and that its inverse undoes it exactly. */
function appliedAndUndone(from: ProjectState, invocation: CommandInvocation) {
  const result = bus.execute(from, invocation);
  const { next } = appliedOf(result);
  assertReadsBack(next);
  let undone = next;
  for (const inverse of entryOf(result).inverse) {
    undone = appliedOf(bus.execute(undone, inverse)).next;
    assertReadsBack(undone);
  }
  expect(undone).toEqual(from);
  return { next, entry: entryOf(result) };
}

function reasonsOf(result: ExecutionResult<ProjectState>): string {
  if (result.kind !== 'refused') throw new Error(`Expected a refusal; it was ${result.kind}.`);
  return result.failures.map((failure) => failure.summary).join(' ');
}

const WITH_CORRIDOR = appliedOf(bus.execute(state, addScenarioInvocation(CORRIDOR))).next;

describe('game.add-scenario', () => {
  it('adds a scenario whole, undone in one step', () => {
    const { next, entry } = appliedAndUndone(state, addScenarioInvocation(CORRIDOR));
    expect(next.gameAudio?.scenarios.get(CORRIDOR.id)).toEqual(CORRIDOR);
    expect(entry.description).toBe('Add the preview scenario “Corridor”');
    expect(entry.inverse).toEqual([removeScenarioInvocation(CORRIDOR.id)]);
  });

  it('refuses a scenario the project holds under that identifier already', () => {
    expect(refusalCodeOf(bus.execute(WITH_CORRIDOR, addScenarioInvocation(CORRIDOR)))).toBe(
      'game.scenario-duplicate-id',
    );
  });

  it('refuses an emitter playing a sound in no group, naming the scenario', () => {
    const loose = scenarioPlaying('Loose', {
      kind: 'member',
      member: { kind: 'asset', asset: fixture.assets.ambience.id },
    });
    const result = bus.execute(state, addScenarioInvocation(loose));
    expect(refusalCodeOf(result)).toBe('game.scenario-subject-unknown');
    expect(reasonsOf(result)).toContain('"Loose"');
  });

  it('refuses a scenario its own rules refuse', () => {
    const result = bus.execute(state, addScenarioInvocation({ ...CORRIDOR, seed: 2 ** 32 }));
    expect(refusalCodeOf(result)).toBe('game.scenario-invalid');
  });

  it('refuses an argument that is not a scenario, saying where', () => {
    const result = bus.execute(state, {
      commandId: ProjectCommandId.AddScenario,
      arguments: { scenario: '{"id":"deadbeef-0001"}' },
    });
    expect(refusalCodeOf(result)).toBe('schema.missing-member');
  });
});

describe('game.set-scenario', () => {
  it('replaces a scenario whole, its inverse the scenario it was', () => {
    const changed = { ...CORRIDOR, seed: 7, name: 'Hall' };
    const { next, entry } = appliedAndUndone(WITH_CORRIDOR, setScenarioInvocation(changed));
    expect(next.gameAudio?.scenarios.get(CORRIDOR.id)).toEqual(changed);
    expect(entry.inverse).toEqual([setScenarioInvocation(CORRIDOR)]);
    expect(entry.description).toBe('Change the preview scenario “Corridor”, now called “Hall”');
  });

  it('changes nothing where the scenario is already so', () => {
    expect(unchangedCodeOf(bus.execute(WITH_CORRIDOR, setScenarioInvocation(CORRIDOR)))).toBe(
      'game.scenario-unchanged',
    );
  });

  it('refuses a scenario the project does not hold', () => {
    expect(refusalCodeOf(bus.execute(state, setScenarioInvocation(CORRIDOR)))).toBe(
      'game.scenario-unknown',
    );
  });
});

describe('game.remove-scenario', () => {
  it('removes a scenario, its inverse adding it back whole', () => {
    const { next, entry } = appliedAndUndone(WITH_CORRIDOR, removeScenarioInvocation(CORRIDOR.id));
    expect(next.gameAudio?.scenarios.has(CORRIDOR.id)).toBe(false);
    expect(entry.inverse).toEqual([addScenarioInvocation(CORRIDOR)]);
    expect(entry.description).toBe('Remove the preview scenario “Corridor”');
  });

  it('refuses a scenario the project does not hold', () => {
    expect(refusalCodeOf(bus.execute(state, removeScenarioInvocation(CORRIDOR.id)))).toBe(
      'game.scenario-unknown',
    );
  });
});

describe('what a scenario plays', () => {
  it('keeps its group: removing it is refused naming the scenario', () => {
    const emptied = appliedOf(
      bus.execute(WITH_CORRIDOR, unassignMemberInvocation(members.loop)),
    ).next;
    // Gravel has no member left, so only the scenario holds it.
    const without = appliedOf(bus.execute(emptied, removeScenarioInvocation(CORRIDOR.id))).next;
    expect(bus.execute(without, removeGroupInvocation(groups.gravel.id)).kind).toBe('applied');
    const result = bus.execute(emptied, removeGroupInvocation(groups.gravel.id));
    expect(refusalCodeOf(result)).toBe('game.subject-played');
    expect(reasonsOf(result)).toContain('The preview scenario “Corridor” plays group');
  });

  it('keeps its member in its group, refusing to take it out', () => {
    const result = bus.execute(WITH_CORRIDOR, unassignMemberInvocation(members.footstep));
    expect(refusalCodeOf(result)).toBe('game.subject-played');
    expect(reasonsOf(result)).toContain('“Corridor”');
    expect(bus.execute(state, unassignMemberInvocation(members.footstep)).kind).toBe('applied');
  });

  it('keeps its member in the project, refusing to remove its region', () => {
    const looping = appliedOf(
      bus.execute(
        state,
        addScenarioInvocation(scenarioPlaying('Loop', { kind: 'member', member: members.loop })),
      ),
    ).next;
    const remove = removeRegionInvocation(fixture.regions.loop);
    const result = bus.execute(looping, remove);
    expect(refusalCodeOf(result)).toBe('game.subject-played');
    expect(reasonsOf(result)).toContain('The preview scenario “Loop” plays the region');
    expect(bus.execute(state, remove).kind).toBe('applied');
  });
});
