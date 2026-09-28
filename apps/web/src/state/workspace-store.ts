/**
 * The workspace partition: which layout is in use, and where the panels are.
 *
 * Separate from preferences (REQ-ARCH-153) because the lifetimes differ. A
 * preference is a choice a user made once; a layout changes every time they
 * drag a panel, so it is written far more often and a failure to write it
 * matters less. Sharing one storage key would mean a dropped layout write
 * losing an accent colour as well.
 *
 * REQ-UX-058 requires switching layout never to alter project state. Nothing
 * here can: the store holds layouts and a selected identifier, and the package
 * graph gives it no route to the domain.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import {
  DEFAULT_PRESET_ID,
  buildPresets,
  createLayoutStore,
  BUILT_IN_IS_NOT_DELETABLE,
  noWorkspaceWith,
  placedLayouts,
  type DockRegion,
  type LayoutRemoval,
  type LayoutStore,
  closureProblem,
  movingProblem,
  openingProblem,
  nudgingProblem,
  reorderingProblem,
  resizingProblem,
  sameArrangement,
  withGroupNudged,
  withGroupResized,
  withPanelReordered,
  withPanel,
  withPanelMoved,
  withoutPanel,
  type PanelDescriptor,
  type PanelId,
  type PanelKind,
  type WorkspaceLayout,
} from '@audiogubbins/workspace';

import { observable, type Observable } from './observable.js';
import {
  noNoticeAbout,
  recoveriesNow,
  startingRecoveries,
  type RecoveryPart,
  type WorkspaceRecovery,
} from './recovery-notices.js';
import { PersistedPart, type StateStorage } from './state-storage.js';
import { readMountedLayout } from './stored-layout.js';
import { readCollection } from './workspace-collection.js';
import { takeCustody } from './workspace-custody.js';

/** What the workspace store holds. */
export interface WorkspaceState {
  /** The layout currently mounted. */
  readonly layout: WorkspaceLayout;

  /** Every layout the user can switch to. */
  readonly available: readonly WorkspaceLayout[];

  /**
   * What could not be read, one entry per thing, so the shell can say so.
   *
   * Each is cleared once the user has dismissed it. Silently replacing a
   * workspace someone arranged would teach them the application forgets things
   * (REQ-UX-059).
   *
   * A list rather than one sentence: the mounted layout and the collection of
   * saved workspaces are recovered separately and can fail together, and the
   * one write that damages one damages both. As one string, the layout's
   * message would win, and the user would never be told that every workspace
   * they made is unreadable.
   */
  readonly recoveries: readonly WorkspaceRecovery[];

  /**
   * Whether text nobody has read waits for room to be set aside, so that some
   * of the workspace is written nowhere until it is. Apart from the notices,
   * because it holds after the user has dismissed them.
   */
  readonly waitsForRoom: boolean;

  /**
   * Bumped only by a change the docking engine did not itself report.
   *
   * The dock builds its arrangement once, when it mounts, so a layout changed
   * from outside it needs it to mount again. Keying it on this number does that
   * for a switch, a reset or a closed panel, and leaves a drag alone: the
   * engine reports a drag *to* the store, and remounting on that report would
   * undo the drag the user just made.
   */
  readonly revision: number;
}

/** Holds the workspace and writes it back. */
export interface WorkspaceStore extends Observable<WorkspaceState> {
  /**
   * Why switching to a layout would be refused, or `undefined` when it would
   * not.
   *
   * Asked separately so that a menu entry can say why it cannot be chosen
   * before the user chooses it, without the menu re-deciding the rule. The
   * command and the menu both read this one answer.
   */
  readonly switchProblem: (id: string) => string | undefined;

  /**
   * Switches to a layout by identifier. Reports the reason it refused, the
   * same reason `switchProblem` gives.
   */
  readonly switchTo: (id: string) => string | undefined;

  /** The layout after the current one, for switching without naming a target. */
  readonly nextLayoutId: () => string | undefined;

  /** Records that the user rearranged the current layout. */
  readonly rearranged: (layout: WorkspaceLayout) => void;

