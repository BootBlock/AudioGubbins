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
 * the policy that asks applies nothing. A file the browser needs the person's
 * leave to read is put to them with the rest, and nothing is done to it until
 * they give that leave from the control they press, when it is looked at again
 * as it would have been at first. Every answer that changes the project is one
 * project command through the session, so undo reverses it. Each file is passed
 * to the storage worker, which reads and hashes it there; a look at the
 * project's files is given up once a newer one replaces it, and all of it once
 * the project is let go.
 */

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
  resolutionsFor,
  type ResolutionKind,
  type SourceObservation,
} from '@audiogubbins/media-store';
import type { ExternalMedia, ExternalSourceIdentity } from '@audiogubbins/project-format';
import type { RemoteProjectSession, SourcesClient } from '@audiogubbins/storage-runtime';

import { absenceOf, type LinkedFilesPort } from '../io/linked-files.js';
import type { TransferFiles } from '../io/transfer-files.js';
import { Requests } from './abandoning.js';
import { observable, type Observable } from './observable.js';
import {
  freezing,
  wantsLeave,
  type FoundFile,
  type GivenAccess,
  type OfferedFile,
  type Resolution,
  type SourceChange,
  type SourceChangeState,
} from './source-changes.js';
import type { OpenProjectStore } from './open-project-store.js';

/** One linked file looked at: as recorded, answered by its policy, or waiting. */
type Settled =
  | { readonly kind: 'as-recorded' }
  | { readonly kind: 'applied'; readonly resolution: ResolutionKind }
  | { readonly kind: 'waiting'; readonly change: SourceChange };

/** A linked asset, by the name the person calls it, and its media as the project records it. */
interface LinkedAsset {
  readonly asset: AssetId;
  readonly name: string;
  readonly media: ExternalMedia;
}

/** Why a change has no answer to take. */
const NO_SUCH_CHANGE = failure(
  'source.no-change',
  FailureKind.Conflict,
  'That file has no change waiting for an answer.',
);

