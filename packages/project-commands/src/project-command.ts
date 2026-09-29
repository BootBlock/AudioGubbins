/**
 * What every project command shares: its identifiers, the shape it is declared
 * in, and the outcome of a change with its inverse and undo description.
 *
 * Every project command is undoable and returns its inverse as an invocation,
 * so the history can keep it in a journal and replay it after a reload
 * (REQ-STOR-101, ADR-0006). None is offered in the palette: each takes values
 * only a dialogue, the import pipeline or the storage layer supplies, which
 * nobody types (REQ-EDIT-073).
 */

import {
  AVAILABLE,
  commandId,
  unavailable,
  type AppliedOutcome,
  type Command,
  type CommandAvailability,
  type CommandCategory,
  type CommandId,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import type { ProjectState } from '@audiogubbins/project-format';

/** The identifier of every project command. */
export const ProjectCommandId = {
  Rename: commandId('project.rename'),
  SetName: commandId('project.set-name'),
  AddAsset: commandId('project.add-asset'),
  RemoveAsset: commandId('project.remove-asset'),
  RenameAsset: commandId('project.rename-asset'),
  SetAssetName: commandId('project.set-asset-name'),
  SetSourcePolicy: commandId('project.set-source-policy'),
  SetAssetMedia: commandId('project.set-asset-media'),
  RelinkSource: commandId('project.relink-source'),
  AdoptSourceVersion: commandId('project.adopt-source-version'),
  FreezeSource: commandId('project.freeze-source'),
} as const;

/** How a project command is declared. */
export interface ProjectCommandDeclaration {
  readonly id: CommandId;
  readonly label: string;
  readonly category: CommandCategory;
  readonly description: string;
  readonly availability?: (state: ProjectState) => CommandAvailability;
  readonly run: (
    state: ProjectState,
    invocation: CommandInvocation,
  ) => CommandOutcome<ProjectState>;
}

/** A project command: undoable, and never offered in the palette. */
export function projectCommand(declaration: ProjectCommandDeclaration): Command<ProjectState> {
  return {
    ...declaration,
    discoverable: false,
    undoable: true,
    availability: declaration.availability ?? (() => AVAILABLE),
  };
}

/** Whether the project has an asset for a command that acts on one. */
export function assetAvailability(state: ProjectState): CommandAvailability {
  return state.project.assets.size === 0 ? unavailable('The project has no assets.') : AVAILABLE;
}

/** A change, how to reverse it, and what the undo menu calls it. */
export function applied(
  next: ProjectState,
  inverse: CommandInvocation,
  description: string,
): AppliedOutcome<ProjectState> {
  return { kind: 'applied', next, inverse, description };
}

/** A name as the interface quotes it. */
export function quoted(name: string): string {
  return `“${name}”`;
}