  /**
   * Mounts the dock again from the layout in use, changing nothing stored,
   * for a drag the store refused (see `dock-rearrangement.ts`).
   */
  readonly remount: () => void;

  /**
   * Saves the current arrangement as a new workspace, under the name given or
   * one the layout store gives it, and mounts it: the workspace made, or why it
   * was refused.
   */
  readonly saveAs: (displayName?: string) => WorkspaceLayout | string;

  /** Why renaming, deleting or resetting a layout would be refused, or `undefined`. */
  readonly renamingProblem: (id: string) => string | undefined;
  readonly removalProblem: (id: string) => string | undefined;
  readonly resetProblem: (id: string) => string | undefined;

  /**
   * Renames a user layout: the layout as it was and as it is now, or why it
   * was refused. For the name it has already, `after` is `before`, and
   * nothing is written.
   */
  readonly rename: (id: string, displayName: string) => ReturnType<LayoutStore['rename']>;

  /**
   * Copies a layout, so a built-in one can be used as a starting point, under
   * the name given or one the layout store gives it, and mounts the copy: the
   * copy, or why it was refused.
   */
  readonly duplicate: (id: string, displayName?: string) => WorkspaceLayout | string;

  /** Deletes a user layout: the layout deleted, or why it was refused. */
  readonly remove: (id: string) => WorkspaceLayout | string;

  /**
   * Returns a built-in layout to how it ships: the layout as it ships, or why
   * it was refused.
   */
  readonly resetBuiltIn: (id: string) => WorkspaceLayout | string;

  /**
   * Why closing a panel would be refused, or `undefined` when it would not.
   *
   * On the store, beside the others, so the close command reads the one answer
   * rather than re-deriving the rule and repeating its sentence.
   */
  readonly closureProblem: (id: PanelId) => string | undefined;

  /** Closes a panel. Reports the reason it refused. */
  readonly closePanel: (id: PanelId) => string | undefined;

  /**
   * Why opening a panel of a kind would do nothing, or `undefined` when it
   * would do something.
   *
   * Asked separately so a menu entry and a command's availability read one
   * answer instead of each deciding the rule. A panel open behind another tab
   * is not a refusal: showing it is a real change.
   */
  readonly openingProblem: (kind: PanelKind) => string | undefined;

  /** Opens a panel of a kind, or brings the open one forward. */
  readonly openPanel: (kind: PanelKind) => string | undefined;

  /**
   * Why moving a panel into a region would be refused, or `undefined`.
   *
   * Asked apart from the move, so a menu entry for moving a panel is offered
   * only where the move would be made, and says why before the user chooses,
   * as every other entry does.
   */
  readonly movingProblem: (id: PanelId, region: DockRegion) => string | undefined;

  /** Moves a panel into a region. Reports the reason it refused. */
  readonly movePanel: (id: PanelId, region: DockRegion) => string | undefined;

  /** Why growing or shrinking a panel's group would be refused, or `undefined`. */
  readonly resizingProblem: (id: PanelId, steps: number) => string | undefined;

  /** Grows or shrinks the group a panel is in. Reports the reason it refused. */
  readonly resizeGroup: (id: PanelId, steps: number) => string | undefined;

  /** Why a floating panel cannot be nudged, or `undefined` when it can. */
  readonly nudgingProblem: (id: PanelId, x: number, y: number) => string | undefined;

  /** Nudges the floating group holding a panel, and says why it could not. */
  readonly nudgeGroup: (id: PanelId, x: number, y: number) => string | undefined;

  /** Why a panel cannot be moved along its group's tabs, or `undefined` when it can. */
  readonly reorderingProblem: (id: PanelId, places: number) => string | undefined;

  /** Moves a panel along its group's tabs, and says why it could not. */
  readonly reorderPanel: (id: PanelId, places: number) => string | undefined;

  /**
   * Clears one recovery notice once the user has seen it. Reports the reason it
   * refused: a notice that is not showing cannot be dismissed, and saying it
   * was would report a change that did not happen.
   */
  readonly acknowledgeRecovery: (part: RecoveryPart) => string | undefined;
}

/** The layout as it ships that a reset would mount, or why it would be refused. */
type ResetOrRefusal = WorkspaceLayout | string;

