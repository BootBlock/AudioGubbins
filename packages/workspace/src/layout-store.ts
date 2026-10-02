/**
 * The layouts a user has, and the operations on them.
 *
 * REQ-UX-058 requires built-in presets, custom layouts, saving, duplicating,
 * renaming, resetting a built-in one, deleting a user-created one, and
 * switching quickly between them. It also requires that switching layout never
 * alters authoritative project state, which holds here because this module
 * cannot reach project state: the package does not depend on the domain.
 *
 * The store holds layouts already read: a stored one is read, and replaced
 * where it cannot be used, by `layout-reading.ts`.
 */

import { namesCanBeCompared } from '@audiogubbins/text';

import { addTo, givenName, heldLayouts, namesIn, putBack } from './held-layouts.js';
import { NAMING_REFUSED, nameOfACopy, nameOfANewWorkspace } from './workspace-name.js';

import type { WorkspaceArrangement, WorkspaceLayout } from './panel.js';

/**
 * The refusal for deleting a workspace AudioGubbins ships, and what follows it.
 *
 * Written once, for the store's own refusal, which advises a reset, and for
 * the shell's, which says so differently where there is nothing to reset to:
 * the two share the rule, and so the wording of it.
 */
export const BUILT_IN_IS_NOT_DELETABLE = 'A built-in workspace cannot be deleted.';

/** The refusal for a workspace identifier nothing is saved under. */
export function noWorkspaceWith(id: string): string {
  return `There is no workspace with the identifier "${id}".`;
}

/**
 * Why the store would not keep an arrangement under an identifier.
 *
 * The kind as well as the sentence, because one refusal is an answer a caller
 * expects: a built-in layout rearranged stays on screen and is never saved
 * into the collection, while an identifier the store does not hold is a
 * mistake of the caller's.
 */
export interface SavingProblem {
  /**
   * `built-in` for a layout AudioGubbins ships; `refused` for an identifier it
   * does not hold.
   */
  readonly kind: 'built-in' | 'refused';

  /** British-English explanation. */
  readonly text: string;
}

/**
 * A removal the store would make: the layout it removes, and the act.
 *
 * Answered by the check that found the layout, so a caller that asks first and
 * then acts finds the layout once. Made at once: the act removes what the store
 * holds under the identifier when it is called, and answers the layout the
 * check found, so it throws where the store no longer holds that layout under
 * the identifier.
 */
export interface LayoutRemoval {
  /** The layout removed. */
  readonly layout: WorkspaceLayout;

  /**
   * Removes `layout` from the store, and answers it. Throws where another
   * operation of the store has changed or removed it since the check.
   */
  readonly make: () => WorkspaceLayout;
}

/**
 * Holds the layouts a user has.
 *
 * It allocates the identifier of every layout it adds, and never adds one under
 * an identifier a caller gives, so nothing written lands on another layout, a
 * built-in one included: a layout it puts back had its identifier from it. A
 * name it gives or is given for a layout is held to the rule for a name and to
 * the names the others have, compared as a reader hears them, so no two
 * workspaces it names are one in a list or a live region. Only saving as,
 * duplicating and renaming take a name, and each is refused in words where this
 * runtime cannot compare names (see `namesCanBeCompared`), while every other
 * operation, and the reading of stored layouts, goes on.
 */
export interface LayoutStore {
  /** Every layout, built-in first. */
  all(): readonly WorkspaceLayout[];

  /** The layout with this identifier, or `undefined`. */
  get(id: string): WorkspaceLayout | undefined;

  /**
   * Keeps a new arrangement of the user layout under `id`, which keeps the
   * name it has: an arrangement carries no name, so none reaches the list but
   * by the three operations that hold one to the names in use.
   *
   * Returns why it was refused, or `undefined` if it was kept: a built-in
   * layout, which a user who has rearranged it saves as their own, so the
   * preset stays available to go back to (REQ-UX-058); and an identifier it
   * does not hold, since a new layout is added by {@link saveAs}.
   *
   * A name given to any of the three is held without the space typed around
   * it; a stored name is held as it is stored.
   */
  save(id: string, arrangement: WorkspaceArrangement): SavingProblem | undefined;

  /**
   * Adds an arrangement as a user layout, under the name given or, with none,
   * the first free of "My workspace", "My workspace 2" and on.
   *
   * Returns the layout added, or why it was refused: a name the store would
   * refuse to read back, or one another layout has.
   */
  saveAs(layout: WorkspaceLayout, displayName?: string): WorkspaceLayout | string;

  /**
   * Copies a layout, under the name given or, with none, the first free of
   * "<name> copy", "<name> copy 2" and on, a copy of a copy numbered in the
   * series of the name it is a copy of.
   *
   * Returns the copy, or why it was refused: there is no layout with `id`, or
   * the name is one the store would refuse to read back or another layout has.
   */
  duplicate(id: string, displayName?: string): WorkspaceLayout | string;

  /**
   * Renames a user layout: the layout as it was and as it is now, or why it
   * was refused.
   *
   * A name another layout has is refused. The name the layout has already is
   * no change, and `after` is `before`; one that differs from it only as a
   * reader cannot hear, in case or in space, is taken as a correction of it.
   */
  rename(
    id: string,
    displayName: string,
  ): { readonly before: WorkspaceLayout; readonly after: WorkspaceLayout } | string;

  /**
   * The layout renaming would act on, or why it would be refused.
   *
   * Asked apart from the operation so a menu entry reads the answer the
   * operation gives, and a menu and the store cannot give a reader two
   * sentences for one rule. The operation reads the same answer, so it finds
   * the layout once.
   */
  renamable(id: string): WorkspaceLayout | string;

