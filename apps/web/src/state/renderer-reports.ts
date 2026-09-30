/**
 * What each editor view's renderer tried and draws with (REQ-AUDIO-152's
 * renderer capability diagnostics), for the Capabilities panel to show beside
 * what the browser offers.
 *
 * Written by the editor surface as its renderer reports, which is a
 * measurement of the browser rather than an action a person takes, and
 * forgotten when the view goes.
 */

import type { RendererReport } from '@audiogubbins/renderer';

import { observable, type Observable } from './observable.js';

/** Each editor panel's renderer report, by panel. */
export type RendererReportsState = ReadonlyMap<string, RendererReport>;

/** The renderers' reports. */
export interface RendererReports extends Observable<RendererReportsState> {
  readonly report: (panel: string, report: RendererReport) => void;
  readonly forget: (panel: string) => void;
}

/** Makes the store, with no report. */
export function createRendererReports(): RendererReports {
  const state = observable<RendererReportsState>(new Map());
  return {
    get: state.get,
    subscribe: state.subscribe,
    report: (panel, report) => {
      if (state.get().get(panel) === report) return;
      state.set(new Map([...state.get(), [panel, report]]));
    },
    forget: (panel) => {
      if (!state.get().has(panel)) return;
      state.set(new Map([...state.get()].filter(([each]) => each !== panel)));
    },
  };
}
