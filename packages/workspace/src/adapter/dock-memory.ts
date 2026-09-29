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

/** What outlives one mount of the dock: made once, by whoever mounts it. */
export interface DockMemory {
  readonly scrolls: Map<PanelId, Scrolled>;
  /** How many times the dock has been mounted with it. */
  mounts: number;
}

/** A memory holding nothing yet. */
export function createDockMemory(): DockMemory {
  return { scrolls: new Map(), mounts: 0 };
}

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

/**
 * Puts the keyboard in the panel in use where it fell to the page when the
 * dock it was in was built again: its contents, which the adapter puts in the
 * tab order. A dialogue that ran the command, as the palette does, gives focus
 * back as it closes, which may be a moment after the dock is built, so the
 * page is looked at over a few frames; a keyboard anywhere but the page, or a
 * dialogue that stays open, is left where it is.
 */
function returnFocus(dock: Engine, active: PanelId | undefined): void {
  const document = dock.groups[0]?.element.ownerDocument;
  const group = active === undefined ? undefined : dock.getPanel(active)?.group;
  const contents = group === undefined ? null : contentsOf(group);
  if (document === undefined || contents === null) return;
  let frames = 0;
  const look = (): void => {
    if (document.activeElement === document.body) {
      contents.focus({ preventScroll: true });
      return;
    }
    const inDialogue = document.activeElement?.closest('[role="dialog"]') !== null;
    frames += 1;
    if (inDialogue && frames < FOCUS_FRAMES) requestAnimationFrame(look);
  };
  look();
}

/**
 * What a mount of the dock does with its memory: gives each panel its scroll
 * back, returns a keyboard left on the page to the panel in use on every mount
 * after the first, which a command caused, and records the scroll from then
 * on. Answers the function that stops recording.
 */
export function remember(
  dock: Engine,
  memory: DockMemory,
  active: PanelId | undefined,
): () => void {
  memory.mounts += 1;
  restoreScrolls(dock, memory);
  if (memory.mounts > 1) returnFocus(dock, active);
  return recordScrolls(dock, memory);
}
