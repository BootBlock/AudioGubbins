/**
 * What the layout store holds its layouts under: an identifier the text
 * package's rule allocates, within the bound storage holds one to, and for a
 * name given to a layout, one no other layout has, as a reader hears it or as
 * a list of workspaces shows it.
 *
 * Apart from the store's operations, because both rules read every layout
 * held and neither is an operation: the store asks them where a layout is
 * added, copied or renamed, and where stored layouts are first held, and the
 * workspace on screen is placed among the stored ones by the same rule. A
 * stored layout's name is its own, however the others are named.
 */

import {
  type NamesHeld,
  identifierRule,
  namesCanBeCompared,
  namesHeldBy,
} from '@audiogubbins/text';

import type { WorkspaceLayout } from './panel.js';
import { sameLayout } from './same-arrangement.js';
import { listedName, nameBesideTheOthers, workspaceName } from './workspace-name.js';

/** What a workspace's identifier is derived as where its name leaves nothing to derive one from. */
const NO_IDENTIFIER_IN_THE_NAME = 'workspace';

/**
 * The longest identifier, in UTF-8 bytes, storage holds a layout under, which
 * a stored layout's identifier is read within and a new one derived within. No
 * file is named after a layout, so no file name sets it: it is storage's, and
 * a change to it changes which stored layouts are read.
 */
const LONGEST_LAYOUT_IDENTIFIER = 227;

/**
 * The rule a layout's identifier is held to, within
 * {@link LONGEST_LAYOUT_IDENTIFIER} bytes.
 */
export const LAYOUT_IDENTIFIERS = identifierRule(LONGEST_LAYOUT_IDENTIFIER);

/**
 * The layouts held so far, the built-in ones first, and how a stored layout is
 * held among them.
 */
interface StoredHolding {
  readonly layouts: Map<string, WorkspaceLayout>;

  /**
   * `layout` as the user's, held under its own identifier, or under a free one
   * derived from it where a layout held before it holds its own.
   *
   * Its identifier is one `readLayout` accepts, which refuses a stored layout
   * under an identifier out of the shape one is derived in, so a collection
   * holding one is set aside with the rest of what cannot be read: a layout
   * under one reaching here was never read, and is a fault in the caller.
   */
  hold(layout: WorkspaceLayout): WorkspaceLayout;
}

/** The built-in layouts, held, for stored layouts to be held beside. */
function holdingBeside(builtIn: readonly WorkspaceLayout[]): StoredHolding {
  const layouts = new Map(builtIn.map((layout) => [layout.id, layout]));
  const identifiers = LAYOUT_IDENTIFIERS.identifiersHeldBy(builtIn, NO_IDENTIFIER_IN_THE_NAME);
  return {
    layouts,
    hold(layout) {
      const id = identifiers.forStored(layout.id);
      if (id === undefined) {
        throw new Error('A layout was held that was never read: its identifier is out of shape.');
      }
      const held: WorkspaceLayout = { ...layout, id, builtIn: false };
      layouts.set(held.id, held);
      return held;
    },
  };
}

/**
 * The built-in layouts, then each user layout under its own identifier, or
 * under a free one where a layout before it holds its own.
 *
 * Stored layouts come from storage, which anything can write, and one under a
 * built-in layout's identifier would take the preset's place, where it could
 * be neither reset nor deleted. It is kept beside the preset instead, and
 * every stored layout is the user's, whatever it claims.
 */
export function heldLayouts(
  builtIn: readonly WorkspaceLayout[],
  userLayouts: readonly WorkspaceLayout[],
): Map<string, WorkspaceLayout> {
  const holding = holdingBeside(builtIn);
  for (const layout of userLayouts) holding.hold(layout);
  return holding.layouts;
}

/**
 * The stored layouts as a layout store holds them, and the workspace on screen
 * as one of them.
 */
export interface PlacedLayouts {
  /**
   * The stored layouts, each under the identifier the store holds it under,
   * the workspace on screen in the place of the one it is, or after them
   * where none of them is it.
   */
  readonly layouts: readonly WorkspaceLayout[];

  /** The workspace on screen, under the identifier the store holds it under. */
  readonly onScreen: WorkspaceLayout;
}

