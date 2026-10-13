/**
 * Keeping the settings a project was last exported with (ADR-0092,
 * REQ-EDIT-073).
 *
 * The project's state keeps the settings its Export dialog opens with, so a
 * project exported once is exported again as it was. Setting them is a change
 * like any other, which undo reverses; the export itself is not, and is
 * recorded apart as an export record (REQ-STOR-197, REQ-STOR-198). The
 * settings travel as one argument of canonical JSON in the document's shape,
 * read by the project format's own reader; an invocation without it takes the
 * settings away, as undoing the first export's does.
 */

import {
  CommandCategory,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  NESTED_ARGUMENT_LIMITS,
  canonicalJson,
  parseJson,
  readExportSettings,
  writeExportSettings,
  type ProjectState,
} from '@audiogubbins/project-format';

import { optionalTextArgument, readNested, refusedBy } from './invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  type ProjectCommand,
} from './project-command.js';

/** The settings a project keeps of its last export. */
type ExportSettings = NonNullable<ProjectState['exportSettings']>;

/** The command that keeps the project's last export settings. */
export function exportSettingsCommands(): readonly ProjectCommand[] {
  return [
    projectCommand({
      id: ProjectCommandId.SetExportSettings,
      label: 'Keep the export settings',
      category: CommandCategory.File,
      description:
        'Keeps the settings the project was exported with, which the Export dialog opens with next time.',
      run: setExportSettings,
      provenance: NO_PROVENANCE,
    }),
  ];
}

/** The invocation that keeps `settings`, or takes the kept settings away where it is absent. */
export function setExportSettingsInvocation(
  settings: ExportSettings | undefined,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetExportSettings,
    ...(settings === undefined
      ? {}
      : { arguments: { settings: canonicalJson(writeExportSettings(settings)) } }),
  };
}

function setExportSettings(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const text = optionalTextArgument(invocation, 'settings');
  if (!text.ok) return refusedBy(text);
  let settings: ExportSettings | undefined;
  if (text.value !== undefined) {
    const value = parseJson(text.value, NESTED_ARGUMENT_LIMITS);
    if (!value.ok) return refusedBy(value);
    const read = readNested(readExportSettings, value.value, '');
    if (!read.ok) return refusedBy(read);
    settings = read.value;
  }
  const before = state.exportSettings;
  if (written(before) === written(settings)) {
    return unchanged(
      'project.export-settings-unchanged',
      'The project keeps these export settings already.',
    );
  }
  const { exportSettings: _previous, ...rest } = state;
  return applied(
    settings === undefined ? rest : { ...rest, exportSettings: settings },
    setExportSettingsInvocation(before),
    settings === undefined ? 'Forget the export settings' : 'Keep the export settings',
  );
}

/** The settings as their canonical text, so two equal records compare equal. */
function written(settings: ExportSettings | undefined): string | undefined {
  return settings === undefined ? undefined : canonicalJson(writeExportSettings(settings));
}
