/**
 * Where a staged file is delivered, as the storage client takes it (ADR-0092):
 * the destination the person chose, with the name the file is wanted under,
 * the collision policy and the answer held for the rest of the batch, the
 * prompt that asks the person about a taken name, and, for a download, the
 * media type the browser offers it as.
 */

import type { TrustedFolders } from '@audiogubbins/browser-storage';
import type { ContainerId } from '@audiogubbins/codecs';
import { safeFileName, type CollisionAnswer, type PlannedFile } from '@audiogubbins/import-export';
import type { CollisionPrompt } from '@audiogubbins/storage';
import type { PageDestination } from '@audiogubbins/storage-runtime';
import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { exportRefusal } from './export-refusals.js';
import type { ExportDestinationChoice } from './export-types.js';

/** The media type a download of each container is offered as. */
const MEDIA_TYPES: Readonly<Record<ContainerId, string>> = {
  wav: 'audio/wav',
  rf64: 'audio/wav',
  bw64: 'audio/wav',
  aiff: 'audio/aiff',
  aifc: 'audio/aiff',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  mp4: 'audio/mp4',
  adts: 'audio/aac',
  webm: 'audio/webm',
  matroska: 'audio/x-matroska',
};

/** What a folder delivery decides a taken name by, beside the destination's own policy. */
export interface DeliveryRules {
  /** The answer the person gave for the rest of the batch, if they gave one. */
  readonly remembered: CollisionAnswer | undefined;
  readonly prompt: CollisionPrompt;

  /** The folders kept trusted, which a trusted destination is found in, absent where none are. */
  readonly trusted: TrustedFolders | undefined;
}

/**
 * The destination `file` is delivered to, as the storage client takes it, or
 * why there is none: a trusted folder where this browser keeps none.
 */
export function pageDestination(
  destination: ExportDestinationChoice,
  file: PlannedFile,
  rules: DeliveryRules,
): DomainResult<PageDestination> {
  const folderRules = {
    wanted: file.name,
    remembered: rules.remembered,
    prompt: rules.prompt,
  };
  switch (destination.kind) {
    case 'file':
      return succeed({ kind: 'file', handle: destination.handle });
    case 'download':
      return succeed({
        kind: 'download',
        name: safeFileName(file.name),
        mediaType: MEDIA_TYPES[file.target.container],
      });
    case 'folder':
      return succeed({
        kind: 'folder',
        handle: destination.handle,
        policy: destination.policy,
        ...folderRules,
      });
    case 'trusted-folder':
      return rules.trusted === undefined
        ? fail(
            exportRefusal('trusted-folders-unavailable', 'This browser keeps no trusted folder.'),
          )
        : succeed({
            kind: 'trusted-folder',
            folders: rules.trusted,
            key: destination.key,
            policy: destination.policy,
            ...folderRules,
          });
  }
}
