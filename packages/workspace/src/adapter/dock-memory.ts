/**
 * What the dock keeps across being built again: how far each panel's contents
 * were scrolled, and the keyboard's place (Phase 01's F-304, F-560, F-283).
 *
 * A command that changes the layout outside the engine mounts the dock again,
 * and the engine's own scroll positions and focus go with the elements it
 * made. The scroll of each group is recorded, under the panel it shows, as it
 * happens, and given back once the panel's contents are drawn tall enough to
 * take it; a keyboard that was in the dock and fell to the page is put back in
 * the panel in use.
 *
 * It is put back on the control it was on, where that is in the panel in use
 * and is drawn again: no element outlives the mount, so the control is
 * recorded by its panel and by what it is in the panel. A panel the command
 * made the one in use has the keyboard on the control it marks as its
 * keyboard's home, as an editor view marks its surface, where the arrow keys
 * are its own. Left on a panel's contents, which take no key of an editor's,
 * the keyboard of a person who opened another view found the arrows doing
 * nothing.
 */

import type { PanelId } from '../panel.js';

/**
 * The part of one of the engine's groups this reads. Written by its shape, as
 * only the adapter may name the engine; the engine's group is one.
 */
interface EngineGroup {
  readonly element: HTMLElement;
  readonly activePanel?: { readonly id: string } | undefined;
}

/** The part of the engine this reads; the engine's own interface is one. */
interface Engine {
  readonly groups: readonly EngineGroup[];
  getPanel(id: string): { readonly group: EngineGroup } | undefined;
}

/** How far a panel's contents were scrolled. */
interface Scrolled {
  readonly top: number;
  readonly left: number;
}

/**
 * The control the keyboard was on in a panel: what it is, or nothing where it
 * was on the panel's contents, and which of the controls in the panel that
 * are the same it was. What it is means its kind of element, its role and its
 * name, which the panel draws the same each time it is drawn.
 */
interface FocusPlace {
  readonly panel: PanelId;
  readonly what: string;
  readonly which: number;
}

/** What outlives one mount of the dock: made once, by whoever mounts it. */
export interface DockMemory {
  readonly scrolls: Map<PanelId, Scrolled>;
  /** Where in the dock the keyboard was last. */
  focus: FocusPlace | undefined;
  /** How many times the dock has been mounted with it. */
  mounts: number;
}

/** A memory holding nothing yet. */
export function createDockMemory(): DockMemory {
  return { scrolls: new Map(), focus: undefined, mounts: 0 };
}

/**
 * The attribute a panel marks the control its keyboard belongs on with, where
 * it has one: the control a command that makes the panel the one in use gives
 * the keyboard to.
 */
export const KEYBOARD_HOME = 'data-ag-keyboard-home';

/** How many display frames a restore waits for a panel's contents to be drawn. */
const RESTORE_FRAMES = 30;

/** A group's contents, which scroll: its tab panel, which the adapter lets the keyboard reach. */
function contentsOf(group: EngineGroup): HTMLElement | null {
  return group.element.querySelector<HTMLElement>('[role="tabpanel"]');
}

/** Records each group's scroll under the panel it shows, until stopped. */
function recordScrolls(api: Engine, memory: DockMemory): () => void {
  const host = api.groups[0]?.element.ownerDocument;
  if (host === undefined) return () => undefined;
  const scrolled = (event: Event): void => {
    const group = api.groups.find((each) => contentsOf(each) === event.target);
    const panel = group?.activePanel?.id;
    const contents = group === undefined ? null : contentsOf(group);
    if (panel === undefined || contents === null) return;
    memory.scrolls.set(panel, { top: contents.scrollTop, left: contents.scrollLeft });
  };
  // A scroll does not bubble, so it is heard on its way down.
  host.addEventListener('scroll', scrolled, true);
  return () => {
    host.removeEventListener('scroll', scrolled, true);
  };
}

/**
 * Gives each group back the scroll its panel had, once the panel's contents
 * are drawn tall enough to take it, waiting a few frames for them at most.
 */
