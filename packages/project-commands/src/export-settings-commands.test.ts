import { describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { ProjectState } from '@audiogubbins/project-format';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { setExportSettingsInvocation } from './export-settings-commands.js';
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

const SETTINGS: NonNullable<ProjectState['exportSettings']> = {
  format: 'flac',
  encoding: { bits: 24, compressionLevel: 5, keepRiffChunks: false },
  sampleRate: expectSuccess(sampleRate(48_000)),
  channels: { kind: 'keep' },
  dither: { kind: 'none' },
  range: { kind: 'every-region' },
  metadata: { policy: 'minimal', edits: [] },
  fileName: '{region}',
};

describe('project.set-export-settings (ADR-0092)', () => {
  it('keeps the settings the project was exported with, and the document keeps them', () => {
    const result = bus.execute(state, setExportSettingsInvocation(SETTINGS));
    const { next } = appliedOf(result);
    expect(next.exportSettings).toEqual(SETTINGS);
    expect(next.project).toBe(state.project);
    assertReadsBack(next);
    expect(entryOf(result).description).toBe('Keep the export settings');
  });

  it('is undone by setting back the settings kept before, or none', () => {
    const first = bus.execute(state, setExportSettingsInvocation(SETTINGS));
    expect(entryOf(first).inverse).toEqual([setExportSettingsInvocation(undefined)]);
    const kept = appliedOf(first).next;
    expect(appliedOf(bus.execute(kept, entryOf(first).inverse[0])).next).toEqual(state);

    const mp3 = { ...SETTINGS, format: 'mp3', encoding: { mode: 'variable', quality: 0 } } as const;
    const second = bus.execute(kept, setExportSettingsInvocation(mp3));
    expect(appliedOf(second).next.exportSettings).toEqual(mp3);
    expect(appliedOf(bus.execute(appliedOf(second).next, entryOf(second).inverse[0])).next).toEqual(
      kept,
    );
  });

  it('changes nothing where the project keeps those settings already', () => {
    const kept = appliedOf(bus.execute(state, setExportSettingsInvocation(SETTINGS))).next;
    expect(unchangedCodeOf(bus.execute(kept, setExportSettingsInvocation({ ...SETTINGS })))).toBe(
      'project.export-settings-unchanged',
    );
  });

  it('refuses settings the document could not hold', () => {
    expect(
      refusalCodeOf(
        bus.execute(state, {
          commandId: ProjectCommandId.SetExportSettings,
          arguments: { settings: '{"format":"wav"}' },
        }),
      ),
    ).toBe('schema.missing-member');
    expect(
      refusalCodeOf(
        bus.execute(state, {
          commandId: ProjectCommandId.SetExportSettings,
          arguments: { settings: 3 },
        }),
      ),
    ).toBe('argument.not-text');
  });
});
