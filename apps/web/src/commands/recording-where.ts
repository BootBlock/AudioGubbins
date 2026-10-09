/**
 * What every command that records into a project shares: the project open to
 * write here and the storage worker's recordings, or why there is none, and the
 * programme an asset of it plays as.
 *
 * Only the tab holding a project's write lease records into it
 * (`REQ-STOR-098`), so a tab that reads the project is told why.
 */

import type { AssetId } from '@audiogubbins/domain';

import { assetProgramme } from '../audio/asset-playback.js';
import type { Programme } from '../audio/programme.js';
import { assetEntryId } from '../assets/project-entry.js';
import type { RecordingWhere } from '../recording/take-recording.js';
import { readyProjects, sessionOf } from './project-access.js';
import type { ShellContext } from './shell-context.js';

/** The programme asset `asset` of the open project plays as, or why it cannot be heard yet. */
export function programmeOf(context: ShellContext, asset: AssetId): Programme | string {
  const entry = context.assets.find(assetEntryId(asset));
  return entry === undefined
    ? 'That audio cannot be heard yet: it is still being read.'
    : assetProgramme(entry, context.hearing.get());
}

/** Where a take is recorded: the project open to write here, or why no take can be. */
export function recordingWhere(context: ShellContext): RecordingWhere | string {
  const stores = readyProjects(context);
  if (typeof stores === 'string') return stores;
  if (stores.project.get().kind !== 'open') {
    return 'Open a project to record into: a recording becomes one of its assets.';
  }
  const project = sessionOf(context);
  if (typeof project === 'string') {
    return 'Another tab holds this project for writing, so this tab cannot arm or record into it.';
  }
  return {
    client: stores.recordings,
    project,
    programme: (asset) => programmeOf(context, asset),
    kept: () => {
      stores.interrupted.refresh();
    },
  };
}