/** The removal the layout store would make, or why it would be refused. */
type RemovalOrRefusal = LayoutRemoval | string;

/**
 * The refusal in an answer that is a layout or its removal, or why there is
 * none, or `undefined`.
 */
function refusalIn(answer: WorkspaceLayout | RemovalOrRefusal): string | undefined {
  return typeof answer === 'string' ? answer : undefined;
}

/**
 * Whether the built-in layout with identifier `id` is as `shipped`, the layout
 * as it ships: the layout store keeps it as it ships, so only the mounted
 * layout, the arrangement of the one in use, can differ from it.
 */
function asItShips(mounted: WorkspaceLayout, id: string, shipped: WorkspaceLayout): boolean {
  return mounted.id !== id || sameArrangement(mounted, shipped);
}

/**
 * The layout as it ships that a reset of a layout mounts, or why the reset
 * would be refused.
 *
 * A layout already as it ships has nothing to put back, and a reset would say
 * it put back what it did not.
 */
function resetOf(store: LayoutStore, mounted: WorkspaceLayout, id: string): ResetOrRefusal {
  const shipped = store.resettable(id);
  if (typeof shipped === 'string' || !asItShips(mounted, id, shipped)) return shipped;
  return `"${shipped.displayName}" is already as it ships.`;
}

/**
 * The removal of a layout the layout store would make, or why it would be
 * refused: the store's own rule, worded for a built-in workspace with nothing
 * to reset either.
 */
function removalAsked(store: LayoutStore, mounted: WorkspaceLayout, id: string): RemovalOrRefusal {
  const removal = store.removable(id);
  if (typeof removal !== 'string') return removal;

  // A built-in workspace already as it ships has nothing to reset either, so
  // it is not told to reset instead, beside a Reset it cannot use. Only a
  // built-in one has a layout as it ships to reset to.
  const shipped = store.resettable(id);
  return typeof shipped !== 'string' && asItShips(mounted, id, shipped)
    ? `${BUILT_IN_IS_NOT_DELETABLE} This one is already as it ships.`
    : removal;
}

/**
 * Keeps a changed layout in the collection, and answers whether it was: the
 * store keeps a built-in layout as it ships and says so, and the change is
 * still mounted and stored so a reload returns the user to it.
 *
 * Any other refusal is a mistake of this module's, thrown rather than kept
 * quiet, and no stored text can bring it about: the layout is the one on
 * screen, which {@link placedLayouts} places under an identifier the store
 * holds, whatever the text claims, and each operation after it mounts a layout
 * the store holds.
 */
export function keptInCollection(store: LayoutStore, layout: WorkspaceLayout): boolean {
  const refusal = store.save(layout.id, layout);
  if (refusal === undefined) return true;
  if (refusal.kind === 'built-in') return false;
  throw new Error(`The workspace on screen was refused by the store holding it: ${refusal.text}`);
}

