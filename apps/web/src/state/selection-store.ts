/**
 * What is selected in each open asset (ADR-0042).
 *
 * A selection is kept per asset and shared by every view of it, so a range
 * made in one view is the range another view of the asset shows and a command
 * run from either acts on (REQ-EDIT-061, REQ-EDIT-064). It lives here and
 * nowhere in a canvas: a view draws it from this store every frame, and a drag
 * in progress is only a preview until the selection command it ends with runs
 * (the packet's rule against selection hidden in canvas objects).
 *
 * It changes through the selection commands, and is reconciled when the
 * asset's content changes, so a selected marker that is removed is removed
 * from the selection and nothing else is disturbed.
 */

import {
  EMPTY_SELECTION,
  reconciled,
  type SelectableContent,
  type SelectionSet,
} from '@audiogubbins/timeline';

import { observable, type Observable } from './observable.js';

/** Each asset's selection that is not empty, by asset identity. */
export type SelectionState = ReadonlyMap<string, SelectionSet>;

/** The selections of the open assets. */
export interface SelectionStore extends Observable<SelectionState> {
  /** The selection in asset `asset`: nothing selected where none was made. */
  readonly of: (asset: string) => SelectionSet;
  /** Replaces the selection in `asset` by `change` of it. */
  readonly change: (asset: string, change: (current: SelectionSet) => SelectionSet) => void;
  /** Makes the selection in `asset` valid for what it now holds. */
  readonly reconcile: (asset: string, content: SelectableContent) => void;
}

/** Makes the store, with nothing selected anywhere. */
export function createSelectionStore(): SelectionStore {
  const state = observable<SelectionState>(new Map());

  const of = (asset: string): SelectionSet => state.get().get(asset) ?? EMPTY_SELECTION;

  const put = (asset: string, next: SelectionSet): void => {
    if (next === of(asset)) return;
    const map = new Map(state.get());
    if (next.recency.length === 0 && next.channels === undefined) map.delete(asset);
    else map.set(asset, next);
    state.set(map);
  };

  return {
    get: state.get,
    subscribe: state.subscribe,
    of,
    change: (asset, change) => {
      put(asset, change(of(asset)));
    },
    reconcile: (asset, content) => {
      put(asset, reconciled(of(asset), content));
    },
  };
}