/**
 * The layouts in `stored` beside `builtIn`, placed as {@link heldLayouts}
 * places them, and `onScreen`, the layout mounted, placed among them, so the
 * store and the workspace on screen hold one layout under each identifier.
 *
 * The layout on screen is built in only where a preset holds its identifier:
 * it is that preset, as it ships or rearranged, under the preset's name. Any
 * other is the user's, whatever it claims, as each stored layout is: a claim
 * under an identifier no preset has would be a layout the store does not hold,
 * and every change to it would be refused.
 *
 * A user layout on screen is the stored layout under its identifier where only
 * one is stored there, and is listed as it is on screen, since the layout's own
 * key is written with each change and is the newer: listed as stored, the older
 * would be written over it at the next write of the collection. Where storage,
 * which anything can write, holds several under it, all but the first are held
 * under free identifiers, and the one on screen is the one it is the same as:
 * identified by the identifier alone, it would be the first, and a
 * rearrangement of it would be saved over another workspace. Where no stored
 * layout is it, it is listed as one of its own: it is saved while its
 * collection cannot be written, the layout's own key kept and the collection's
 * withheld or refused, so it is the newest copy there is, and left out it would
 * come back on screen where it could not be found, renamed or deleted. Its name
 * is held as {@link nameOnScreen} holds it.
 */
export function placedLayouts(
  builtIn: readonly WorkspaceLayout[],
  stored: readonly WorkspaceLayout[],
  onScreen: WorkspaceLayout,
): PlacedLayouts {
  const holding = holdingBeside(builtIn);
  const placed = stored.map((layout) => ({ stored: layout, held: holding.hold(layout) }));
  const all = placed.map((one) => one.held);
  const preset = onScreen.builtIn ? builtIn.find((one) => one.id === onScreen.id) : undefined;
  if (preset !== undefined) {
    return { layouts: all, onScreen: { ...onScreen, displayName: preset.displayName } };
  }

  const sharing = placed.filter((one) => one.stored.id === onScreen.id);
  const itself =
    sharing.length === 1 ? sharing[0] : sharing.find((one) => sameLayout(one.stored, onScreen));
  if (itself === undefined) {
    const own = holding.hold({ ...onScreen, displayName: nameOnScreen(holding.layouts, onScreen) });
    return { layouts: [...all, own], onScreen: own };
  }

  const { id } = itself.held;
  const displayName = nameOnScreen(holding.layouts, onScreen, itself.stored, id);
  const newer: WorkspaceLayout = { ...onScreen, id, displayName, builtIn: false };
  return { layouts: all.map((one) => (one === itself.held ? newer : one)), onScreen: newer };
}

/**
 * The name the workspace on screen is listed under among `layouts`: the one it
 * has where it is the name of `stored`, the stored layout it is placed on,
 * which is that layout's own however the others are named, and otherwise held
 * to the names the others have (see {@link namesIn}) by the rule for a name
 * that reaches the list unheld (see `nameBesideTheOthers`).
 *
 * Held, because the layout's own key is written apart from the collection, and
 * a name given while the collection could not be written reaches the list only
 * through it, after the name was held to a list that may have changed since.
 *
 * Kept as it is where this runtime cannot compare names (see
 * `namesCanBeCompared`): whether another workspace has it cannot be decided,
 * and the workspace on screen is placed all the same, since a start that
 * waited on naming would keep every workspace from the user; it may then be
 * listed beside one of its name, as two stored workspaces of one name are.
 */
function nameOnScreen(
  layouts: ReadonlyMap<string, WorkspaceLayout>,
  onScreen: WorkspaceLayout,
  stored?: WorkspaceLayout,
  self?: string,
): string {
  const { displayName } = onScreen;
  if (displayName === stored?.displayName || !namesCanBeCompared()) return displayName;
  return nameBesideTheOthers(displayName, namesIn(layouts, self).taken);
}

/** A layout under a name a list of workspaces may be read to have. */
interface Listed {
  readonly id: string;
  readonly displayName: string;
  readonly layout: WorkspaceLayout;
}

/**
 * Each layout in `layouts` under the name it has, then each built-in one under
 * the name a list of workspaces shows it by, so a name held both ways is held
 * first by the layout that has it.
 */
