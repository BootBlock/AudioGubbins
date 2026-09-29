import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { ProjectCommandId } from './project-command.js';
import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
  unchangedCodeOf,
} from './testing/bus-runs.js';
import { referenceState } from './testing/reference-state.js';

const bus = projectBus();
const { state } = referenceState(sampleProject());

function rename(name: string | number): CommandInvocation {
  return { commandId: ProjectCommandId.Rename, arguments: { name } };
}

function setName(name: string): CommandInvocation {
  return { commandId: ProjectCommandId.SetName, arguments: { name } };
}

describe('project.rename', () => {
  it('names the project with the name trimmed, and says so for the undo menu', () => {
    const result = bus.execute(state, rename('  Forest  '));

    expect(appliedOf(result).next.project.displayName).toBe('Forest');
    assertReadsBack(appliedOf(result).next);
    expect(entryOf(result).description).toBe('Rename project to “Forest”');
  });

  it('is undone by setting the name it had, exactly', () => {
    const result = bus.execute(state, rename('Forest'));
    const { inverse } = entryOf(result);

    expect(inverse).toEqual([setName('Footstep pack')]);
    expect(appliedOf(bus.execute(appliedOf(result).next, inverse[0])).next).toEqual(state);
  });

  it('refuses a blank name', () => {
    expect(refusalCodeOf(bus.execute(state, rename(' \t\n ')))).toBe('project.name-blank');
  });

  it('refuses a name longer than the project document holds, saying the bound', () => {
    const result = bus.execute(state, rename('x'.repeat(1_025)));

    expect(refusalCodeOf(result)).toBe('project.name-too-long');
    expect(result.kind === 'refused' ? result.failures[0].summary : '').toContain('1024');
    expect(bus.execute(state, rename('x'.repeat(1_024))).kind).toBe('applied');
  });

  it('refuses an invocation without a name, or with one that is not text', () => {
    expect(refusalCodeOf(bus.execute(state, { commandId: ProjectCommandId.Rename }))).toBe(
      'argument.missing',
    );
    expect(refusalCodeOf(bus.execute(state, rename(7)))).toBe('argument.not-text');
  });

  it('changes nothing when the project already has the name', () => {
    expect(unchangedCodeOf(bus.execute(state, rename(' Footstep pack ')))).toBe(
      'project.name-unchanged',
    );
  });
});

describe('project.set-name', () => {
  it('sets a name exactly as given, padding and all, so undo restores any name', () => {
    const padded = appliedOf(bus.execute(state, setName(' Forest '))).next;
    expect(padded.project.displayName).toBe(' Forest ');
    assertReadsBack(padded);

    const renamed = bus.execute(padded, rename('Meadow'));
    const undone = bus.execute(appliedOf(renamed).next, entryOf(renamed).inverse[0]);
    expect(appliedOf(undone).next).toEqual(padded);
  });

  it('sets a blank name, which a document may hold, but not one past the bound', () => {
    expect(appliedOf(bus.execute(state, setName(''))).next.project.displayName).toBe('');
    expect(refusalCodeOf(bus.execute(state, setName('x'.repeat(1_025))))).toBe(
      'project.name-too-long',
    );
  });
});
