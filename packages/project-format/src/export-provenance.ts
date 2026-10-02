/**
 * What an export records about itself.
 *
 * REQ-STOR-197 records each export as a provenance event rather than as an
 * edit, so a user can ask which project state and settings produced a game
 * asset, and REQ-STOR-198 requires what was written, and from which state, to
 * be diagnosable afterwards. An {@link ExportRecord} is that event. It says
 * what happened; it never claims the write can be undone.
 */

import type { Branded } from '@audiogubbins/domain';

import type { ContentId, StateFingerprint } from './content-identity.js';

/** Identifies one export record. */
export type ExportRecordId = Branded<'ExportRecordId'>;

/** How an export ended. */
export const ExportStatus = {
  Succeeded: 'succeeded',
  Failed: 'failed',

  /** Some outputs were written and some were not (REQ-STOR-198). */
  Partial: 'partial',
} as const;

/** How an export ended. */
export type ExportStatus = (typeof ExportStatus)[keyof typeof ExportStatus];

/** What kind of place an export wrote to. */
export const ExportDestinationKind = {
  Download: 'download',
  Directory: 'directory',
  GodotProject: 'godot-project',
  Bundle: 'bundle',
} as const;

/** What kind of place an export wrote to. */
export type ExportDestinationKind =
  (typeof ExportDestinationKind)[keyof typeof ExportDestinationKind];

/** One export, as provenance (REQ-STOR-197). */
export interface ExportRecord {
  readonly id: ExportRecordId;

  /** When the export ran, in milliseconds since the epoch. */
  readonly at: number;

  /** The state exported. */
  readonly stateFingerprint: StateFingerprint;

  /** The history node the state was at, where the export ran from one. */
  readonly historyNodeId?: string;

  /** The recipe followed, and which version of it. */
  readonly recipe?: ExportRecipeReference;

  /** The version of each engine and processor that rendered, by name. */
  readonly engineVersions: ReadonlyMap<string, string>;

  readonly output: ExportOutput;
  readonly destination: ExportDestination;

  /** The identity of the bytes written, where there was one output to hash. */
  readonly outputContentId?: ContentId;

  /** The Godot project written into, where the destination was one. */
  readonly godot?: GodotLinkage;

  readonly status: ExportStatus;

  /** What went wrong, for a failed or partial export, in the order it happened. */
  readonly problems: readonly string[];
}

/** A recipe and its version. */
export interface ExportRecipeReference {
  readonly id: string;
  readonly version: number;
}

/** The format written and its settings, by setting name. */
export interface ExportOutput {
  /** The container written, such as `wav` or `ogg`. */
  readonly container: string;
  readonly settings: ReadonlyMap<string, string | number | boolean>;
}

/**
 * Where an export wrote. `label` is how the user knew the place, never an
 * absolute path (REQ-PRIV-165); stripping provenance removes it.
 */
export interface ExportDestination {
  readonly kind: ExportDestinationKind;
  readonly label?: string;
}

/** The Godot project an export wrote into, and the resources it wrote. */
export interface GodotLinkage {
  readonly projectLabel: string;

  /** Each resource written, as its `res://` path inside the Godot project. */
  readonly resources: readonly string[];
}
