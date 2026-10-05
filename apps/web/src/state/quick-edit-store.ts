/**
 * The Quick Edit the shell holds (REQ-EDIT-008, ADR-0053): the project a file
 * chosen for Quick Edit was made into, and the asset it was imported as.
 *
 * Quick Edit is a facade over the project model, so this names a project and
 * an asset and holds nothing else: every edit is the project command Project
 * Mode runs, kept in that project's history, and the project is found again
 * in the Projects dialogue as any other is. It lasts while that project is
 * open here, and is forgotten once another is opened or it is closed.
 */

import type { AssetId, ProjectId } from '@audiogubbins/domain';

import { observable, type Observable } from './observable.js';
import type { OpenProjectState } from './open-project-store.js';

/** A Quick Edit: the project a chosen file was made into, and its asset. */
export interface QuickEditSession {
  readonly project: ProjectId;
  readonly asset: AssetId;
  /** The name of the file chosen, as the person knows it. */
  readonly fileName: string;
}

/** The Quick Edit in progress, while its project is open. */
export class QuickEditStore implements Observable<QuickEditSession | undefined> {
  private readonly state = observable<QuickEditSession | undefined>(undefined);

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  /** Follows `project`, forgetting the Quick Edit once its project is no longer open. */
  constructor(project: Observable<OpenProjectState>) {
    project.subscribe(() => {
      const held = this.state.get();
      if (held === undefined) return;
      const open = project.get();
      if (open.kind === 'open' && open.snapshot.project === held.project) return;
      this.state.set(undefined);
    });
  }

  /** Holds `session`, whose project is open here now. */
  readonly hold = (session: QuickEditSession): void => {
    this.state.set(session);
  };
}