/** Why leave cannot be asked for. */
const NO_LEAVE_WANTED = failure(
  'source.no-leave-wanted',
  FailureKind.Conflict,
  'AudioGubbins does not need your leave to read that file.',
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

/** The linked files of the open project, and the answers to their changes. */
export class SourceChangeStore implements Observable<SourceChangeState> {
  private readonly sources: SourcesClient;
  private readonly project: OpenProjectStore;
  private readonly checks: Requests;

  /** The signal of the latest look at the project's files. */
  private latest: AbortSignal | undefined;
  private readonly files: TransferFiles;
  private readonly linkedFiles: LinkedFilesPort;
  private readonly state = observable<SourceChangeState>({
    changes: [],
    applied: [],
    checking: false,
  });

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(
    sources: SourcesClient,
    project: OpenProjectStore,
    files: TransferFiles,
    linkedFiles: LinkedFilesPort,
  ) {
    this.sources = sources;
    this.project = project;
    this.checks = new Requests(() => project.scope());
    this.files = files;
    this.linkedFiles = linkedFiles;
  }

  /**
   * Looks at every linked file of the project open to write, taking at once
   * what each asset's own policy takes without asking. Given up, rejecting as
   * abandoned, once a newer look replaces it or the project is let go.
   */
  readonly check = async (): Promise<void> => {
    const session = this.project.session();
    if (session === undefined) return;
    const signal = this.checks.next();
    this.latest = signal;
    this.state.set({ changes: [], applied: [], checking: true });
    try {
      this.state.set({ ...(await this.looked(session, signal)), checking: false });
    } catch (error) {
      // Given up with no newer look under way, as when the project is let go:
      // nothing is being looked at, and nothing found is the person's now.
      if (signal.aborted && this.latest === signal) {
        this.state.set({ changes: [], applied: [], checking: false });
      }
      throw error;
    }
  };

  /**
   * Asks the person, in the handler of their gesture, for leave to read a
   * linked file the browser needs it for, and looks at the file again as it
   * would have been at first.
   */
  readonly giveAccess = async (asset: AssetId): Promise<DomainResult<GivenAccess>> => {
    const session = this.project.session();
    const change = this.state.get().changes.find((one) => one.asset === asset);
    if (session === undefined || change === undefined) return fail(NO_SUCH_CHANGE);
    if (!wantsLeave(change.classification)) return fail(NO_LEAVE_WANTED);
    const media = session.getSnapshot().model.state.sources.get(asset)?.media;
    if (media?.kind !== 'external') return fail(NO_SUCH_CHANGE);
    const settled = await this.settle(
      session,
      { asset, name: change.name, media },
      (identity) => this.linkedFiles.ask(identity),
      this.project.scope(),
    );
    switch (settled.kind) {
      case 'as-recorded':
        this.answered(asset);
        return succeed({ kind: 'as-recorded' });
      case 'applied':
        this.answered(asset);
        this.state.update((current) => ({
          ...current,
          applied: [...current.applied, { asset, name: change.name, kind: settled.resolution }],
        }));
        return succeed({ kind: 'applied', resolution: settled.resolution });
      case 'waiting': {
        const { classification } = settled.change;
        this.replaced(settled.change);
        if (classification.kind !== 'missing') {
          return succeed({ kind: 'changed', change: settled.change });
        }
        return succeed(
          classification.reason === 'access-needed' ||
            classification.reason === 'permission-refused'
            ? { kind: 'not-given', refused: classification.reason === 'permission-refused' }
            : { kind: 'changed', change: settled.change },
        );
      }
    }
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
    const linked = await this.linked(session, change, change.offered);
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

  /** What became of each linked file of the project `session` writes. */
  private async looked(
    session: RemoteProjectSession,
    signal: AbortSignal,
  ): Promise<Pick<SourceChangeState, 'changes' | 'applied'>> {
    const projectState = session.getSnapshot().model.state;
    const changes: SourceChange[] = [];
    const applied: SourceChangeState['applied'][number][] = [];
    for (const [asset, { media }] of projectState.sources) {
      if (media.kind !== 'external') continue;
      const name = projectState.project.assets.get(asset)?.displayName ?? 'An asset';
      const settled = await this.settle(
        session,
        { asset, name, media },
        (identity) => this.linkedFiles.look(identity),
        signal,
      );
      if (settled.kind === 'applied') applied.push({ asset, name, kind: settled.resolution });
      else if (settled.kind === 'waiting') changes.push(settled.change);
    }
    return { changes, applied };
  }

  /**
   * Looks at one linked file, found by `reach`, and takes at once what the
   * asset's own policy takes without asking.
   */
  private async settle(
    session: RemoteProjectSession,
    linked: LinkedAsset,
    reach: LinkedFilesPort['look'],
    signal: AbortSignal,
  ): Promise<Settled> {
    const change = await this.changeOf(linked, reach, signal);
    if (change === undefined) return { kind: 'as-recorded' };
    const { automatic } = change.plan;
    if (automatic === undefined) return { kind: 'waiting', change };
    const done = await this.take(session, change, automatic);
    return done.ok ? { kind: 'applied', resolution: automatic } : { kind: 'waiting', change };
  }

  /** What stands where a linked file was recorded, found by `reach`, and the file found. */
  private async observe(
    identity: ExternalSourceIdentity,
    reach: LinkedFilesPort['look'],
    signal: AbortSignal,
  ): Promise<{ readonly observation: SourceObservation; readonly found?: FoundFile }> {
    const access = await reach(identity);
    if (access.kind !== 'available') {
      return { observation: { kind: 'absent', reason: absenceOf(access) } };
    }
    const observed = await this.sources.examine(identity, access.file, signal);
    return observed.ok
      ? {
          observation: { kind: 'present', file: observed.value },
          found: { identity: observed.value, file: access.file },
        }
      : { observation: { kind: 'absent', reason: 'unreadable' } };
  }

  /** What became of one linked file, where it is no longer what was recorded. */
  private async changeOf(
    { asset, name, media }: LinkedAsset,
    reach: LinkedFilesPort['look'],
    signal: AbortSignal,
  ): Promise<SourceChange | undefined> {
    const { observation, found } = await this.observe(media.identity, reach, signal);
    const classification = classifySource(media.identity, observation);
    if (classification.kind === 'unchanged') return undefined;
    return {
      asset,
      name,
      classification,
      plan: resolutionsFor(classification, media),
      ...(found === undefined ? {} : { found }),
    };
  }

  /** Takes a choice that needs no more of the person through the session. */
  private async take(
    session: RemoteProjectSession,
    change: SourceChange,
    kind: ResolutionKind,
  ): Promise<DomainResult<void>> {
    if (kind === 'keep-offline') return succeed(undefined);
    const ran =
      kind === 'freeze'
        ? await session.run(freezing(change.asset))
        : kind === 'adopt' && change.found !== undefined
          ? await this.sources.takeVersion(session, {
              asset: change.asset,
              change: 'adopt',
              ...change.found,
            })
          : fail(cannotTake(kind));
    return ran.ok ? succeed(undefined) : ran;
  }

  /**
   * Asks for another file, in the handler of the person's gesture, and links it
   * where it holds what the project recorded, or offers it where it does not.
   */
  private async relink(
    session: RemoteProjectSession,
    change: SourceChange,
  ): Promise<DomainResult<Resolution>> {
    const chosen = await this.files.chooseMediaFile();
    if (chosen === undefined) return fail(NOTHING_CHOSEN);
    const media = session.getSnapshot().model.state.sources.get(change.asset)?.media;
    if (media?.kind !== 'external') return fail(NO_SUCH_CHANGE);
    const examined = await this.sources.examine(media.identity, chosen, this.project.scope());
    if (!examined.ok) return examined;
    const identity = examined.value;
    const verdict = classifySource(media.identity, { kind: 'present', file: identity });
    if (verdict.kind === 'modified' || verdict.kind === 'replaced') {
      const offered: OfferedFile = { identity, file: chosen, difference: verdict.kind };
      this.state.update((current) => ({
        ...current,
        changes: current.changes.map((one) =>
          one.asset === change.asset ? { ...one, offered } : one,
        ),
      }));
      return succeed({ kind: 'offered', offered });
    }
    const linked = await this.linked(session, change, { identity, file: chosen });
    if (!linked.ok) return linked;
    this.answered(change.asset);
    return succeed({ kind: 'taken' });
  }

  /** Links the asset of `change` to `file`, keeping a protected copy of it where the asset keeps one. */
  private async linked(
    session: RemoteProjectSession,
    change: SourceChange,
    { identity, file }: FoundFile,
  ): Promise<DomainResult<void>> {
    const ran = await this.sources.takeVersion(session, {
      asset: change.asset,
      change: 'relink',
      identity,
      file,
    });
    return ran.ok ? succeed(undefined) : ran;
  }

  /** Puts `change` in the place of the one waiting for its asset. */
  private replaced(change: SourceChange): void {
    this.state.update((current) => ({
      ...current,
      changes: current.changes.map((one) => (one.asset === change.asset ? change : one)),
    }));
  }

  /** Puts away a change the person answered. */
  private answered(asset: AssetId): void {
    this.state.update((current) => ({
      ...current,
      changes: current.changes.filter((one) => one.asset !== asset),
    }));
  }
}
