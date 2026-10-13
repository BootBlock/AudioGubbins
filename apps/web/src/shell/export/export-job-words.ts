/**
 * What is said of an export's files wherever one is shown (ADR-0092,
 * REQ-EDIT-072): where a file of the batch has got, as the progress surface
 * and the Inspector say it, and where a file goes or went, from the place the
 * person chose or from the record the project's history keeps. How settings
 * make a file is `export-words.ts`, shared with the Export dialog.
 */

import type { ExportJob } from '@audiogubbins/import-export';
import { ExportDestinationKind, type ExportDestination } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import type { ExportDestinationChoice } from '../../export/export-types.js';
import { POLICY_WORDS, trustedFolderWords } from './export-words.js';

/** Where a file of the batch is, in a phrase. */
export function stageWords(job: ExportJob): string {
  const { state } = job;
  switch (state.kind) {
    case 'planned':
      return 'Waiting';
    case 'rendering':
      return `Rendering, ${String(Math.floor((state.framesRendered / Math.max(1, job.framesTotal)) * 100))}%`;
    case 'encoding':
      return 'Finishing the file';
    case 'staged':
      return state.refused === undefined
        ? 'Ready to deliver'
        : `Not delivered: ${state.refused.summary}`;
    case 'delivering':
      return 'Delivering';
    case 'delivered':
      return 'Exported';
    case 'failed':
      return `Failed: ${state.failure.summary}`;
    case 'cancelled':
      return 'Cancelled';
  }
}

/**
 * Where a file of the page's export goes, as the person chose it, in a
 * sentence without its full stop: the file or folder named, a trusted folder
 * by the name `trustedName` gives its key, and what is done with a name taken.
 */
export function chosenDestinationWords(
  destination: ExportDestinationChoice,
  trustedName: (key: string) => string | undefined,
): string {
  switch (destination.kind) {
    case 'file':
      return `To ${quoted(destination.handle.name)}, the file chosen in a save dialog`;
    case 'folder':
      return `Into ${quoted(destination.handle.name)}, where ${POLICY_WORDS[destination.policy]}`;
    case 'trusted-folder':
      return `Into ${trustedFolderWords(trustedName(destination.key), destination.policy)}`;
    case 'download':
      return 'As a download';
  }
}

/**
 * Where an export the project's history records went, in a sentence without
 * its full stop, by the name the person knew the place by where the record
 * still keeps it: stripping provenance takes the name away.
 */
export function recordedDestinationWords(destination: ExportDestination): string {
  const { label } = destination;
  const named = label === undefined ? undefined : quoted(label);
  switch (destination.kind) {
    case ExportDestinationKind.File:
      return named === undefined
        ? 'To a file chosen in a save dialog'
        : `To ${named}, a file chosen in a save dialog`;
    case ExportDestinationKind.Directory:
      return named === undefined ? 'Into a folder' : `Into ${named}`;
    case ExportDestinationKind.TrustedDirectory:
      return `Into ${named ?? 'a folder'}, kept trusted`;
    case ExportDestinationKind.Download:
      return 'As a download';
    case ExportDestinationKind.GodotProject:
      return named === undefined ? 'Into a Godot project' : `Into the Godot project ${named}`;
    case ExportDestinationKind.Bundle:
      return named === undefined ? 'Into a bundle' : `Into the bundle ${named}`;
  }
}
