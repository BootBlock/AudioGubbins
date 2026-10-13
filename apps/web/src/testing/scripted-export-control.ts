/**
 * The page's export control as a test of the Export dialog and its commands
 * drives it: each export it is asked to start recorded and answered as the
 * test says, and its run state set by the test, so what the dialog hands the
 * export is read without rendering anything.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { ExportControl, ExportRunState, ExportStart } from '../export/export-types.js';
import { observable } from '../state/observable.js';

/** An export control that records what it is asked to start (see the module comment). */
export class ScriptedExportControl implements ExportControl {
  /** Each export started, in order, with the session it was started in. */
  readonly started: { readonly session: RemoteProjectSession; readonly start: ExportStart }[] = [];

  /** The run state the control shows, which a test sets. */
  readonly run = observable<ExportRunState>({ kind: 'idle' });

  readonly get = this.run.get;
  readonly subscribe = this.run.subscribe;
  readonly #answer: DomainResult<string>;

  constructor(answer: DomainResult<string> = succeed('The export is done.')) {
    this.#answer = answer;
  }

  start(session: RemoteProjectSession, start: ExportStart): Promise<DomainResult<string>> {
    this.started.push({ session, start });
    return Promise.resolve(this.#answer);
  }

  cancel(): boolean {
    return false;
  }

  answerCollision(): boolean {
    return false;
  }

  retry(): Promise<DomainResult<string>> {
    return Promise.resolve(this.#answer);
  }

  deliverElsewhere(): Promise<DomainResult<string>> {
    return Promise.resolve(this.#answer);
  }
}