function* asListed(layouts: ReadonlyMap<string, WorkspaceLayout>): Generator<Listed> {
  for (const layout of layouts.values()) {
    yield { id: layout.id, displayName: layout.displayName, layout };
  }
  for (const layout of layouts.values()) {
    if (layout.builtIn) yield { id: layout.id, displayName: listedName(layout), layout };
  }
}

/**
 * The names the layouts other than `self` have to a reader, as they are held
 * or as a list of workspaces shows them, and the layout that has each.
 *
 * As a list shows them too, because a built-in layout is listed with its mark,
 * " (built in)": a name typed with the mark would be listed as the preset is,
 * two entries of one name the Workspace menu and the settings could not tell
 * apart. Built once for each name given or numbered, so numbering a name
 * beside thousands of stored ones reads each of them once.
 *
 * Asked only where names can be compared (see `namesCanBeCompared`).
 */
export function namesIn(
  layouts: ReadonlyMap<string, WorkspaceLayout>,
  self?: string,
): NamesHeld<WorkspaceLayout> {
  const names = namesHeldBy(asListed(layouts), self);
  return {
    holderOf: (name) => names.holderOf(name)?.layout,
    taken: names.taken,
  };
}

/** A name given to a layout, as it is held, or why it is refused. */
export type GivenName = { readonly name: string } | { readonly refusal: string };

/**
 * `displayName` as a name given to a layout, without the space around it, or
 * why it is refused: the rule for a name, and a name another layout than
 * `self` has (see {@link namesIn}), which the refusal quotes as the list
 * shows it.
 */
export function givenName(
  layouts: ReadonlyMap<string, WorkspaceLayout>,
  displayName: string,
  self?: string,
): GivenName {
  const name = workspaceName(displayName);
  if (typeof name !== 'string') return { refusal: name.text };

  const holder = namesIn(layouts, self).holderOf(name);
  return holder === undefined
    ? { name }
    : {
        refusal: `There is already a workspace called "${listedName(holder)}". Choose another name.`,
      };
}

/**
 * Adds `layout` as a user layout, named `displayName`, under an identifier no
 * layout holds: the added layout, or why the name is refused.
 */
export function addTo(
  layouts: Map<string, WorkspaceLayout>,
  layout: WorkspaceLayout,
  displayName: string,
): WorkspaceLayout | string {
  const given = givenName(layouts, displayName);
  if ('refusal' in given) return given.refusal;

  const id = LAYOUT_IDENTIFIERS.identifiersHeldBy(
    layouts.values(),
    NO_IDENTIFIER_IN_THE_NAME,
  ).forName(given.name);
  const added: WorkspaceLayout = { ...layout, id, displayName: given.name, builtIn: false };
  layouts.set(id, added);
  return added;
}

/**
 * Puts a user layout removed from `layouts` back among them, and answers it as
 * it is held now: under its own identifier where no layout has taken it since,
 * and otherwise under a free one derived from its name; and under its own name
 * where no other layout has it, and otherwise numbered beside the others, as a
 * name that reaches the list unheld is (see `nameBesideTheOthers`).
 *
 * Its own identifier is kept where it can be, so what named the workspace
 * before it was removed names it again. Its name is kept as it is where this
 * runtime cannot compare names, as the workspace on screen's is (see
 * {@link nameOnScreen}): it was held to the list once, and a workspace the
 * user deleted by mistake is not kept from them for want of a comparison.
 */
export function putBack(
  layouts: Map<string, WorkspaceLayout>,
  removed: WorkspaceLayout,
): WorkspaceLayout {
  const displayName = namesCanBeCompared()
    ? nameBesideTheOthers(removed.displayName, namesIn(layouts).taken)
    : removed.displayName;
  const id = layouts.has(removed.id)
    ? LAYOUT_IDENTIFIERS.identifiersHeldBy(layouts.values(), NO_IDENTIFIER_IN_THE_NAME).forName(
        displayName,
      )
    : removed.id;
  const restored: WorkspaceLayout = { ...removed, id, displayName, builtIn: false };
  layouts.set(id, restored);
  return restored;
}
