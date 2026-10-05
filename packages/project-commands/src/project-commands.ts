/**
 * Every command that changes a project (REQ-EDIT-073, REQ-STOR-101), and what
 * they declare of the provenance their arguments hold (REQ-STOR-166).
 *
 * Each is pure and deterministic over a project's state: every identifier,
 * time and value it uses is in its arguments, the caller having minted the
 * identifiers and read the clock, so replaying a journal of invocations over
 * the state it started from gives the same state again.
 *
 * The port a whole history is stripped and checked through is built from the
 * very commands a registry runs, so a command cannot be run without its word on
 * which arguments hold provenance, and storage learns no command's shape.
 */

import { invocationProvenance, type InvocationProvenance } from '@audiogubbins/project-format';

import { assetCommands } from './asset-commands.js';
import { editCommands } from './editing/edit-commands.js';
import { markerCommands } from './editing/marker-commands.js';
import { regionCommands } from './editing/region-commands.js';
import type { ProjectCommand } from './project-command.js';
import { projectNameCommands } from './project-name-commands.js';
import { sourceCommands } from './source-commands.js';

/**
 * The project commands, for a registry the command bus runs them through. The
 * commands hold no state, so the composition root builds the list once.
 */
export function projectCommands(): readonly ProjectCommand[] {
  return [
    ...projectNameCommands(),
    ...assetCommands(),
    ...sourceCommands(),
    ...editCommands(),
    ...markerCommands(),
    ...regionCommands(),
  ];
}

/**
 * The port over what `commands` declare of their arguments' provenance, for
 * storage to strip and check a whole history's changes with.
 */
export function commandProvenance(commands: readonly ProjectCommand[]): InvocationProvenance {
  return invocationProvenance(new Map(commands.map(({ id, provenance }) => [id, provenance])));
}
