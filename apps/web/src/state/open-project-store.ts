/**
 * The project open in this window, as the interface reads it, and the moves
 * between the ways it can be open: opening and closing it, taking it over or
 * asking for it, and reading it again once this window no longer writes it
 * (REQ-STOR-021, REQ-STOR-098, REQ-STOR-101).
 *
 * One project is open at a time, to write where this window holds its lease and
 * to read otherwise, and the store republishes whatever the open project
 * publishes, so the interface reads one snapshot. The project itself is held in
 * the storage worker, and the session or view here stands for it. Every change
 * to the project runs through the session the store holds, which is the typed
 * command layer's route into it; the store only opens, closes and swaps. An
 * opening is given up once another opening or a close replaces it, and the work
 * done for a project once it is let go (`abandoning.ts`). What recovery found
 * on opening stays until the person dismisses it, where it found anything. A
 * window that handed the project over reads it at once, so it keeps seeing the
 * work; one that lost it keeps saying so, and who took it, until the person
 * reopens it. Its members are properties, so each can be handed on unbound.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import type {
  ProjectRecoveryReport,
  ProjectSnapshot,
  TransferOutcome,
} from '@audiogubbins/storage';
import type {
  RemoteOpenedProject,
  RemoteProjectSession,
  RemoteReadOnlyProject,
} from '@audiogubbins/storage-runtime';

import type { ProjectServices } from '../storage/project-services.js';
import { Requests, abandonment, isAbandoned, within } from './abandoning.js';
import { followHandover } from './handover.js';
import { observable, type Observable } from './observable.js';
import type { ProjectPreferencesStore } from './project-preferences-store.js';

/** Where the open project stands. */
export type OpenProjectState =
  | { readonly kind: 'none' }
  | { readonly kind: 'opening'; readonly project: ProjectId }
  | {
      readonly kind: 'open';
      readonly snapshot: ProjectSnapshot;

      /** What recovery found on opening, where it found anything, until dismissed. */
      readonly report?: ProjectRecoveryReport;

      /** Whether this window is waiting for an answer to its request for the project. */
      readonly asking?: boolean;
    };

/** How a project is opened. */
export interface OpeningChoice {
  readonly access?: 'write' | 'read';

  /** Take it from the window writing it: only after the person decided to. */
  readonly steal?: boolean;
}

/** How long a request for a project waits for the window writing it to answer. */
const REQUEST_PATIENCE_MILLISECONDS = 30_000;

/** Why there is no project to ask for. */
const NOTHING_TO_ASK_FOR = failure(
  'project.not-read-only',
  FailureKind.Conflict,
  'No project is open to read here, so there is nothing to ask another tab for.',
);

/** Whether recovery found anything the person should hear of. */
function isNotable(report: ProjectRecoveryReport): boolean {
  return (
    report.fallbacks.length > 0 ||
    report.journalBreak !== undefined ||
    report.fenced.length > 0 ||
    report.rebuiltCursorState !== undefined ||
    report.missingStates.length > 0
  );
}

/** A project open to write or to read. */
type Opened =
  | { readonly kind: 'writable'; readonly session: RemoteProjectSession }
  | { readonly kind: 'read-only'; readonly view: RemoteReadOnlyProject };

/** A project opened, how to stop hearing of it, and the work done for it. */
interface Held {
  readonly opened: Opened;
  readonly stop: () => void;
  readonly scope: AbortController;
  readonly unfollow: () => void;
}

/** What the project publishes, whichever way it is open. */
function publisherOf(opened: Opened): RemoteProjectSession | RemoteReadOnlyProject {
  return opened.kind === 'writable' ? opened.session : opened.view;
}

/** Whether a session was closed in the worker, as a restore in place closes it. */
function isClosed(opened: Opened): boolean {
  return opened.kind === 'writable' && opened.session.getSnapshot().access.kind === 'closed';
}

/** The project open in this window (see the module comment). */
export class OpenProjectStore implements Observable<OpenProjectState> {
  private readonly services: ProjectServices;
  private readonly preferences: ProjectPreferencesStore;
  private readonly lifetime: AbortSignal;
  private readonly openings: Requests;
  private readonly state = observable<OpenProjectState>({ kind: 'none' });
  private held: Held | undefined;

