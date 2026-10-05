/**
 * What every project command shares: its identifiers, the shape it is declared
 * in, and the outcome of a change with its inverse and undo description.
 *
 * Each declares which of its arguments hold provenance, and of which shape,
 * since only the command knows: a whole history exported with less of where
 * its audio came from has every change rewritten through the port built from
 * those declarations (`project-commands.ts`, REQ-STOR-166).
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
import type { ProjectState, ProvenanceArguments } from '@audiogubbins/project-format';

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
  ApplyEdit: commandId('project.apply-edit'),
  WithdrawEdit: commandId('project.withdraw-edit'),
  AddMarker: commandId('project.add-marker'),
  RemoveMarker: commandId('project.remove-marker'),
  SetMarker: commandId('project.set-marker'),
  AddRegion: commandId('project.add-region'),
  RemoveRegion: commandId('project.remove-region'),
  SetRegion: commandId('project.set-region'),
  ApplyRegionEdit: commandId('project.apply-region-edit'),
  WithdrawRegionEdit: commandId('project.withdraw-region-edit'),
  AddChain: commandId('project.add-chain'),
  SetChain: commandId('project.set-chain'),
  RemoveChain: commandId('project.remove-chain'),
  SetRack: commandId('project.set-rack'),
  SetEditChain: commandId('project.set-edit-chain'),
} as const;

/** What a command declares where none of its arguments holds provenance. */
export const NO_PROVENANCE: ProvenanceArguments = {};

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

  /** Which of its arguments hold provenance, by name, each with its shape. */
  readonly provenance: ProvenanceArguments;
}

/** A project command, with what it declares of the provenance its arguments hold. */
export interface ProjectCommand extends Command<ProjectState> {
  readonly provenance: ProvenanceArguments;
}

/** A project command: undoable, and never offered in the palette. */
export function projectCommand(declaration: ProjectCommandDeclaration): ProjectCommand {
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
