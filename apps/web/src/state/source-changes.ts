/**
 * A linked file of the open project that is no longer what the project
 * recorded, the answers the person can give it, and the project command that
 * takes an answer needing no more of them (REQ-STOR-053, REQ-STOR-104).
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
import { ProjectCommandId, adoptSourceVersionInvocation } from '@audiogubbins/project-commands';
import type { ExternalSourceIdentity, ProjectState } from '@audiogubbins/project-format';

/** A linked file that is not what the project recorded, and what can be done. */
export interface SourceChange {
  readonly asset: AssetId;

  /** What the person calls the asset. */
  readonly name: string;
  readonly classification: SourceClassification;
  readonly plan: ResolutionPlan;

  /** The file found in the recorded place, for taking its new version. */
  readonly found?: ExternalSourceIdentity;

  /** A file the person chose to link instead that is not the one recorded, until they decide. */
  readonly offered?: OfferedFile;
}

/** A file chosen to link that differs from the one recorded, and how. */
export interface OfferedFile {
  readonly identity: ExternalSourceIdentity;

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

/** The invocation that takes a choice, where it needs no more of the person. */
export function invocationOf(
  change: SourceChange,
  projectState: ProjectState,
  kind: ResolutionKind,
): CommandInvocation | undefined {
  const asset = projectState.project.assets.get(change.asset);
  if (asset === undefined) return undefined;
  if (kind === 'freeze') {
    return { commandId: ProjectCommandId.FreezeSource, arguments: { assetId: change.asset } };
  }
  return kind === 'adopt' && change.found !== undefined
    ? adoptSourceVersionInvocation(asset, change.found)
    : undefined;
}
