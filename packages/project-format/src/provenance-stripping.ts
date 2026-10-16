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
 *   type and audio shape, the compressed file a rendition was decoded from
 *   and its decoder, the originating project, and how a recording was made.
 *   It drops the original file name, the file's metadata, the label and group
 *   of the device a recording was made on, and from an external source's
 *   identity, a linked compressed file's among them, the kept handle, the
 *   file name and the relative path.
 * - `none` drops each asset's provenance whole, and strips external identity
 *   as `minimal` does. What an external source needs to be recognised again
 *   (its length, time, type, signature, fingerprint and content identity) is
 *   identity rather than provenance, and every level keeps it.
 *
 * A whole history is stripped to the same level, with one difference: its
 * changes compare the handle, name and path of a linked file, so each is
 * replaced by a placeholder rather than dropped (`provenance-placeholders.ts`).
 *
 * And for export records:
 *
 * - `full` keeps everything.
 * - `minimal` keeps what was exported and how: the state, history node,
 *   recipe, versions, output, destination kind, output identity, the audio
 *   file's settings, size, hash and codec, and status. It drops the
 *   destination's label, the audio file's name, the Godot linkage and the
 *   problems' text, any of which may name the user's files or projects.
 * - `none` keeps no record.
 *
 * An asset's display name is project content the user edits, not provenance,
 * and no level changes it. Every rewrite here gives back the very value it was
 * given where it changes nothing, so a value is at a level exactly where
 * stripping it to that level gives it back: how a reader checks one.
 */

import type { AssetId } from '@audiogubbins/domain';

import type { ExportRecord, ExportedAudioFile } from './export-provenance.js';
import type {
  AssetSource,
  DecodedRendition,
  ExternalSourceIdentity,
  MediaSource,
  ProjectState,
} from './project-state.js';
import { PlaceholderKind, type Placeholders } from './provenance-placeholders.js';
import type { RecordedProvenance } from './recorded-provenance.js';

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
  return rewriteSources(state, stateStripping(level));
}

/** The rewrite the state alone is stripped to `level` with. */
export function stateStripping(level: ProvenanceLevel): SourceRewrite {
  return sourceStripping(level, withoutLocation);
}

/**
 * The rewrite a whole history's states and changes are stripped to `level`
 * with: as the state alone is, but with each name, handle and path given by
 * `placeholders` rather than dropped.
 */
export function historyStripping(
  level: ProvenanceLevel,
  placeholders: Placeholders,
): SourceRewrite {
  return sourceStripping(level, (identity) => withPlaceholders(identity, placeholders));
}

/** The state with each source rewritten, or the state itself where none changed. */
export function rewriteSources(state: ProjectState, rewrite: SourceRewrite): ProjectState {
  let sources: Map<AssetId, AssetSource> | undefined;
  for (const [assetId, source] of state.sources) {
    const rewritten = rewrite.source(source);
    if (rewritten === source) continue;
    sources ??= new Map(state.sources);
    sources.set(assetId, rewritten);
  }
  return sources === undefined ? state : { ...state, sources };
}

/** The rewrite to `level` that treats an external identity with `identity`. */
function sourceStripping(
  level: ProvenanceLevel,
  identity: (identity: ExternalSourceIdentity) => ExternalSourceIdentity,
): SourceRewrite {
  if (level === ProvenanceLevel.Full) return KEEP_EVERYTHING;
  const media = (value: MediaSource): MediaSource => {
    if (value.kind === 'managed') return value;
    const rewritten = identity(value.identity);
    return rewritten === value.identity ? value : { ...value, identity: rewritten };
  };
  const source = (value: AssetSource): AssetSource => {
    const rewritten = media(value.media);
    const provenance = strippedProvenance(value, level, identity);
    if (rewritten === value.media && provenance === value.provenance) return value;
    return { media: rewritten, ...(provenance === undefined ? {} : { provenance }) };
  };
  return { source, media, identity };
}

const KEEP_EVERYTHING: SourceRewrite = {
  source: (source) => source,
  media: (media) => media,
  identity: (identity) => identity,
};

