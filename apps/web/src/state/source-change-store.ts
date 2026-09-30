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
 * was, or keep the asset offline. A file chosen to link instead is examined
 * against the recorded identity like the file it stands for: one of the same
 * content is linked at once, and any other is offered, with how it differs, for
 * the person to link anyway or choose again. What the asset's own policy does
 * without asking is done at once and said, and never a silent adoption, since
 * the policy that asks applies nothing. Every answer that changes the project
 * is one project command through the session, so undo reverses it.
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
  examineFile,
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

  /** A file the person chose to link instead that is not the one recorded, until they decide. */
  readonly offered?: OfferedFile;
}

/** A file chosen to link that differs from the one recorded, and how. */
export interface OfferedFile {
  readonly identity: ExternalSourceIdentity;

  /** How it differs: in content, or in kind. */
  readonly difference: 'modified' | 'replaced';
}

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
  readonly resolve = async (
    asset: AssetId,
    kind: ResolutionKind,
  ): Promise<DomainResult<Resolution>> => {
    const session = this.project.session();
    const change = this.state.get().changes.find((one) => one.asset === asset);
    if (session === undefined || change === undefined) return fail(NO_SUCH_CHANGE);
    const choice = change.plan.choices.find((one) => one.kind === kind);
    if (choice?.available !== true) return fail(cannotTake(kind));
    if (kind === 'relink') return await this.relink(session, change);
    const taken = await this.take(session, change, kind);
    if (!taken.ok) return taken;
    this.answered(asset);
    return succeed({ kind: 'taken' });
  };

  /** Links the file offered for a change, which the person chose to link anyway. */
  readonly linkOffered = async (asset: AssetId): Promise<DomainResult<void>> => {
    const session = this.project.session();
    const change = this.state.get().changes.find((one) => one.asset === asset);
    if (session === undefined || change?.offered === undefined) return fail(NO_SUCH_CHANGE);
    const linked = await this.linked(session, change, change.offered.identity);
    if (linked.ok) this.answered(asset);
    return linked;
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
    const observed = await examineFile(identity, access.file, this.services);
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

  /** Takes a choice that needs no more of the person through the session. */
  private async take(
    session: ProjectSession,
    change: SourceChange,
    kind: ResolutionKind,
  ): Promise<DomainResult<void>> {
    if (kind === 'keep-offline') return succeed(undefined);
    const invocation = invocationOf(change, session.getSnapshot().model.state, kind);
    if (invocation === undefined) return fail(cannotTake(kind));
    const ran = await session.run(invocation);
    return ran.ok ? succeed(undefined) : ran;
  }

  /**
   * Asks for another file, in the handler of the person's gesture, and links it
   * where it holds what the project recorded, or offers it where it does not.
   */
  private async relink(
    session: ProjectSession,
    change: SourceChange,
  ): Promise<DomainResult<Resolution>> {
    const chosen = await this.files.chooseMediaFile();
    if (chosen === undefined) return fail(NOTHING_CHOSEN);
    const media = session.getSnapshot().model.state.sources.get(change.asset)?.media;
    if (media?.kind !== 'external') return fail(NO_SUCH_CHANGE);
    const examined = await examineFile(media.identity, chosen, this.services);
    if (!examined.ok) return examined;
    const identity = examined.value;
    const verdict = classifySource(media.identity, { kind: 'present', file: identity });
    if (verdict.kind === 'modified' || verdict.kind === 'replaced') {
      const offered: OfferedFile = { identity, difference: verdict.kind };
      this.state.update((current) => ({
        ...current,
        changes: current.changes.map((one) =>
          one.asset === change.asset ? { ...one, offered } : one,
        ),
      }));
      return succeed({ kind: 'offered', offered });
    }
    const linked = await this.linked(session, change, identity);
    if (!linked.ok) return linked;
    this.answered(change.asset);
    return succeed({ kind: 'taken' });
  }

  private async linked(
    session: ProjectSession,
    change: SourceChange,
    identity: ExternalSourceIdentity,
  ): Promise<DomainResult<void>> {
    const asset = session.getSnapshot().model.state.project.assets.get(change.asset);
    if (asset === undefined) return fail(NO_SUCH_CHANGE);
    const ran = await session.run(relinkSourceInvocation(asset, identity));
    return ran.ok ? succeed(undefined) : ran;
  }

  /** Puts away a change the person answered. */
  private answered(asset: AssetId): void {
    this.state.update((current) => ({
      ...current,
      changes: current.changes.filter((one) => one.asset !== asset),
    }));
  }
}