  /**
   * The removal of a user layout the store would make, or why it would be
   * refused. Removing a layout is making the removal this answers.
   *
   * Asked apart from the act for the reason {@link renamable} is. The answer
   * holds the act, so a caller that asks first makes it rather than asking the
   * store again, and the layout is found once.
   */
  removable(id: string): LayoutRemoval | string;

  /**
   * Puts back a layout a removal of this store's made, the inverse of the
   * removal, and answers it as it is held now: under the identifier and the
   * name it had, each where no other layout has taken it since, and otherwise
   * under a free one, as `putBack` gives.
   *
   * Throws for a layout no removal of this store's made, or one put back
   * already: a caller holds each removed layout once, and put back twice, one
   * workspace would be listed twice.
   */
  restore(removed: WorkspaceLayout): WorkspaceLayout;

  /**
   * The built-in layout under `id` as it ships, which a reset returns it to, or
   * why a reset would be refused.
   *
   * There is nothing for the store to make: it holds a built-in layout only as
   * it ships, since one is never saved over, renamed or removed, and a stored
   * layout under its identifier is held under another. What returns to how it
   * ships is the layout on screen, where the caller mounts the answer.
   *
   * Only meaningful for a built-in one: a user layout has no shipped state to
   * return to, and deleting it is the operation for that.
   */
  resettable(id: string): WorkspaceLayout | string;
}

/**
 * The removal of `layout`, which `layouts` holds under `id`, noting the layout
 * in `removed` once it is made, so only a layout it removed is put back.
 */
function removalOf(
  layouts: Map<string, WorkspaceLayout>,
  removed: WeakSet<WorkspaceLayout>,
  id: string,
  layout: WorkspaceLayout,
): LayoutRemoval {
  return {
    layout,
    make: () => {
      if (layouts.get(id) !== layout) {
        throw new Error(
          `The removal of the workspace under "${id}" was made after the store changed it.`,
        );
      }
      layouts.delete(id);
      removed.add(layout);
      return layout;
    },
  };
}

/** Creates a store holding the built-in presets and any user layouts. */
export function createLayoutStore(
  builtIn: readonly WorkspaceLayout[],
  userLayouts: readonly WorkspaceLayout[] = [],
): LayoutStore {
  const shipped = new Map(builtIn.map((layout) => [layout.id, layout]));
  const layouts = heldLayouts(builtIn, userLayouts);
  const removed = new WeakSet<WorkspaceLayout>();

  const userLayout = (id: string, refusal: string): WorkspaceLayout | string => {
    const existing = layouts.get(id);
    if (existing === undefined) return noWorkspaceWith(id);
    return existing.builtIn ? refusal : existing;
  };

  const renamable = (id: string): WorkspaceLayout | string =>
    userLayout(id, 'A built-in workspace keeps its name.');

  const removable = (id: string): LayoutRemoval | string => {
    const layout = userLayout(id, `${BUILT_IN_IS_NOT_DELETABLE} Reset it instead.`);
    return typeof layout === 'string' ? layout : removalOf(layouts, removed, id, layout);
  };

  const resettable = (id: string): WorkspaceLayout | string => {
    const original = shipped.get(id);
    if (original !== undefined) return original;

    // Named by what the user calls it. The identifier is internal, and a
    // refusal that quoted it would name a workspace by something the user has
    // never seen it called.
    const existing = layouts.get(id);
    return existing === undefined
      ? noWorkspaceWith(id)
      : `"${existing.displayName}" is not a built-in workspace, so there is nothing to reset it to. Delete it instead.`;
  };

  return {
    all: () =>
      [...layouts.values()].sort((left, right) => Number(right.builtIn) - Number(left.builtIn)),

    get: (id) => layouts.get(id),

    save(id, arrangement) {
      const existing = layouts.get(id);
      if (existing === undefined) return { kind: 'refused', text: noWorkspaceWith(id) };
      if (existing.builtIn) {
        return {
          kind: 'built-in',
          text: 'A built-in workspace cannot be changed. Save it as a new workspace instead.',
        };
      }

      const { schemaVersion, displayName } = existing;
      const { groups, activePanelId } = arrangement;
      const active = activePanelId === undefined ? {} : { activePanelId };
      layouts.set(id, { schemaVersion, id, displayName, builtIn: false, groups, ...active });
      return undefined;
    },

    saveAs(layout, displayName) {
      if (!namesCanBeCompared()) return NAMING_REFUSED;
      return addTo(layouts, layout, displayName ?? nameOfANewWorkspace(namesIn(layouts).taken));
    },

    duplicate(id, displayName) {
      const source = layouts.get(id);
      if (source === undefined) return noWorkspaceWith(id);
      if (!namesCanBeCompared()) return NAMING_REFUSED;
      return addTo(
        layouts,
        source,
        displayName ?? nameOfACopy(source.displayName, namesIn(layouts).taken),
      );
    },

    renamable,
    removable,
    resettable,

    restore(layout) {
      if (!removed.has(layout)) {
        throw new Error('A workspace was put back that no removal of this store made.');
      }
      removed.delete(layout);
      return putBack(layouts, layout);
    },

    rename(id, displayName) {
      const before = renamable(id);
      if (typeof before === 'string') return before;
      if (!namesCanBeCompared()) return NAMING_REFUSED;
      const given = givenName(layouts, displayName, id);
      if ('refusal' in given) return given.refusal;
      if (given.name === before.displayName) return { before, after: before };

      const after = { ...before, displayName: given.name };
      layouts.set(id, after);
      return { before, after };
    },
  };
}
