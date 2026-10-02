/**
 * What every command that changes an asset of the project shares: finding the
 * project asset a view shows, or why it is not one, and running the project
 * commands that change it as one change the history keeps (ADR-0051).
 *
 * A view shows positions on its own timeline: an asset's edited timeline, or a
 * region's slice of it, which starts `offset` frames in. A position kept in the
 * project is anchored to the asset's chain as it stands, so it is the view's
 * position plus that offset, at a basis of the chain's length.
 */

import {
  AVAILABLE,
  unavailable,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  derivedSampleCount,
  isLevelEdit,
  type EditOperation,
  type EditRange,
  type RangeEdit,
  type SampleCount,
} from '@audiogubbins/domain';
import { applyInvocation, applyRegionEditInvocation } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { EditorAsset, ProjectOwner } from '../assets/editor-asset.js';
import { quoted } from '../wording.js';
import { focusedEditor } from './editor-target.js';
import { sayWhenSettled, sessionOf } from './project-access.js';
import type { ShellContext } from './shell-context.js';

/** An asset of the project a view shows, and the session that changes it. */
export interface ProjectTarget {
  readonly session: RemoteProjectSession;
  readonly owner: ProjectOwner;
  /** The project as the page holds it now. */
  readonly state: ProjectState;
}

/** The project asset `asset` is, and the session that changes it, or why it is not one. */
export function projectTarget(context: ShellContext, asset: EditorAsset): ProjectTarget | string {
  if (asset.owner.kind === 'session') return asset.owner.reason;
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  return { session, owner: asset.owner, state: session.getSnapshot().model.state };
}

/**
 * Available where the editor last in use shows an asset of the project open
 * to change here, as a command that names no view acts on it; unavailable,
 * saying why, for audio no project holds.
 */
export function needsProjectAsset(context: ShellContext): CommandAvailability {
  const target = focusedEditor(context);
  if (typeof target === 'string') return unavailable(target);
  const project = projectTarget(context, target.asset);
  return typeof project === 'string' ? unavailable(project) : AVAILABLE;
}

/** Where position `at` of a view lies on its asset's edited timeline. */
export function onAsset(owner: ProjectOwner, at: number): SampleCount {
  return derivedSampleCount(owner.offset + at);
}

/** The basis a position placed now is anchored at: the asset's chain as it stands. */
export function currentBasis(owner: ProjectOwner): number {
  return owner.asset.edits.length;
}

/**
 * Runs `invocations` on the project as one change, which undo reverses whole,
 * and says `said` once it is made, or why it was not.
 */
export function changeProject(
  context: ShellContext,
  session: RemoteProjectSession,
  change: {
    readonly description: string;
    readonly invocations: readonly [CommandInvocation, ...CommandInvocation[]];
    readonly said: string;
  },
): void {
  const [first, ...rest] = change.invocations;
  const work =
    rest.length === 0 ? session.run(first) : session.runGroup(change.description, [first, ...rest]);
  sayWhenSettled(context, work, (outcome) =>
    outcome.kind === 'applied' ? change.said : outcome.reason,
  );
}

/**
 * The invocation that processes `range` of what `owner` shows with `edit`: a
 * region's own processing in a region's view, and the asset's chain anywhere
 * else (ADR-0051). A level edit acts on `channels`, or on every channel where
 * they are absent; a channel edit names its own channels and takes no scope.
 */
export function processInvocation(
  context: ShellContext,
  owner: ProjectOwner,
  change: {
    readonly range: EditRange;
    readonly channels: readonly number[] | undefined;
    readonly edit: RangeEdit;
  },
): CommandInvocation {
  const id = context.ids.next<'EditOperationId'>();
  const { range, edit } = change;
  const channels =
    change.channels === undefined || !isLevelEdit(edit) ? {} : { channels: change.channels };
  if (owner.region !== undefined) {
    return applyRegionEditInvocation(owner.region, {
      id,
      basis: currentBasis(owner),
      range,
      ...channels,
      edit,
    });
  }
  return applyInvocation(owner.asset, { id, kind: 'process', range, ...channels, edit });
}

/** An operation of the asset's chain, with an identity of its own. */
export function chainInvocation(
  context: ShellContext,
  owner: ProjectOwner,
  operation: DistributiveOmit<EditOperation, 'id'>,
): CommandInvocation {
  return applyInvocation(owner.asset, {
    ...operation,
    id: context.ids.next<'EditOperationId'>(),
  });
}

/** `Omit` over each member of a union, so each keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What is said of a change made to the asset from a region's view, which
 * changes time or the layout of the whole asset and so names it (ADR-0051).
 */
export function onWholeAsset(owner: ProjectOwner, said: string): string {
  return owner.region === undefined
    ? said
    : `${said} This changes all of ${quoted(owner.asset.displayName)}, the sound the region is part of.`;
}