/** Creates the workspace store. */
export function createWorkspaceStore(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  storage: StateStorage,
  logger: Logger,
): WorkspaceStore {
  const presets = buildPresets(new Set(descriptors.keys()));
  const fallback = presets.find((one) => one.id === DEFAULT_PRESET_ID) ?? presets[0];
  if (fallback === undefined) {
    // No preset could be built, which means no panel kind was registered. That
    // is a wiring mistake in the composition root rather than anything a user
    // did, and an application with no workspace at all cannot be shown.
    throw new Error('No workspace preset could be built: no panel kinds were registered.');
  }

  const collection = readCollection(storage, descriptors, logger);
  const resolved = readMountedLayout(storage, fallback, descriptors, logger);
  const custody = takeCustody(storage, collection, resolved, logger);
  // Placed by the layout store's own rule, so the workspace on screen is
  // saved under the identifier the store holds it under.
  const placed = placedLayouts(presets, collection.layouts, resolved.layout);
  const store: LayoutStore = createLayoutStore(presets, placed.layouts);

  const state = observable<WorkspaceState>({
    layout: placed.onScreen,
    available: store.all(),
    revision: 0,
    recoveries: startingRecoveries(custody.notice('layout'), custody.notice('collection')),
    waitsForRoom: custody.waitsForRoom(),
  });

  /**
   * Writes the mounted layout and the collection, and brings each notice still
   * showing, and whether text waits for room, up to date with where the text
   * is now.
   *
   * Every key in one call: the mounted layout and the collection are one part
   * to the user, and reporting them separately would let a failed write of the
   * first be cleared by a successful write of the second.
   */
  const persist = (layout: WorkspaceLayout): void => {
    const write = custody.write(
      JSON.stringify(layout),
      JSON.stringify(store.all().filter((one) => !one.builtIn)),
    );
    custody.written(storage.save(PersistedPart.Workspace, write.entries, write.account));

    const current = state.get();
    const recoveries = recoveriesNow(current.recoveries, custody.notice);
    const waitsForRoom = custody.waitsForRoom();
    if (recoveries !== current.recoveries || waitsForRoom !== current.waitsForRoom) {
      state.set({ ...current, recoveries, waitsForRoom });
    }
  };

  const resetProblem = (id: string): string | undefined =>
    refusalIn(resetOf(store, state.get().layout, id));
  const removalProblem = (id: string): string | undefined =>
    refusalIn(removalAsked(store, state.get().layout, id));

  /** The layout to switch to, or why switching to it would be refused. */
  const switchable = (id: string): WorkspaceLayout | string => {
    const layout = store.get(id);
    if (layout === undefined) return noWorkspaceWith(id);
    return layout.id === state.get().layout.id
      ? `"${layout.displayName}" is already in use.`
      : layout;
  };

  /**
   * Rebuilds the state from the layout store, keeping any notice.
   *
   * `remount` says whether the docking engine needs to build the arrangement
   * again. It does for a change made anywhere but inside it.
   */
  const refresh = (layout: WorkspaceLayout, remount: boolean): void => {
    const current = state.get();
    state.set({
      layout,
      available: store.all(),
      revision: remount ? current.revision + 1 : current.revision,
      recoveries: current.recoveries,
      waitsForRoom: current.waitsForRoom,
    });
    persist(layout);
  };

  /**
   * Puts a changed layout in use, and mounts the dock again to show it: kept in
   * the collection unless it is built in, and mounted and stored either way.
   */
  const commit = (next: WorkspaceLayout): void => {
    keptInCollection(store, next);
    refresh(next, true);
  };

  /**
   * What a panel of this kind would be opened with, or why it cannot be: a kind
   * this build has no panel for, or a refusal from the layout.
   *
   * One home for both answers, so the sentence for an unknown kind is written
   * once for the question and the command that asks it, and two wordings of
   * one rule cannot drift apart.
   */
  const opening = (kind: PanelKind): PanelDescriptor | string => {
    const descriptor = descriptors.get(kind);
    if (descriptor === undefined) return `AudioGubbins has no "${kind}" panel.`;
    return openingProblem(state.get().layout, descriptor) ?? descriptor;
  };

  return {
    get: state.get,
    subscribe: state.subscribe,

    switchProblem: (id) => refusalIn(switchable(id)),

    switchTo: (id) => {
      const layout = switchable(id);
      if (typeof layout === 'string') return layout;

      refresh(layout, true);
      return undefined;
    },

    renamingProblem: (id) => refusalIn(store.renamable(id)),
    removalProblem,
    resetProblem,

    nextLayoutId: () => {
      // Wrapping round rather than stopping at the end, because "switch
      // rapidly" (REQ-UX-058) means pressing one shortcut repeatedly to find
      // the arrangement you want, not pressing it and then reaching for a menu.
      const all = store.all();
      const here = all.findIndex((one) => one.id === state.get().layout.id);
      return all.length <= 1 ? undefined : all[(here + 1) % all.length]?.id;
    },

    rearranged: (layout) => {
      if (keptInCollection(store, layout)) {
        refresh(layout, false);
        return;
      }

      // A built-in layout is never changed in place: the user keeps the preset
      // to go back to, and their arrangement survives only if they save it
      // (REQ-UX-058). The arrangement is still mounted, and still stored, so
      // reloading returns them to where they were working.
      state.set({ ...state.get(), layout });
      persist(layout);
    },

    remount: () => {
      const current = state.get();
      state.set({ ...current, revision: current.revision + 1 });
    },

    saveAs: (displayName) => {
      const saved = store.saveAs(state.get().layout, displayName);
      if (typeof saved !== 'string') refresh(saved, false);
      return saved;
    },

    rename: (id, displayName) => {
      const renamed = store.rename(id, displayName);
      // The name it has already is no change, so nothing is written and
      // nothing on screen changes.
      if (typeof renamed === 'string' || renamed.after === renamed.before) return renamed;

      const current = state.get();
      refresh(current.layout.id === id ? renamed.after : current.layout, false);
      return renamed;
    },

    duplicate: (id, displayName) => {
      const copy = store.duplicate(id, displayName);
      if (typeof copy !== 'string') refresh(copy, true);
      return copy;
    },

    remove: (id) => {
      const removal = removalAsked(store, state.get().layout, id);
      if (typeof removal === 'string') return removal;
      const removed = removal.make();

      // Deleting the mounted layout would leave the user looking at a workspace
      // that no longer exists, so they are moved to the default preset.
      const current = state.get();
      refresh(current.layout.id === id ? fallback : current.layout, current.layout.id === id);
      return removed;
    },

    resetBuiltIn: (id) => {
      const shipped = resetOf(store, state.get().layout, id);
      if (typeof shipped === 'string') return shipped;

      const current = state.get();
      refresh(current.layout.id === id ? shipped : current.layout, current.layout.id === id);
      return shipped;
    },

    closureProblem: (id) => closureProblem(state.get().layout, id),

    closePanel: (id) => {
      const current = state.get();

      // The reason comes from the layout, not from comparing objects. Compared,
      // "no such panel" would be indistinguishable from "the only panel left",
      // and the first would be reported as success.
      const refusal = closureProblem(current.layout, id);
      if (refusal !== undefined) return refusal;

      const next = withoutPanel(current.layout, id);

      commit(next);
      return undefined;
    },

    openingProblem: (kind) => {
      const found = opening(kind);
      return typeof found === 'string' ? found : undefined;
    },

    openPanel: (kind) => {
      const found = opening(kind);
      if (typeof found === 'string') return found;

      commit(withPanel(state.get().layout, found));
      return undefined;
    },

    movingProblem: (id, region) => movingProblem(state.get().layout, id, region),

    movePanel: (id, region) => {
      const current = state.get();
      const next = withPanelMoved(current.layout, id, region);
      if (typeof next === 'string') return next;

      commit(next);
      return undefined;
    },

    resizingProblem: (id, steps) => resizingProblem(state.get().layout, id, steps),

    resizeGroup: (id, steps) => {
      const current = state.get();
      const next = withGroupResized(current.layout, id, steps);
      if (typeof next === 'string') return next;

      commit(next);
      return undefined;
    },

    nudgingProblem: (id, x, y) => nudgingProblem(state.get().layout, id, x, y),

    nudgeGroup: (id, x, y) => {
      const next = withGroupNudged(state.get().layout, id, x, y);
      if (typeof next === 'string') return next;

      commit(next);
      return undefined;
    },

    reorderingProblem: (id, places) => reorderingProblem(state.get().layout, id, places),

    reorderPanel: (id, places) => {
      const next = withPanelReordered(state.get().layout, id, places);
      if (typeof next === 'string') return next;

      commit(next);
      return undefined;
    },

    acknowledgeRecovery: (part) => {
      const current = state.get();
      const remaining = current.recoveries.filter((one) => one.part !== part);
      if (remaining.length === current.recoveries.length) {
        return noNoticeAbout(part);
      }

      // Dismissing destroys nothing: the damaged text is set aside, or held in
      // place and set aside by the first write that finds room for it, and
      // while it waits for room the status bar still says so.
      state.set({
        layout: current.layout,
        available: current.available,
        revision: current.revision,
        recoveries: remaining,
        waitsForRoom: current.waitsForRoom,
      });
      return undefined;
    },
  };
}
