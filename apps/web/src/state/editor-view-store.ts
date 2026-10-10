/**
 * Each editor view's asset and presentation, keyed by the editor panel that
 * shows it, and kept between visits (REQ-EDIT-061).
 *
 * Presentation is the view's own: two views of one asset keep their own zoom,
 * scroll, display mode, tool, channels and overlays, while the asset, its
 * content, its selection and its playhead are shared (the project's assets in
 * `project-assets.ts`, `selection-store.ts`, `cue-store.ts`). A view's state is
 * a value from the editor-view package; it changes through the view commands,
 * and the one change the page makes itself is the width it measures, which is
 * not an action a person takes.
 *
 * Written to its own key in schema `editorViews`, a moment after a change
 * rather than on every one, so a drag that scrolls sixty times a second is not
 * sixty writes; a write still waiting when the page is hidden, as it is before
 * it closes or reloads, is made then.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { SampleCount } from '@audiogubbins/domain';
import {
  newViewState,
  type EditorViewState,
  type KeyboardDrawing,
} from '@audiogubbins/editor-view';
import { resized, viewportFitting } from '@audiogubbins/timeline';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import type { EditorAsset } from '../assets/editor-asset.js';
import { observable, type Observable } from './observable.js';
import { PersistedPart, type StateStorage } from './state-storage.js';
import { readStoredView, storedViewOf } from './stored-editor-views.js';
import { isRecord, versionFound } from './stored-value.js';

/** The key the views are stored under. */
export const EDITOR_VIEWS_KEY = 'audiogubbins.editor-views';

/** One editor panel's view. */
export interface EditorViewEntry {
  /** The identity of the asset it shows. */
  readonly asset: string;
  readonly state: EditorViewState;
  /** Whether it is to show the whole asset once its width is known, as a new view does. */
  readonly fitting: boolean;
  /**
   * The height its surface is laid out at, in CSS pixels, nothing until it is
   * measured: what its lanes are laid out in, which a shape drawn from the
   * keyboard is read against as a pointer's is.
   */
  readonly height: number;
  /**
   * A spectral shape being drawn from the keyboard, if one is: not kept,
   * since it is a drag in progress and not how the view is presented.
   */
  readonly drawing: KeyboardDrawing | undefined;
}

/** Every editor panel's view. */
export interface EditorViewsState {
  readonly views: ReadonlyMap<string, EditorViewEntry>;
  /**
   * The view a command that names none acts on: the editor last in use. Not
   * kept, since it follows the workspace, whose panel in use is kept; noting
   * it is no change of the person's, so it writes nothing.
   */
  readonly focused: string | undefined;
}

/** Holds the views and writes them back. */
export interface EditorViewStore extends Observable<EditorViewsState> {
  /** Panel `panel`'s view, or `undefined` where it shows no asset. */
  readonly entry: (panel: string) => EditorViewEntry | undefined;
  /** Shows `asset` in panel `panel`, fitted to its width; an asset it shows already is kept as it is. */
  readonly open: (panel: string, asset: EditorAsset) => void;
  /** Replaces panel `panel`'s presentation by `change` of it. */
  readonly change: (panel: string, change: (state: EditorViewState) => EditorViewState) => void;
  /** Takes the size panel `panel`'s surface was measured at, for an asset of `length` frames. */
  readonly measured: (
    panel: string,
    size: { readonly width: number; readonly height: number },
    length: SampleCount,
  ) => void;
  /**
   * Replaces panel `panel`'s keyboard drawing by `change` of it, which writes
   * nothing, since a drawing is not kept.
   */
  readonly draw: (
    panel: string,
    change: (drawing: KeyboardDrawing | undefined) => KeyboardDrawing | undefined,
  ) => void;
  /** Makes panel `panel` the view commands act on. */
  readonly focus: (panel: string) => void;
  /** Forgets the view of every editor panel not among `open`. */
  readonly forgetClosed: (open: readonly string[]) => void;
  /** Makes a write still waiting now, as the page is hidden. */
  readonly flush: () => void;
}

const EMPTY: EditorViewsState = { views: new Map(), focused: undefined };

function readViews(stored: string | null, logger: Logger): EditorViewsState {
  if (stored === null) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    logger.warning('The stored editor views could not be read, so each view starts afresh.');
    return EMPTY;
  }
  if (!isRecord(parsed)) return EMPTY;
  if (parsed['schemaVersion'] !== SCHEMA_VERSIONS.editorViews) {
    logger.info('The stored editor views were written for another version and were not used.', {
      found: versionFound(parsed['schemaVersion']),
      expected: SCHEMA_VERSIONS.editorViews,
    });
    return EMPTY;
  }
  const views = new Map<string, EditorViewEntry>();
  const storedViews = parsed['views'];
  if (isRecord(storedViews)) {
    for (const [panel, value] of Object.entries(storedViews)) {
      const view = readStoredView(value);
      if (view !== undefined) {
        views.set(panel, { ...view, fitting: false, height: 0, drawing: undefined });
      }
    }
  }
  return { views, focused: undefined };
}

