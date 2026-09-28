/**
 * What a reader chose to see in each log panel.
 *
 * Its own partition, with an owner and a lifetime, as REQ-ARCH-153 and
 * ADR-0011 require of shell state. Nothing here is stored: a filter is what
 * the reader is looking at rather than a fact about their project, so it goes
 * when the tab does.
 *
 * Kept above the dock, because a refused drag and every arrangement command
 * build the dock again and every panel in it with them. Kept inside the panel,
 * a log filtered to its errors would show everything again after each of those.
 *
 * A store rather than a plain `Map` a component makes with `useState` and
 * mutates in an event handler, which is what ADR-0011 rules out. A closed
 * panel's identifier is handed back to the next panel of its kind, so without
 * {@link forgetClosed}, which ends an entry's life with its panel's, a
 * Diagnostics panel closed and opened again would come back showing what the
 * panel the user closed had been filtered to.
 */

import { LogSeverity } from '@audiogubbins/diagnostics';

import { observable, type Observable } from './observable.js';

/** What a reader chose to see in a log panel: the least severity shown, and the part it is from. */
export interface LogView {
  readonly threshold: LogSeverity;
  readonly category: string;
}

/** Every record, from every part of AudioGubbins: what a log panel shows until the reader chooses. */
const EVERYTHING: LogView = { threshold: LogSeverity.Trace, category: 'all' };

/** What each open log panel is filtered to, by the panel's identifier. */
export interface LogViewState {
  readonly byPanel: ReadonlyMap<string, LogView>;
}

/** Holds what a reader chose to see in each log panel. */
export interface LogViewStore extends Observable<LogViewState> {
  /** What a panel is filtered to, which is everything until its reader chooses. */
  readonly viewOf: (panelId: string) => LogView;

  /** Records part of a reader's choice for a panel, keeping the rest. */
  readonly choose: (panelId: string, chosen: Partial<LogView>) => void;

  /**
   * Drops what was chosen for every panel that is no longer open.
   *
   * Driven by the composition root from the workspace, which is what knows a
   * panel has closed. A panel that is only being redrawn is still open, so
   * nothing it chose is lost.
   */
  readonly forgetClosed: (openPanelIds: Iterable<string>) => void;
}

/** Creates the log view store. */
export function createLogViewStore(): LogViewStore {
  const state = observable<LogViewState>({ byPanel: new Map() });

  return {
    get: state.get,
    subscribe: state.subscribe,

    viewOf: (panelId) => state.get().byPanel.get(panelId) ?? EVERYTHING,

    choose: (panelId, chosen) => {
      state.update((current) => {
        const before = current.byPanel.get(panelId) ?? EVERYTHING;
        const next = { ...before, ...chosen };
        if (next.threshold === before.threshold && next.category === before.category) {
          return current;
        }
        return { byPanel: new Map(current.byPanel).set(panelId, next) };
      });
    },

    forgetClosed: (openPanelIds) => {
      const open = new Set(openPanelIds);
      state.update((current) => {
        const kept = [...current.byPanel].filter(([panelId]) => open.has(panelId));
        // The same state when nothing closed, so a redraw of the dock does not
        // notify every reader of a log.
        return kept.length === current.byPanel.size ? current : { byPanel: new Map(kept) };
      });
    },
  };
}
