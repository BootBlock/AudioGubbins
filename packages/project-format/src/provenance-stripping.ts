/**
 * Stripping provenance to a level a user chooses.
 *
 * REQ-STOR-166 lets a user strip or minimise provenance where privacy,
 * distribution or size calls for it, and REQ-PRIV-165 treats a file's name,
 * where it lay and the handle to it as the user's own. Each level gives a value
 * the document reader still accepts, so a stripped project is a valid project
 * and never a special case.
 *
 * The levels, for asset provenance:
 *
 * - `full` keeps everything.
 * - `minimal` keeps what identifies content and when it arrived: the import
 *   time, the source's content identity and fingerprint, its length, media
 *   type and bit depth, and the originating project. It drops the original
 *   file name, and from an external source's identity the kept handle, the
 *   file name and the relative path.
 * - `none` drops each asset's provenance whole, and strips external identity
 *   as `minimal` does. What an external source needs to be recognised again
 *   (its length, time, type, signature, fingerprint and content identity) is
 *   identity rather than provenance, and every level keeps it.
 *
 * And for export records:
 *
 * - `full` keeps everything.
 * - `minimal` keeps what was exported and how: the state, history node,
 *   recipe, versions, output, destination kind, output identity and status.
 *   It drops the destination's label, the Godot linkage and the problems'
 *   text, any of which may name the user's files or projects.
 * - `none` keeps no record.
 *
 * An asset's display name is project content the user edits, not provenance,
 * and no level changes it.
 */

import type { AssetId } from '@audiogubbins/domain';

import type { ExportRecord } from './export-provenance.js';
import type {
  AssetSource,
  ExternalSourceIdentity,
  MediaSource,
  ProjectState,
} from './project-state.js';

/** How much provenance a project or an export keeps. */
export const ProvenanceLevel = {
  Full: 'full',
  Minimal: 'minimal',
  None: 'none',
} as const;

/** How much provenance a project or an export keeps. */
export type ProvenanceLevel = (typeof ProvenanceLevel)[keyof typeof ProvenanceLevel];

/**
 * The rewrite of what a source holds of where its audio came from, for each
 * value that holds it: a whole source, its media, and a linked file's
 * identity. Each gives back the value it was given where it changes nothing.
 */
export interface SourceRewrite {
  readonly source: (source: AssetSource) => AssetSource;
  readonly media: (media: MediaSource) => MediaSource;
  readonly identity: (identity: ExternalSourceIdentity) => ExternalSourceIdentity;
}

/** The state with each asset's provenance stripped to `level`. */
export function stripAssetProvenance(state: ProjectState, level: ProvenanceLevel): ProjectState {
  if (level === ProvenanceLevel.Full) return state;

  const sources = new Map<AssetId, AssetSource>();
  for (const [assetId, source] of state.sources) {
    sources.set(assetId, strippedSource(source, level));
  }
  return { project: state.project, sources };
}

/** One source stripped to a level below `full`. */
function strippedSource(source: AssetSource, level: 'minimal' | 'none'): AssetSource {
  const media = strippedMedia(source.media);
  if (level === ProvenanceLevel.None || source.provenance === undefined) return { media };

  const { originalFileName: _originalFileName, ...kept } = source.provenance;
  return { media, provenance: kept };
}

/** Media with an external identity's names and handle removed. */
function strippedMedia(media: MediaSource): MediaSource {
  if (media.kind === 'managed') return media;
  return { ...media, identity: strippedIdentity(media.identity) };
}

/** An external identity without what names or reaches the user's file. */
function strippedIdentity(identity: ExternalSourceIdentity): ExternalSourceIdentity {
  const {
    handleKey: _handleKey,
    fileName: _fileName,
    relativePath: _relativePath,
    ...kept
  } = identity;
  return kept;
}

/** The export records stripped to `level`. */
export function stripExportRecords(
  records: readonly ExportRecord[],
  level: ProvenanceLevel,
): readonly ExportRecord[] {
  switch (level) {
    case ProvenanceLevel.Full:
      return records;
    case ProvenanceLevel.None:
      return [];
    case ProvenanceLevel.Minimal:
      return records.map((record) => {
        const { godot: _godot, ...kept } = record;
        return { ...kept, destination: { kind: record.destination.kind }, problems: [] };
      });
  }
}