function serialised(state: EditorViewsState): string {
  const views: Record<string, unknown> = {};
  for (const [panel, entry] of state.views) views[panel] = storedViewOf(entry);
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.editorViews,
    views,
  });
}

/** `entry` at `width` for an asset of `length`, fitted where it waits to be; or itself. */
function measuredEntry(
  entry: EditorViewEntry,
  width: number,
  length: SampleCount,
): EditorViewEntry {
  const viewport = entry.fitting
    ? viewportFitting(length, width)
    : resized(entry.state.viewport, width, length);
  if (viewport === entry.state.viewport && !entry.fitting) return entry;
  return { ...entry, state: { ...entry.state, viewport }, fitting: false };
}

/** `entry` laid out at `height`; or itself. */
function heightened(entry: EditorViewEntry, height: number): EditorViewEntry {
  return height === entry.height ? entry : { ...entry, height };
}

/** `state` without the views of panels not among `open`; or itself where it holds none. */
function withoutClosed(state: EditorViewsState, open: readonly string[]): EditorViewsState {
  const kept = new Set(open);
  if ([...state.views.keys()].every((panel) => kept.has(panel))) return state;
  return {
    views: new Map([...state.views].filter(([panel]) => kept.has(panel))),
    focused: state.focused !== undefined && kept.has(state.focused) ? state.focused : undefined,
  };
}

/** A new view of `asset`, to be fitted to its width once that is measured. */
function opened(asset: EditorAsset): EditorViewEntry {
  return {
    asset: asset.id,
    state: newViewState(asset.length, 0),
    fitting: true,
    height: 0,
    drawing: undefined,
  };
}

/**
 * `write`, run by `later` once for however many asks come before it runs, and
 * at once when flushed with one waiting.
 */
function coalescedWrite(
  later: (write: () => void) => void,
  write: () => void,
): { readonly ask: () => void; readonly flush: () => void } {
  let waiting = false;
  const run = (): void => {
    if (!waiting) return;
    waiting = false;
    write();
  };
  return {
    ask: () => {
      if (waiting) return;
      waiting = true;
      later(run);
    },
    flush: run,
  };
}

/**
 * Makes the store, reading whatever was stored. `later` runs a write a moment
 * after the change that asked for it; the writes it is given are coalesced.
 */
export function createEditorViewStore(
  storage: StateStorage,
  logger: Logger,
  later: (write: () => void) => void,
): EditorViewStore {
  const state = observable(readViews(storage.read(EDITOR_VIEWS_KEY), logger));
  const write = coalescedWrite(later, () => {
    storage.save(PersistedPart.EditorViews, { [EDITOR_VIEWS_KEY]: serialised(state.get()) });
  });

  const adopt = (next: EditorViewsState): void => {
    if (next === state.get()) return;
    state.set(next);
    write.ask();
  };

  const withEntry = (panel: string, entry: EditorViewEntry): EditorViewsState => {
    const views = new Map(state.get().views);
    views.set(panel, entry);
    return { ...state.get(), views };
  };

  return {
    get: state.get,
    subscribe: state.subscribe,
    entry: (panel) => state.get().views.get(panel),

    open: (panel, asset) => {
      if (state.get().views.get(panel)?.asset !== asset.id) adopt(withEntry(panel, opened(asset)));
    },

    change: (panel, change) => {
      const entry = state.get().views.get(panel);
      if (entry === undefined) return;
      const next = change(entry.state);
      if (next !== entry.state) adopt(withEntry(panel, { ...entry, state: next }));
    },

    measured: (panel, { width, height }, length) => {
      const entry = state.get().views.get(panel);
      // A panel behind another tab is laid out at no width, and keeps the one it had.
      if (entry === undefined || !(width > 0)) return;
      const presented = measuredEntry(entry, width, length);
      const next = heightened(presented, height);
      if (presented !== entry) adopt(withEntry(panel, next));
      // The height alone is a measurement, and no part of how the view is
      // presented, so it writes nothing.
      else if (next !== entry) state.set(withEntry(panel, next));
    },

    draw: (panel, change) => {
      const entry = state.get().views.get(panel);
      if (entry === undefined) return;
      const drawing = change(entry.drawing);
      if (drawing !== entry.drawing) state.set(withEntry(panel, { ...entry, drawing }));
    },

    focus: (panel) => {
      if (state.get().focused !== panel) state.set({ ...state.get(), focused: panel });
    },

    forgetClosed: (open) => {
      adopt(withoutClosed(state.get(), open));
    },

    flush: write.flush,
  };
}
