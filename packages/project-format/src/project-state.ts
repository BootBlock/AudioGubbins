/**
 * The authoritative project aggregate: the domain project with where each of
 * its assets' bytes come from and how each was imported.
 *
 * ADR-0015 leaves the domain `Project` without storage or schema, and ADR-0020
 * puts the persisted project here. A {@link ProjectState} is what a command
 * produces, what the history records and what a document holds. It is an
 * in-memory value, never a JSON shape: `project-json.ts` converts it field by
 * field (REQ-EXEC-136.12).
 *
 * Invariants, which the document reader enforces: every asset of the project
 * has exactly one source and every source belongs to an asset, and each asset's
 * `storageKey` is {@link storageKeyOf} its source. Serves REQ-STOR-026,
 * REQ-STOR-053, REQ-STOR-099, REQ-STOR-104 and REQ-STOR-166.
 */

import type { AssetId, Project, ProjectId } from '@audiogubbins/domain';

import type { ContentId } from './content-identity.js';

/** A project and the source of each of its assets. */
export interface ProjectState {
  readonly project: Project;
  readonly sources: ReadonlyMap<AssetId, AssetSource>;
}

/** Where one asset's bytes come from, and how it came into the project. */
export interface AssetSource {
  readonly media: MediaSource;

  /**
   * How the asset was imported, or `undefined` where provenance was stripped to
   * nothing (see `provenance-stripping.ts`).
   */
  readonly provenance?: AssetProvenance;
}

/** Where an asset's bytes are kept. */
export type MediaSource = ManagedMedia | ExternalMedia;

/**
 * Bytes copied into the application's content-addressed store (REQ-STOR-099),
 * found by their content and shared by every project that holds them.
 */
export interface ManagedMedia {
  readonly kind: 'managed';
  readonly contentId: ContentId;
  readonly byteLength: number;

  /** The media type, such as `audio/wav`, without parameters. */
  readonly mediaType: string;
}

/**
 * Bytes left where the user keeps them and read through a kept permission.
 *
 * The file can change behind the project's back, so the identity it had is
 * recorded (REQ-STOR-104) with the policy for a change (REQ-STOR-053).
 */
export interface ExternalMedia {
  readonly kind: 'external';
  readonly identity: ExternalSourceIdentity;
  readonly policy: SourceChangePolicy;

  /**
   * A managed copy of the last content known, which is what lets a change be
   * refused and the prior version kept. {@link SourceChangePolicy.Freeze} needs
   * one.
   */
  readonly retainedCopy?: ContentId;
}

/**
 * What an external file was known by when it was last seen.
 *
 * Never a path or a file name alone (REQ-STOR-104): enough signals to tell the
 * same unchanged file, a modified one, a moved copy with the same content, and
 * another file in its place. None of it is an absolute path (REQ-PRIV-165).
 */
export interface ExternalSourceIdentity {
  /**
   * An opaque token under which the platform's handle to the file is kept.
   * Never a path; it names an entry in the application's own handle store.
   */
  readonly handleKey?: string;

  /** The file's name, for display only and never for identity. */
  readonly fileName?: string;

  /**
   * Where the file lies inside a directory the user granted, with forward
   * slashes and no `.` or `..` segment.
   */
  readonly relativePath?: string;

  readonly byteLength: number;

  /** When the file was last modified, in milliseconds since the epoch. */
  readonly lastModified: number;

  /** The media type, such as `audio/wav`, without parameters. */
  readonly mediaType: string;

  /**
   * Up to the first 16 bytes of the file in lower-case hexadecimal: the
   * container's magic, which says what kind of file stands there now.
   */
  readonly signature: string;

  /** A quick digest of sampled ranges, 64 hexadecimal digits, from the media store. */
  readonly fastFingerprint: string;

  /** The full content identity, once progressive hashing has finished. */
  readonly contentId?: ContentId;
}

/**
 * What happens when an external source is found to have changed.
 *
 * REQ-STOR-053 forbids silent adoption as the default, so the default is to ask
 * ({@link DEFAULT_SOURCE_CHANGE_POLICY}).
 */
export const SourceChangePolicy = {
  /** Ask the user what to do. */
  Prompt: 'prompt',

  /** Take the new version without asking. */
  Adopt: 'adopt',

  /** Keep playing the retained copy of the version the project was made with. */
  Freeze: 'freeze',
} as const;

/** What happens when an external source is found to have changed. */
export type SourceChangePolicy = (typeof SourceChangePolicy)[keyof typeof SourceChangePolicy];

/** The policy a newly linked source takes. */
export const DEFAULT_SOURCE_CHANGE_POLICY: SourceChangePolicy = SourceChangePolicy.Prompt;

/**
 * How an asset came into a project (REQ-STOR-166).
 *
 * The asset's sample rate, channel layout and length are on the domain asset,
 * and are not repeated here.
 */
export interface AssetProvenance {
  /** The name of the file imported, where provenance keeps it. */
  readonly originalFileName?: string;

  /** When it was imported, in milliseconds since the epoch. */
  readonly importedAt: number;

  /** The content identity of the file imported, where it was computed. */
  readonly sourceContentId?: ContentId;

  /** The fast fingerprint of the file imported, where it was computed. */
  readonly sourceFingerprint?: string;

  readonly byteLength: number;
  readonly mediaType: string;

  /** The project the asset was first imported into. */
  readonly originProjectId: ProjectId;

  /** The source's bits per sample, where its container says. */
  readonly bitDepth?: number;
}

/**
 * The storage key a domain asset carries for its source: `content:` and the
 * content identity for managed media, so assets with the same bytes share one,
 * and `external:` and the asset for external media, whose bytes have no key the
 * store could share.
 */
export function storageKeyOf(assetId: AssetId, media: MediaSource): string {
  return media.kind === 'managed' ? `content:${media.contentId}` : `external:${assetId}`;
}

/**
 * The state of a project that has no assets yet.
 *
 * Throws if the project has any: an asset without a source would break the
 * aggregate's first invariant, and only a command that adds both may add one.
 */
export function emptyProjectState(project: Project): ProjectState {
  if (project.assets.size > 0) {
    throw new Error('An empty project state is made from a project with no assets.');
  }
  return { project, sources: new Map() };
}
