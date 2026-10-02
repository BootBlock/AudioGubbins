/**
 * A linked file of the open project that is no longer what the project
 * recorded, with the file found or chosen in its place, the answers the person
 * can give it, and the project command that freezes it (REQ-STOR-053,
 * REQ-STOR-104).
 *
 * The records the source change store keeps and the prompt draws, apart from
 * the store that finds the files and runs the commands.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { AssetId } from '@audiogubbins/domain';
import type {
  ResolutionKind,
  ResolutionPlan,
  SourceClassification,
} from '@audiogubbins/media-store';
import { ProjectCommandId } from '@audiogubbins/project-commands';
import type { ExternalSourceIdentity } from '@audiogubbins/project-format';
import type { PageFile } from '@audiogubbins/storage-runtime';

/** A linked file that is not what the project recorded, and what can be done. */
export interface SourceChange {
  readonly asset: AssetId;

  /** What the person calls the asset. */
  readonly name: string;
  readonly classification: SourceClassification;
  readonly plan: ResolutionPlan;

  /** The file found in the recorded place, for taking its new version. */
  readonly found?: FoundFile;

  /** A file the person chose to link instead that is not the one recorded, until they decide. */
  readonly offered?: OfferedFile;
}

/** A file found or chosen, as examined, and the file itself to take. */
export interface FoundFile {
  readonly identity: ExternalSourceIdentity;
  readonly file: PageFile;
}

/** A file chosen to link that differs from the one recorded, and how. */
export interface OfferedFile extends FoundFile {
  /** How it differs: in content, or in kind. */
  readonly difference: 'modified' | 'replaced';
}

/** What giving leave to read a linked file came to. */
export type GivenAccess =
  /** The file is what the project recorded, so nothing waits. */
  | { readonly kind: 'as-recorded' }
  /** The file is not, and waits for the person's answer. */
  | { readonly kind: 'changed'; readonly change: SourceChange }
  /** The file is not, and the asset's own policy answered it. */
  | { readonly kind: 'applied'; readonly resolution: ResolutionKind }
  /** The browser did not ask, or the person refused. */
  | { readonly kind: 'not-given'; readonly refused: boolean };

/** What answering a change came to. */
export type Resolution =
  { readonly kind: 'taken' } | { readonly kind: 'offered'; readonly offered: OfferedFile };

/** The linked files that changed, and what the policies did without asking. */
export interface SourceChangeState {
  readonly changes: readonly SourceChange[];

  /** What each asset's policy did on its own, as the person is told it. */
  readonly applied: readonly {
    readonly asset: AssetId;
    readonly name: string;
    readonly kind: ResolutionKind;
  }[];
  readonly checking: boolean;
}

/** Whether a file could not be looked at only because the browser needs the person's leave. */
export function wantsLeave(classification: SourceClassification): boolean {
  return classification.kind === 'missing' && classification.reason === 'access-needed';
}

/** The invocation that keeps an asset on the retained copy of the version it was made with. */
export function freezing(asset: AssetId): CommandInvocation {
  return { commandId: ProjectCommandId.FreezeSource, arguments: { assetId: asset } };
}
