/**
 * Naming the project (REQ-PROD-056, REQ-EDIT-073).
 *
 * `project.rename` is what a person does: the name is trimmed and must say
 * something. `project.set-name` is what undo does: it sets the name exactly as
 * it was, so undoing a rename of a project an older document named " Forest"
 * gives back " Forest", not "Forest" (REQ-STOR-101).
 */

import {
  CommandCategory,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import type { ProjectState } from '@audiogubbins/project-format';

import { refusedBy, textArgument } from './invocation-arguments.js';
import { heldName, typedName, type NameRule } from './names.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  quoted,
  type ProjectCommand,
} from './project-command.js';
import { withProjectName } from './state-edits.js';

/** The two commands that name the project. */
export function projectNameCommands(): readonly ProjectCommand[] {
  return [
    projectCommand({
      id: ProjectCommandId.Rename,
      label: 'Rename project',
      category: CommandCategory.File,
      description: 'Gives the project a new name. The name is trimmed and cannot be blank.',
      run: (state, invocation) => rename(state, invocation, typedName),
      provenance: NO_PROVENANCE,
    }),
    projectCommand({
      id: ProjectCommandId.SetName,
      label: 'Set the project name',
      category: CommandCategory.File,
      description:
        'Sets the project name exactly as given, which is how undo restores the name it had.',
      run: (state, invocation) => rename(state, invocation, heldName),
      provenance: NO_PROVENANCE,
    }),
  ];
}

function rename(
  state: ProjectState,
  invocation: CommandInvocation,
  rule: NameRule,
): CommandOutcome<ProjectState> {
  const text = textArgument(invocation, 'name');
  if (!text.ok) return refusedBy(text);
  const name = rule('project', text.value);
  if (!name.ok) return refusedBy(name);

  const before = state.project.displayName;
  if (name.value === before) {
    return unchanged('project.name-unchanged', `The project is already called ${quoted(before)}.`);
  }
  return applied(
    withProjectName(state, name.value),
    { commandId: ProjectCommandId.SetName, arguments: { name: before } },
    `Rename project to ${quoted(name.value)}`,
  );
}