function restoreScrolls(api: Engine, memory: DockMemory): void {
  for (const group of api.groups) {
    const panel = group.activePanel?.id;
    const kept = panel === undefined ? undefined : memory.scrolls.get(panel);
    if (kept === undefined) continue;
    let frames = 0;
    const attempt = (): void => {
      const contents = contentsOf(group);
      if (contents === null) return;
      const roomy = contents.scrollHeight - contents.clientHeight >= kept.top;
      if (roomy || frames >= RESTORE_FRAMES) {
        contents.scrollTo(kept.left, kept.top);
        return;
      }
      frames += 1;
      requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }
}

/** How many display frames the dock waits for a dialogue that ran the command to give focus back. */
const FOCUS_FRAMES = 10;

/** What a control is, to know it again once it is drawn again: its kind, role and name. */
function whatIs(element: Element): string {
  const name = element.getAttribute('aria-label') ?? element.textContent.trim();
  return [element.tagName, element.getAttribute('role') ?? '', name].join('|');
}

/** The controls in `contents` that are what `what` says, in the order they are drawn. */
function alike(contents: HTMLElement, what: string): readonly HTMLElement[] {
  const [tag = ''] = what.split('|');
  return [...contents.querySelectorAll<HTMLElement>(tag)].filter((each) => whatIs(each) === what);
}

/** Records where in the dock the keyboard goes, as it goes there, until stopped. */
function recordFocus(api: Engine, memory: DockMemory): () => void {
  const host = api.groups[0]?.element.ownerDocument;
  if (host === undefined) return () => undefined;
  const focused = (event: Event): void => {
    const { target } = event;
    if (!(target instanceof HTMLElement)) return;
    const group = api.groups.find((each) => contentsOf(each)?.contains(target) === true);
    const panel = group?.activePanel?.id;
    const contents = group === undefined ? null : contentsOf(group);
    if (panel === undefined || contents === null) return;
    const what = target === contents ? '' : whatIs(target);
    const which = what === '' ? 0 : alike(contents, what).indexOf(target);
    memory.focus = { panel, what, which };
  };
  host.addEventListener('focusin', focused);
  return () => {
    host.removeEventListener('focusin', focused);
  };
}

/**
 * Where the keyboard goes in `contents`, panel `panel`'s: the control it was
 * on there where that is drawn again, and otherwise the control the panel
 * marks as its keyboard's home, or nothing until either is drawn.
 */
function placeIn(
  contents: HTMLElement,
  panel: PanelId,
  kept: FocusPlace | undefined,
): HTMLElement | undefined {
  if (kept?.panel === panel) {
    if (kept.what === '') return contents;
    const again = alike(contents, kept.what)[kept.which];
    if (again !== undefined) return again;
  }
  return contents.querySelector<HTMLElement>(`[${KEYBOARD_HOME}]`) ?? undefined;
}

/**
 * Puts the keyboard in the panel in use where it fell to the page when the dock
 * it was in was built again: on the control it was on, or the panel's keyboard
 * home, and on the panel's contents, which the adapter puts in the tab order,
 * until one of those is drawn. A dialogue that ran the command, as the palette
 * does, gives focus back as it closes, which may be a moment after the dock is
 * built, and a panel's controls are drawn a moment after the dock, so the page
 * is looked at over a few frames; a keyboard anywhere but the page and the
 * panel's contents, or a dialogue that stays open, is left where it is.
 */
function returnFocus(dock: Engine, active: PanelId | undefined, memory: DockMemory): void {
  const document = dock.groups[0]?.element.ownerDocument;
  const group = active === undefined ? undefined : dock.getPanel(active)?.group;
  const contents = group === undefined ? null : contentsOf(group);
  if (document === undefined || contents === null || active === undefined) return;
  const kept = memory.focus;
  let frames = 0;
  const look = (): void => {
    const now = document.activeElement;
    if (now === document.body || now === contents) {
      const place = placeIn(contents, active, kept) ?? contents;
      place.focus({ preventScroll: true });
      if (place !== contents) return;
    } else if (now?.closest('[role="dialog"]') === null) {
      return;
    }
    frames += 1;
    if (frames < FOCUS_FRAMES) requestAnimationFrame(look);
  };
  look();
}

/**
 * What a mount of the dock does with its memory: gives each panel its scroll
 * back, returns a keyboard left on the page to the panel in use on every mount
 * after the first, which a command caused, and records the scroll and the
 * keyboard's place from then on. Answers the function that stops recording.
 */
export function remember(
  dock: Engine,
  memory: DockMemory,
  active: PanelId | undefined,
): () => void {
  memory.mounts += 1;
  restoreScrolls(dock, memory);
  if (memory.mounts > 1) returnFocus(dock, active, memory);
  const scrolls = recordScrolls(dock, memory);
  const focus = recordFocus(dock, memory);
  return () => {
    scrolls();
    focus();
  };
}