  /** The release under way, which a second asking for one waits for rather than repeats. */
  private releasing: Promise<DomainResult<void>> | undefined;

  /** Stops watching for the tab a project was handed over to, while this tab waits for it. */
  private following: (() => void) | undefined;

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  /** The store, whose work for any project ends once `lifetime` aborts. */
  constructor(
    services: ProjectServices,
    preferences: ProjectPreferencesStore,
    lifetime: AbortSignal,
  ) {
    this.services = services;
    this.preferences = preferences;
    this.lifetime = lifetime;
    this.openings = new Requests(() => lifetime);
  }

  /**
   * Opens a project, closing the one open first, and answers how it opened.
   * Given up, and rejecting as abandoned, once another opening or a close
   * replaces it.
   */
  readonly open = async (
    project: ProjectId,
    choice: OpeningChoice = {},
  ): Promise<DomainResult<RemoteOpenedProject['kind']>> => {
    const signal = this.openings.next();
    const released = await this.release();
    if (!released.ok) return released;
    signal.throwIfAborted();
    this.state.set({ kind: 'opening', project });
    const opened = await this.services.client.projects.open({
      project,
      access: choice.access ?? 'write',
      steal: choice.steal ?? false,
      signal,
    });
    if (signal.aborted) {
      // Answered as it was replaced: nothing will hold it, so it is let go.
      if (opened.ok) await this.closeOpened(opened.value);
      signal.throwIfAborted();
    }
    if (!opened.ok) {
      this.state.set({ kind: 'none' });
      return opened;
    }
    this.hold(opened.value, opened.value.report);
    return succeed(opened.value.kind);
  };

  /** Closes the open project, refused while its changes are not saved. */
  readonly close = async (): Promise<DomainResult<void>> => {
    this.openings.next();
    const released = await this.release();
    if (released.ok) {
      this.state.set({ kind: 'none' });
      this.preferences.remember(undefined);
    }
    return released;
  };

  /**
   * The session of the project open to write, where one is and this window
   * still writes it: a session that lost the project, or handed it over, can
   * change nothing more.
   */
  readonly session = (): RemoteProjectSession | undefined => {
    const opened = this.held?.opened;
    if (opened?.kind !== 'writable') return undefined;
    return opened.session.getSnapshot().access.kind === 'writable' ? opened.session : undefined;
  };

  /** The project open to read, where one is. */
  readonly view = (): RemoteReadOnlyProject | undefined =>
    this.held?.opened.kind === 'read-only' ? this.held.opened.view : undefined;

  /**
   * The signal of the work done for the project open now, which aborts once it
   * is let go, and once the store's own work ends.
   */
  readonly scope = (): AbortSignal => this.held?.scope.signal ?? this.lifetime;

  /**
   * Takes a session opened elsewhere, as restoring a backup in place opens one,
   * in place of a session the restore closed, or of none.
   */
  readonly adopt = (session: RemoteProjectSession): void => {
    const held = this.held;
    // A second session held beside the first would keep its lease with nothing
    // to let it go.
    if (held !== undefined && !isClosed(held.opened)) {
      throw new Error('A session is adopted only once the project open before it is closed.');
    }
    if (held !== undefined) this.letGo(held);
    this.hold({ kind: 'writable', session });
  };

  /** Asks the window writing the project for it, and opens it to write once granted. */
  readonly requestControl = async (): Promise<DomainResult<TransferOutcome>> => {
    const view = this.view();
    const current = this.state.get();
    if (view === undefined || current.kind !== 'open') return fail(NOTHING_TO_ASK_FOR);
    this.state.set({ ...current, asking: true });
    const asked = await view.requestTransfer(AbortSignal.timeout(REQUEST_PATIENCE_MILLISECONDS));
    const after = this.state.get();
    if (after.kind === 'open') this.state.set({ ...after, asking: false });
    if (!asked.ok || asked.value !== 'granted') return asked;
    const opened = await this.open(view.project, { access: 'write' });
    return opened.ok ? asked : opened;
  };

