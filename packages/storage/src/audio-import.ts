/**
 * Bringing an audio file into an open project as a new asset, in one change
 * undo reverses (ADR-0052, ADR-0090, REQ-AUDIO-220, REQ-STOR-025).
 *
 * The file is analysed first (`import-analysis.ts`), so a file in a format no
 * implementation reads, a malformed one, or one the storage has no room for,
 * is refused with the sentence that names why before a byte is stored. A file
 * the read contract reads where it lies is then brought in by copy or by link
 * as the person's setting says, through the media store's own pipeline, and
 * the asset is built from what the reader found: the rate, the layout and the
 * whole frames present, with the file's audio shape, the code its samples are
 * stored in, and its metadata in its provenance (REQ-STOR-166). Any other file
 * is decoded once into a rendition (`decoded-import.ts`). Either way the
 * file's loops and cue points become regions with loops and markers
 * (`import-placements.ts`), added with the asset as one change; the commands
 * are the caller's, since the storage does not depend on the project
 * commands.
 *
 * An import is prepared, everything it stores stored and held, then added, so
 * a batch prepares one file while the one before it is added (ADR-0090). A
 * managed object the import stored is held in the media store until storage
 * holds the change that refers to it, and released at once where the change is
 * not made, so collection never takes it in between and a refused or cancelled
 * import keeps nothing.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import { nameFromFile } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { prepareDecoded } from './decoded-import.js';
import { analyseFile } from './import-analysis.js';
import type {
  AudioImport,
  AudioImportServices,
  ImportCommands,
  ImportObserver,
  ImportedAudio,
  PreparedImport,
} from './import-contracts.js';
import { prepareInPlace } from './in-place-import.js';
import { runHolding } from './media-holds.js';
import type { ProjectSession } from './project-session.js';

/** Imports `request.file` into the session's project (see the module comment). */
export async function importAudio(
  session: ProjectSession,
  request: AudioImport,
  services: AudioImportServices,
  observe: ImportObserver = () => undefined,
  signal?: AbortSignal,
): Promise<DomainResult<ImportedAudio>> {
  const prepared = await prepareImport(session, request, services, observe, signal);
  if (!prepared.ok) return prepared;
  observe({ kind: 'add' });
  return await addPrepared(session, prepared.value, services.commands);
}

/**
 * Analyses, keeps and, where it needs it, decodes `request.file`, ready to be
 * added to the session's project (see the module comment). Rejects with the
 * signal's reason, having kept nothing, where the import is cancelled.
 */
export async function prepareImport(
  session: ProjectSession,
  request: AudioImport,
  services: AudioImportServices,
  observe: ImportObserver,
  signal?: AbortSignal,
): Promise<DomainResult<PreparedImport>> {
  observe({ kind: 'analyse' });
  const analysis = await analyseFile(request.file, signal);
  if (!analysis.ok) return analysis;
  const name = nameFromFile('asset', request.file.fileName);
  if (!name.ok) return name;
  const project = session.getSnapshot().model.state.project.id;
  if (analysis.value.kind === 'decode') {
    return await prepareDecoded(
      { ...request, displayName: name.value, project, route: analysis.value },
      services,
      observe,
      signal,
    );
  }
  return await prepareInPlace(
    { ...request, displayName: name.value, project, format: analysis.value.format },
    analysis.value.metadata,
    services,
    observe,
    signal,
  );
}

/**
 * Adds a prepared import's asset, with the regions and markers its file's
 * loops and cues became, as one change, then lets go of what it holds once
 * storage holds the change, or at once where the change is not made.
 */
export async function addPrepared(
  session: ProjectSession,
  prepared: PreparedImport,
  commands: ImportCommands,
): Promise<DomainResult<ImportedAudio>> {
  const { asset, source, placements } = prepared;
  const ran = await runHolding(session, prepared.release, async () => {
    const added = commands.addAsset(asset, source);
    const placed = [
      ...placements.regions.map(commands.addRegion),
      ...placements.markers.map(commands.addMarker),
    ];
    return placed.length === 0
      ? await session.run(added)
      : await session.runGroup(`Import ${quoted(asset.displayName)}`, [added, ...placed]);
  });
  if (!ran.ok) return ran;
  return succeed({
    outcome: ran.value,
    asset,
    shortfall: prepared.shortfall,
    placed: { regions: placements.regions.length, markers: placements.markers.length },
    skipped: placements.skipped,
    ...(prepared.metadataRefused === undefined
      ? {}
      : { metadataRefused: prepared.metadataRefused }),
  });
}
