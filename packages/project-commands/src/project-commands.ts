/**
 * Every command that changes a project (REQ-EDIT-073, REQ-STOR-101).
 *
 * Each is pure and deterministic over a {@link ProjectState}: every identifier,
 * time and value it uses is in its arguments, the caller having minted the
 * identifiers and read the clock, so replaying a journal of invocations over
 * the state it started from gives the same state again.
 */

import type { Command } from '@audiogubbins/commands';
import type { ProjectState } from '@audiogubbins/project-format';

import { assetCommands } from './asset-commands.js';
import { projectNameCommands } from './project-name-commands.js';
import { sourceCommands } from './source-commands.js';

/**
 * The project commands, for a registry the command bus runs them through. The
 * commands hold no state, so the composition root builds the list once.
 */
export function projectCommands(): readonly Command<ProjectState>[] {
  return [...projectNameCommands(), ...assetCommands(), ...sourceCommands()];
}