/**
 * A source's provenance at a level below `full`: without the file's name, the
 * label and group of the device it was recorded on, and the file's metadata,
 * each of which may name the person or what they work on as a file's name
 * does; and with the compressed file a rendition was decoded from, where it
 * is linked, known as `identity` gives it.
 */
function strippedProvenance(
  source: AssetSource,
  level: 'minimal' | 'none',
  identity: (identity: ExternalSourceIdentity) => ExternalSourceIdentity,
): AssetSource['provenance'] {
  const { provenance } = source;
  if (provenance === undefined || level === ProvenanceLevel.None) return undefined;
  const recording =
    provenance.recording === undefined ? undefined : withoutDevice(provenance.recording);
  const rendition =
    provenance.rendition === undefined
      ? undefined
      : withKeptIdentity(provenance.rendition, identity);
  if (
    provenance.originalFileName === undefined &&
    provenance.metadata === undefined &&
    recording === provenance.recording &&
    rendition === provenance.rendition
  ) {
    return provenance;
  }
  const {
    originalFileName: _originalFileName,
    metadata: _metadata,
    recording: _recording,
    rendition: _rendition,
    ...kept
  } = provenance;
  return {
    ...kept,
    ...(rendition === undefined ? {} : { rendition }),
    ...(recording === undefined ? {} : { recording }),
  };
}

/** A rendition's record, with a linked file known as `identity` gives it. */
function withKeptIdentity(
  rendition: DecodedRendition,
  identity: (identity: ExternalSourceIdentity) => ExternalSourceIdentity,
): DecodedRendition {
  const { kept } = rendition;
  if (kept.kind !== 'linked') return rendition;
  const rewritten = identity(kept.identity);
  return rewritten === kept.identity
    ? rendition
    : { ...rendition, kept: { ...kept, identity: rewritten } };
}

/** A recording's provenance without what names the device it was made on. */
function withoutDevice(recording: RecordedProvenance): RecordedProvenance {
  const { label, group, ...kept } = recording.device;
  return label === undefined && group === undefined ? recording : { ...recording, device: kept };
}

/** An external identity without what names or reaches the user's file. */
function withoutLocation(identity: ExternalSourceIdentity): ExternalSourceIdentity {
  const { handleKey, fileName, relativePath, ...kept } = identity;
  return handleKey === undefined && fileName === undefined && relativePath === undefined
    ? identity
    : kept;
}

/** An external identity with a placeholder for each name, handle and path it holds. */
function withPlaceholders(
  identity: ExternalSourceIdentity,
  placeholders: Placeholders,
): ExternalSourceIdentity {
  const { handleKey, fileName, relativePath, ...kept } = identity;
  const standIn = (kind: PlaceholderKind, value: string | undefined) =>
    value === undefined ? undefined : placeholders(kind, value);
  const handle = standIn(PlaceholderKind.Handle, handleKey);
  const file = standIn(PlaceholderKind.File, fileName);
  const path = standIn(PlaceholderKind.Path, relativePath);
  if (handle === handleKey && file === fileName && path === relativePath) return identity;
  return {
    ...(handle === undefined ? {} : { handleKey: handle }),
    ...(file === undefined ? {} : { fileName: file }),
    ...(path === undefined ? {} : { relativePath: path }),
    ...kept,
  };
}

/**
 * The export records stripped to `level`, each record that is at the level
 * already given back as it was.
 */
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
        const { godot, file, ...kept } = record;
        const stripped =
          godot === undefined &&
          file?.fileName === undefined &&
          file?.folder === undefined &&
          record.destination.label === undefined &&
          record.problems.length === 0;
        if (stripped) return record;
        return {
          ...kept,
          ...(file === undefined ? {} : { file: withoutWhere(file) }),
          destination: { kind: record.destination.kind },
          problems: [],
        };
      });
  }
}

/** An exported file's record without the name it was written under or the folder it went to. */
function withoutWhere(file: ExportedAudioFile): ExportedAudioFile {
  const { fileName: _fileName, folder: _folder, ...unnamed } = file;
  return unnamed;
}
