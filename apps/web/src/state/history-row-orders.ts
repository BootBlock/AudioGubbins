/**
 * The order the History panel lists the open project's history in, carried
 * from each history to the next as the project changes (REQ-STOR-196).
 *
 * Ordering a history visits every point of it, which a history of tens of
 * thousands of points makes too slow to do as the panel opens or at each
 * change. The order is carried on here as each change is published, whether
 * the panel is open or not, so the panel reads one already made and pays only
 * for the rows it shows.
 */

import { historyRowOrder, type History, type HistoryRowOrder } from '@audiogubbins/history';

import type { Observable } from './observable.js';
import type { OpenProjectState } from './open-project-store.js';

/** The order of the open project's history (see the module comment). */
export class HistoryRowOrders {
  private latest: HistoryRowOrder | undefined;

  /** Orders the history of whatever `project` has open, now and as it changes. */
  constructor(project: Observable<OpenProjectState>) {
    const follow = (): void => {
      const open = project.get();
      if (open.kind === 'open') this.orderOf(open.snapshot.model.history);
      else this.latest = undefined;
    };
    project.subscribe(follow);
    follow();
  }

  /** The order of `history`, carried on from the last one asked for. */
  readonly orderOf = (history: History): HistoryRowOrder => {
    const order = historyRowOrder(history, this.latest);
    this.latest = order;
    return order;
  };
}