  /** Puts away what recovery found. */
  readonly dismissReport = (): void => {
    const current = this.state.get();
    if (current.kind !== 'open') return;
    const { report: _dismissed, ...rest } = current;
    this.state.set(rest);
  };

  /** Writes a checkpoint of a project open to write, as the page is hidden. */
  readonly checkpoint = async (): Promise<void> => {
    const session = this.session();
    if (session === undefined) return;
    const written = await session.checkpoint();
    if (!written.ok) {
      this.services.logger.warning('A checkpoint as the page was hidden was not written.', {
        code: written.failures[0].code,
      });
    }
  };

  /** Stops watching a project open to read, as the application is taken down. */
  readonly dispose = (): void => {
    this.following?.();
    this.view()?.close().catch(this.logFault('A project open to read could not be closed.'));
    this.held?.stop();
  };

  /** Hears of the project, publishes it, and remembers it as the one to open next time. */
  private hold(opened: Opened, report?: ProjectRecoveryReport): void {
    const publisher = publisherOf(opened);
    const stop = publisher.subscribe(() => {
      this.republish(publisher.getSnapshot());
    });
    const scope = new AbortController();
    this.held = { opened, stop, scope, unfollow: within(scope, this.lifetime) };
    this.state.set({
      kind: 'open',
      snapshot: publisher.getSnapshot(),
      ...(report !== undefined && isNotable(report) ? { report } : {}),
    });
    this.preferences.remember(publisher.project);
  }

  /** Republishes what the project publishes, keeping what the store adds. */
  private republish(snapshot: ProjectSnapshot): void {
    const current = this.state.get();
    this.state.set(current.kind === 'open' ? { ...current, snapshot } : { kind: 'open', snapshot });
    if (snapshot.access.kind === 'handed-over' && this.following === undefined) {
      this.following = followHandover(
        this.services.client.ownership,
        snapshot.project,
        () => {
          this.following = undefined;
          this.reopenToRead(snapshot.project);
        },
        this.services.logger,
      );
    }
  }

  /**
   * Opens a project handed over again once the tab it went to holds it, which
   * finds it held, and reads it naming that tab; until then, the banner says it
   * was handed over and offers to read it.
   */
  private reopenToRead(project: ProjectId): void {
    this.open(project).then((opened) => {
      if (!opened.ok) {
        this.services.logger.warning('A project handed over could not be opened to read.', {
          code: opened.failures[0].code,
        });
      }
    }, this.logFault('A project handed over could not be opened to read.'));
  }

  /** Logs a fault of work no command waits for, and says nothing of work given up. */
  private logFault(what: string): (error: unknown) => void {
    return (error) => {
      if (isAbandoned(error)) return;
      this.services.logger.error(what, {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    };
  }

  /** Closes a project opened for an opening given up as it was answered. */
  private async closeOpened(opened: RemoteOpenedProject): Promise<void> {
    if (opened.kind === 'read-only') await opened.view.close();
    else await opened.session.close();
  }

  /** Stops hearing of a held project and gives up the work done for it. */
  private letGo(held: Held): void {
    held.stop();
    held.unfollow();
    held.scope.abort(abandonment('The project the work was for was let go.'));
    this.held = undefined;
  }

  /** Lets the held project go, refused while a session's changes are not saved. */
  private release(): Promise<DomainResult<void>> {
    this.releasing ??= this.releaseHeld().finally(() => {
      this.releasing = undefined;
    });
    return this.releasing;
  }

  private async releaseHeld(): Promise<DomainResult<void>> {
    this.following?.();
    this.following = undefined;
    const held = this.held;
    if (held === undefined) return succeed(undefined);
    const { opened } = held;
    if (opened.kind === 'read-only') await opened.view.close();
    else if (!isClosed(opened)) {
      const closed = await opened.session.close();
      if (!closed.ok) return closed;
    }
    this.letGo(held);
    return succeed(undefined);
  }
}
