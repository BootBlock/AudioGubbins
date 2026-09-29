/**
 * What became of the files the open project links to, and the person's answer
 * where one is no longer what the project recorded (REQ-STOR-053,
 * REQ-STOR-104).
 *
 * Each linked file is found again by the handle AudioGubbins kept for it,
 * observed, and classified by the media store; a file the project still sees as
 * it was is left alone. For one that changed, went or was replaced, the choices
 * are the media store's, in its order: take the new version, link another file,
 * keep the copy retained of the version the project was made with where one
 * was, or keep the asset offline. What the asset's own policy does without
 * asking is done at once and said, and never a silent adoption, since the
 * policy that asks applies nothing. Every answer that changes the project is
 * one project command through the session, so undo reverses it.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type AssetId,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  classifySource,
  observeFile,
  resolutionsFor,
  type ResolutionKind,
  type ResolutionPlan,
  type SourceClassification,
  type SourceObservation,
} from '@audiogubbins/media-store';
import {
  ProjectCommandId,
  adoptSourceVersionInvocation,
  relinkSourceInvocation,
} from '@audiogubbins/project-commands';
import type {
  ExternalMedia,
  ExternalSourceIdentity,
  ProjectState,
} from '@audiogubbins/project-format';
import type { ProjectSession } from '@audiogubbins/storage';

import type { TransferFiles } from '../io/transfer-files.js';
import type { ProjectServices } from '../storage/project-services.js';
import { observable, type Observable } from './observable.js';
import { linkedFileOf } from './linked-files.js';
import type { OpenProjectStore } from './open-project-store.js';

/** A linked file that is not what the project recorded, and what can be done. */
export interface SourceChange {
  readonly asset: AssetId;

  /** What the person calls the asset. */
  readonly name: string;
  readonly classification: SourceClassification;
  readonly plan: ResolutionPlan;

  /** The file found in the recorded place, for taking its new version. */
  readonly found?: ExternalSourceIdentity;
}

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

/** Why a change has no answer to take. */
const NO_SUCH_CHANGE = failure(
  'source.no-change',
  FailureKind.Conflict,
  'That file has no change waiting for an answer.',
);

/** Why a relink changed nothing. */
const NOTHING_CHOSEN = failure(
  'source.nothing-chosen',
  FailureKind.Rejected,
  'No file was chosen, so the asset is linked as it was.',
);

/** Why a choice cannot be taken. */
function cannotTake(kind: ResolutionKind): ReturnType<typeof failure> {
  return failure(
    'source.choice-unavailable',
    FailureKind.Rejected,
    kind === 'freeze'
      ? 'No copy of the version the project was made with was kept, so it cannot be kept playing.'
      : 'That choice cannot be taken for this file.',
  );
}

/** The invocation that takes a choice, where it needs no more of the person. */
function invocationOf(
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

/** The linked files of the open project, and the answers to their changes. */
export class SourceChangeStore implements Observable<SourceChangeState> {
  private readonly services: ProjectServices;
  private readonly project: OpenProjectStore;
  private readonly files: TransferFiles;
  private readonly state = observable<SourceChangeState>({
    changes: [],
    applied: [],
    checking: false,
  });

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(services: ProjectServices, project: OpenProjectStore, files: TransferFiles) {
    this.services = services;
    this.project = project;
    this.files = files;
  }

  /**
   * Looks at every linked file of the project open to write, taking at once
   * what each asset's own policy takes without asking.
   */
  readonly check = async (): Promise<void> => {
    const session = this.project.session();
    if (session === undefined) return;
    this.state.set({ changes: [], applied: [], checking: true });
    const projectState = session.getSnapshot().model.state;
    const changes: SourceChange[] = [];
    const applied: SourceChangeState['applied'][number][] = [];
    for (const [asset, { media }] of projectState.sources) {
      if (media.kind !== 'external') continue;
      const name = projectState.project.assets.get(asset)?.displayName ?? 'An asset';
      const change = await this.changeOf(asset, name, media);
      if (change === undefined) continue;
      const { automatic } = change.plan;
      const done =
        automatic === undefined ? undefined : await this.take(session, change, automatic);
      if (automatic !== undefined && done?.ok === true)
        applied.push({ asset, name, kind: automatic });
      else changes.push(change);
    }
    this.state.set({ changes, applied, checking: false });
  };

  /** Answers one change as the person chose. */
  readonly resolve = async (asset: AssetId, kind: ResolutionKind): Promise<DomainResult<void>> => {
    const session = this.project.session();
    const change = this.state.get().changes.find((one) => one.asset === asset);
    if (session === undefined || change === undefined) return fail(NO_SUCH_CHANGE);
    const choice = change.plan.choices.find((one) => one.kind === kind);
    if (choice?.available !== true) return fail(cannotTake(kind));
    const taken = await this.take(session, change, kind);
    if (taken.ok) {
      this.state.update((current) => ({
        ...current,
        changes: current.changes.filter((one) => one.asset !== asset),
      }));
    }
    return taken;
  };

  /**
   * Leaves every change unanswered, and the assets offline, until the project
   * is opened again, and puts away what the policies did.
   */
  readonly putAside = (): void => {
    this.state.update((current) => ({ ...current, changes: [], applied: [] }));
  };

  /** What stands where a linked file was recorded. */
  private async observe(identity: ExternalSourceIdentity): Promise<SourceObservation> {
    const access = await linkedFileOf(this.services.keeper, identity);
    if (access.kind === 'missing') return { kind: 'absent', reason: 'not-found' };
    if (access.kind !== 'available') return { kind: 'absent', reason: 'permission-refused' };
    const observed = await observeFile(access.file, this.services.digest);
    return observed.ok
      ? { kind: 'present', file: observed.value }
      : { kind: 'absent', reason: 'unreadable' };
  }

  /** What became of one linked file, where it is no longer what was recorded. */
  private async changeOf(
    asset: AssetId,
    name: string,
    media: ExternalMedia,
  ): Promise<SourceChange | undefined> {
    const observation = await this.observe(media.identity);
    const classification = classifySource(media.identity, observation);
    if (classification.kind === 'unchanged') return undefined;
    return {
      asset,
      name,
      classification,
      plan: resolutionsFor(classification, media),
      ...(observation.kind === 'present' ? { found: observation.file } : {}),
    };
  }

  /**
   * Takes a choice through the session. Linking another file asks for it first,
   * in the handler of the person's gesture.
   */
  private async take(
    session: ProjectSession,
    change: SourceChange,
    kind: ResolutionKind,
  ): Promise<DomainResult<void>> {
    if (kind === 'keep-offline') return succeed(undefined);
    const current = session.getSnapshot().model.state;
    let invocation = invocationOf(change, current, kind);
    if (kind === 'relink') {
      const chosen = await this.files.chooseMediaFile();
      const asset = current.project.assets.get(change.asset);
      if (asset === undefined) return fail(NO_SUCH_CHANGE);
      if (chosen === undefined) return fail(NOTHING_CHOSEN);
      const identity = await observeFile(chosen, this.services.digest);
      if (!identity.ok) return identity;
      invocation = relinkSourceInvocation(asset, identity.value);
    }
    if (invocation === undefined) return fail(cannotTake(kind));
    const ran = await session.run(invocation);
    return ran.ok ? succeed(undefined) : ran;
  }
}
