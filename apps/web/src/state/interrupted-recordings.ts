/**
 * The recordings a crash, a reload, a lost device or full storage cut short in
 * the project open here, each offered to be recovered or discarded before
 * anything else is done with them (`ADR-0071`, `REQ-REC-096`).
 *
 * The project's recovery report lists them as it opens, and the storage worker
 * is asked again whenever this tab comes to write the project, as after taking
 * it over, and whenever a take could not be finished here. Recovering one makes
 * it the asset and take it was for, saying it ended unexpectedly; discarding
 * one removes it for good, and so is asked twice: the person is shown what goes
 * before it goes. Nothing else removes one.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { RecordingSessionId } from '@audiogubbins/project-format';
import type { FinishedRecording, InterruptedRecording, TakeRequest } from '@audiogubbins/storage';
import type { RecordingClient, RemoteProjectSession } from '@audiogubbins/storage-runtime';

import { isAbandoned } from './abandoning.js';
import { observable, type Observable } from './observable.js';
import type { OpenProjectStore } from './open-project-store.js';

/** The recordings offered, and the one whose discarding waits for the person's word. */
export interface InterruptedOffers {
  readonly recordings: readonly InterruptedRecording[];
  readonly confirming: RecordingSessionId | undefined;
  /** The recordings being recovered or discarded now. */
  readonly busy: ReadonlySet<RecordingSessionId>;
}

const NONE: InterruptedOffers = { recordings: [], confirming: undefined, busy: new Set() };

function notOffered(): DomainResult<never> {
  return fail(
    failure(
      'recording.not-offered',
      FailureKind.Rejected,
      'That recording is not one of those offered for recovery.',
    ),
  );
}

/** The interrupted recordings of the project open here (see the module comment). */
export class InterruptedRecordings implements Observable<InterruptedOffers> {
  readonly #client: RecordingClient;
  readonly #project: OpenProjectStore;
  readonly #logger: Logger;
  readonly #offers = observable<InterruptedOffers>(NONE);
  #opened: ProjectId | undefined;
  #session: RemoteProjectSession | undefined;

  constructor(client: RecordingClient, project: OpenProjectStore, logger: Logger) {
    this.#client = client;
    this.#project = project;
    this.#logger = logger;
    project.subscribe(this.#projectChanged);
  }

  readonly get = (): InterruptedOffers => this.#offers.get();
  readonly subscribe = (listener: () => void): (() => void) => this.#offers.subscribe(listener);

  /** The offered recording `session`, where it is offered. */
  offered(session: RecordingSessionId): InterruptedRecording | undefined {
    return this.#offers.get().recordings.find((one) => one.session === session);
  }

  /** Asks the storage worker again which recordings the project open to write holds cut short. */
  refresh(): void {
    const session = this.#project.session();
    if (session === undefined) return;
    this.#client.interrupted(session, this.#project.scope()).then((listed) => {
      if (this.#session !== session) return;
      if (!listed.ok) {
        this.#logger.warning('The interrupted recordings could not be listed.', {
          reason: listed.failures[0].summary,
        });
        return;
      }
      this.#offers.update((offers) => ({ ...offers, recordings: listed.value }));
    }, this.#fault('The interrupted recordings could not be listed.'));
  }

  /** Makes interrupted recording `session` the asset and take it was for, as `take` names it. */
  async recover(
    session: RecordingSessionId,
    take: TakeRequest,
  ): Promise<DomainResult<FinishedRecording>> {
    const project = this.#project.session();
    if (project === undefined || this.offered(session) === undefined) return notOffered();
    return await this.#settling(session, () =>
      this.#client.recover(project, session, take, this.#project.scope()),
    );
  }

  /** Asks the person's word before discarding `session`. */
  askDiscard(session: RecordingSessionId): DomainResult<InterruptedRecording> {
    const offered = this.offered(session);
    if (offered === undefined) return notOffered();
    this.#offers.update((offers) => ({ ...offers, confirming: session }));
    return succeed(offered);
  }

  /** Keeps the recording whose discarding was asked about. */
  keep(): void {
    this.#offers.update((offers) => ({ ...offers, confirming: undefined }));
  }

  /** Discards `session` for good, which the person was asked about and confirmed. */
  async discard(session: RecordingSessionId): Promise<DomainResult<void>> {
    const project = this.#project.session();
    if (project === undefined || this.#offers.get().confirming !== session) {
      return fail(
        failure(
          'recording.discard-unconfirmed',
          FailureKind.Rejected,
          'Ask to discard the recording first, so you can see what goes.',
        ),
      );
    }
    return await this.#settling(session, () =>
      this.#client.discard(project, session, this.#project.scope()),
    );
  }

  /** Runs `work` on offered `session`, which is no longer offered once it succeeds. */
  async #settling<T>(
    session: RecordingSessionId,
    work: () => Promise<DomainResult<T>>,
  ): Promise<DomainResult<T>> {
    this.#offers.update((offers) => ({ ...offers, busy: new Set([...offers.busy, session]) }));
    let done: DomainResult<T> | undefined;
    try {
      done = await work();
      return done;
    } finally {
      const succeeded = done?.ok === true;
      this.#offers.update((offers) => ({
        recordings: succeeded
          ? offers.recordings.filter((one) => one.session !== session)
          : offers.recordings,
        confirming: offers.confirming === session ? undefined : offers.confirming,
        busy: new Set([...offers.busy].filter((one) => one !== session)),
      }));
    }
  }

  /**
   * Offers what the opening of a project found, and asks the worker again
   * whenever this tab comes to write a session of it.
   */
  readonly #projectChanged = (): void => {
    const open = this.#project.get();
    if (open.kind !== 'open') {
      this.#opened = undefined;
      this.#session = undefined;
      this.#offers.set(NONE);
      return;
    }
    if (open.snapshot.project !== this.#opened) {
      this.#opened = open.snapshot.project;
      this.#offers.set({ ...NONE, recordings: open.report?.interruptedRecordings ?? [] });
    }
    const session = this.#project.session();
    if (session === this.#session) return;
    this.#session = session;
    this.refresh();
  };

  #fault(what: string): (error: unknown) => void {
    return (error) => {
      if (isAbandoned(error)) return;
      this.#logger.error(what, { reason: error instanceof Error ? error.message : 'unknown' });
    };
  }
}
