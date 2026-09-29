/**
 * The workspace contract: what a panel is and where it can sit, and the rules
 * for closing, opening and moving one.
 *
 * The rules are beside the types because each is a statement about a layout
 * that only these types can make: which panel is open, which group holds it,
 * and what must stay docked. How much room a group takes, changed a step at a
 * time, is `panel-sizing.ts`.
 *
 * REQ-UX-057 requires docking to be core application infrastructure rather than
 * something each panel implements for itself, and REQ-ARCH-151 requires
 * Dockview to sit behind AudioGubbins-owned contracts. These types are those
 * contracts. Nothing here mentions Dockview, so replacing the docking engine is
 * a change to one adapter rather than to every panel.
 *
 * REQ-UX-059 keeps workspace state separable from project data. A layout
 * describes where panels are; it never describes what they hold. A corrupt
 * layout can therefore cost a user their arrangement and nothing else.
 */

/** Identifies a kind of panel, for example `asset-browser`. */
export type PanelKind = string;

/** Identifies one open instance of a panel. */
export type PanelId = string;

/** Where a panel may be placed. */
export const DockRegion = {
  /** The middle, where editors live. */
  Centre: 'centre',

  Left: 'left',
  Right: 'right',
  Bottom: 'bottom',

  /** Floating over the workspace, within the application window. */
  Floating: 'floating',
} as const;

/** Where a panel may be placed. */
export type DockRegion = (typeof DockRegion)[keyof typeof DockRegion];

/**
 * What a kind of panel is and how it behaves.
 *
 * Registered once per kind. The workspace consults this rather than asking the
 * panel, so a layout can be validated, and a preset built, without any panel
 * being mounted.
 */
export interface PanelDescriptor {
  readonly kind: PanelKind;

  /** British-English title shown on the tab. */
  readonly title: string;

  /**
   * Where the panel goes when nothing says otherwise.
   *
   * A preset may place it elsewhere. This is what a "Show the Inspector"
   * command uses when the Inspector is not currently anywhere.
   */
  readonly defaultRegion: DockRegion;

  /**
   * Whether more than one of this kind may be open at once.
   *
   * An editor tab is one per asset, so several; the Inspector is one, because a
   * second would show the same selection and confuse which is authoritative
   * (REQ-EDIT-072).
   */
  readonly allowsMultiple: boolean;

  /**
   * Whether the user may close it.
   *
   * A workspace with no way back to a panel needs the panel to be reachable
   * from a menu, which every closable panel is.
   */
  readonly closable: boolean;

  /** Smallest useful size in pixels, so the dock does not crush it. */
  readonly minimumSize?: { readonly width: number; readonly height: number };
}

/**
 * One open panel.
 *
 * `parameters` carries only what identifies *which* thing the panel shows, such
 * as an asset identifier. It never carries the thing itself: a layout is
 * persisted and a project is not, and the workspace must never become a second
 * copy of project state (REQ-ARCH-153).
 */
export interface OpenPanel {
  readonly id: PanelId;
  readonly kind: PanelKind;

  /** Overrides the descriptor's title, for an editor showing an asset name. */
  readonly title?: string;

  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Where a floating group sits, as fractions of the workspace.
 *
 * Fractions for the reason a docked group's size is a proportion: a layout
 * saved on a large display still has to make sense on a small one.
 */
export interface FloatingPlacement {
  /** Distance of the left edge from the workspace's, as a share of its width. */
  readonly x: number;

  /** Distance of the top edge from the workspace's, as a share of its height. */
  readonly y: number;

  readonly width: number;
  readonly height: number;
}

/**
 * Where a panel opened into the floating region goes, when nothing says.
 *
 * Centred horizontally and a little above the middle, which is where a window
 * the user asked for is expected to appear.
 */
export const DEFAULT_FLOATING_PLACEMENT: FloatingPlacement = {
  x: 0.3,
  y: 0.2,
  width: 0.4,
  height: 0.5,
};

/** A group of panels sharing one space, shown as tabs. */
export interface PanelGroup {
  readonly region: DockRegion;

  /**
   * Where the group floats, present exactly when the region is floating.
   *
   * Recorded so that a floating group is mounted where it floated: without it,
   * the adapter would have nowhere to put the group, and nothing would say
   * where a floating group had been.
   */
  readonly placement?: FloatingPlacement;

  /** The panels in this group, in tab order. */
  readonly panels: readonly OpenPanel[];

  /** Which panel is on top. */
  readonly activePanelId: PanelId;

  /**
   * How much of its region the group takes, from 0 to 1.
   *
   * A proportion rather than a pixel size, so a layout saved on a large display
   * still makes sense on a small one. REQ-UX-005 requires responsive layout
   * adaptation, and a layout in pixels does not adapt.
   */
  readonly proportion: number;
}

/**
 * Where the panels are, without which workspace they belong to.
 *
 * What a docking engine can report. The engine is mounted with a layout and
 * knows nothing of what happens to that layout afterwards, so anything it
 * reported with an identity would carry the name and the identity it was
 * mounted with: renaming a workspace would leave the dock reporting the old
 * name, and every later drag would be either refused or written back over the
 * rename. An arrangement carries no identity, so there is none to go stale and
 * none to forge.
 */
export interface WorkspaceArrangement {
  readonly groups: readonly PanelGroup[];

  /**
   * The panel the user was last working in, across the whole arrangement.
   *
   * Each group also records its own active tab; this says which of those groups
   * has the focus. A command that acts on "this panel" needs it, and a reload
   * returns the user to where they were rather than to the first panel.
   */
  readonly activePanelId?: PanelId;
}

/** A complete arrangement of panels: an arrangement, and the workspace it is. */
export interface WorkspaceLayout extends WorkspaceArrangement {
  /** Version of this stored format (REQ-REPO-187). */
  readonly schemaVersion: number;

  /** Stable identifier, for example `editing` or a generated one. */
  readonly id: string;

  /** British-English name the user sees and may change. */
  readonly displayName: string;

  /** Whether this layout ships with AudioGubbins and cannot be deleted. */
  readonly builtIn: boolean;
}

/**
 * Whether two shares differ by more than rounding.
 *
 * A share and a placement are both fractions of the workspace, arrived at by
 * arithmetic, so two that should be equal can differ in the last place. Read
 * by the rules that change a size and a placement a step at a time, to tell a
 * step that moved something from one that could not.
 */
export function differs(left: number, right: number): boolean {
  return Math.abs(left - right) >= 1e-9;
}

/** Why nothing can be done to a panel that is not in the layout. */
export const PANEL_NOT_OPEN = 'That panel is not open.';

/**
 * Why a panel cannot be closed, or `undefined` when it can.
 *
 * Separate from {@link withoutPanel} because a refusal and a result are
 * different answers. Were they one answer, the caller would compare the layout
 * it got back with the layout it passed in, so "the only panel left" and "no
 * such panel" would be indistinguishable, and a close that produced a new
 * object for a panel that was not open would compare unequal and have the shell
 * announce "The panel is closed." while nothing had closed.
 */
export function closureProblem(layout: WorkspaceLayout, id: PanelId): string | undefined {
  if (!panelsIn(layout).some((panel) => panel.id === id)) {
    return PANEL_NOT_OPEN;
  }

  if (panelsIn(layout).length <= 1) {
    return 'That is the only panel left, so closing it would leave nothing to work in.';
  }

  if (leavesNothingDocked(withoutPanelIn(layout.groups, id))) {
    return 'That is the last docked panel, and closing it would leave nothing for the floating panels to float over.';
  }

  return undefined;
}

/**
 * Whether groups that still hold panels have none docked.
 *
 * The one rule behind refusing to close or to float the last docked panel, and
 * behind refusing a layout, stored or dragged, with nothing docked. Held by the
 * move alone, it would let closing the last docked panel beside a floating one,
 * or dragging the last docked group out to float, leave the floating panels
 * over an empty workspace, which is the state the move refuses. With nothing
 * docked the engine has no grid to place a floating group against, and every
 * placement read back from it would be the whole screen.
 *
 * Takes groups whose shape is not yet known, so a layout being validated asks
 * the same question as one already in use.
 */
export function leavesNothingDocked(groups: readonly { readonly region?: unknown }[]): boolean {
  return groups.length > 0 && !groups.some(isDocked);
}

/**
 * The groups with a panel taken out of whichever one holds it.
 *
 * Each group keeps its active tab if it is still there, and otherwise its
 * first. A group with no panels left is dropped by the same step, so there is
 * no group without a first panel, no identifier to invent for one, and no
 * fallback on a branch that cannot be reached.
 *
 * Closing a panel and moving one both take it out of its group, and both do it
 * here: one rule written twice is one rule that can be changed in one place and
 * not the other.
 */
function withoutPanelIn(groups: readonly PanelGroup[], id: PanelId): PanelGroup[] {
  return groups.flatMap((group): PanelGroup[] => {
    const panels = group.panels.filter((panel) => panel.id !== id);
    if (panels.length === group.panels.length) return [group];

    const [first] = panels;
    if (first === undefined) return [];

    const stillActive = panels.find((panel) => panel.id === group.activePanelId);
    return [{ ...group, panels, activePanelId: (stillActive ?? first).id }];
  });
}

/**
 * The groups with a panel placed in a region, in front.
 *
 * It joins the region's group when there is one, and a group is made for it
 * when there is not, at the size a preset would have given it. Opening a panel
 * and moving one both place it, and both do it here rather than each carrying a
 * copy of the rule.
 */
function withPanelPlacedIn(
  groups: readonly PanelGroup[],
  panel: OpenPanel,
  region: DockRegion,
): PanelGroup[] {
  const target = groups.findIndex((group) => group.region === region);

  return target === -1
    ? [
        ...groups,
        {
          region,
          proportion: OPENED_GROUP_PROPORTION[region],
          panels: [panel],
          activePanelId: panel.id,
          ...(region === DockRegion.Floating ? { placement: DEFAULT_FLOATING_PLACEMENT } : {}),
        },
      ]
    : groups.map((group, index) =>
        index === target
          ? { ...group, panels: [...group.panels, panel], activePanelId: panel.id }
          : group,
      );
}

/**
 * Removes a panel from a layout, returning the layout without it.
 *
 * A group left with no panels is removed, because an empty region is a gap the
 * user cannot fill or close. If the panel was the active one, the layout falls
 * back to whatever is left rather than pointing at something that is gone.
 *
 * Returns the same layout, unchanged, whenever {@link closureProblem} refuses:
 * the panel is not open, or it is the only one left, or the last docked one.
 * The rule is stated there once, and this reads it.
 */
export function withoutPanel(layout: WorkspaceLayout, id: PanelId): WorkspaceLayout {
  if (closureProblem(layout, id) !== undefined) return layout;

  const groups = withoutPanelIn(layout.groups, id);
  const remaining = groups.flatMap((group) => group.panels);
  // At least one panel remains, since closing it was allowed, so the fallback
  // is only undefined to the type checker.
  const active = remaining.find((panel) => panel.id === layout.activePanelId) ?? remaining[0];

  return {
    ...layout,
    groups,
    ...(active === undefined ? {} : { activePanelId: active.id }),
  };
}

/** Every panel open in a layout. */
export function panelsIn(layout: WorkspaceLayout): readonly OpenPanel[] {
  return layout.groups.flatMap((group) => group.panels);
}

/**
 * What the user calls an open panel: its own title, else its kind's.
 *
 * One answer for the dock's tab, a menu heading and a command's sentence, so
 * the three cannot name one panel differently.
 */
export function titleOf(
  panel: OpenPanel,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): string {
  return panel.title ?? descriptors.get(panel.kind)?.title ?? panel.kind;
}

/** The panel the user is working in, or `undefined` when there is none. */
export function activePanelOf(layout: WorkspaceLayout): OpenPanel | undefined {
  return panelsIn(layout).find((panel) => panel.id === layout.activePanelId);
}

/** The group holding a panel, or `undefined`. */
export function groupContaining(layout: WorkspaceLayout, id: PanelId): PanelGroup | undefined {
  return layout.groups.find((group) => group.panels.some((panel) => panel.id === id));
}

/**
 * How much of its region a group takes when one is created to hold a panel.
 *
 * A panel opened by command usually has no group of its region yet, so one is
 * made for it. These match the proportions the presets use, so a panel opened
 * from a menu arrives at the size it would have had if the preset had included
 * it. The centre takes what is left, which is what `1` means here.
 */
const OPENED_GROUP_PROPORTION: Readonly<Record<DockRegion, number>> = {
  [DockRegion.Centre]: 1,
  [DockRegion.Left]: 0.2,
  [DockRegion.Right]: 0.22,
  [DockRegion.Bottom]: 0.2,
  [DockRegion.Floating]: 0.3,
};

/** The open panel of a kind, or `undefined` when none is open. */
function openPanelOfKind(layout: WorkspaceLayout, kind: PanelKind): OpenPanel | undefined {
  return panelsIn(layout).find((panel) => panel.kind === kind);
}

/**
 * An identifier no panel in the layout is using.
 *
 * The kind on its own where it is free, because a panel a user can only have
 * one of reads better in a stored layout as `capabilities` than as
 * `capabilities-1`.
 */
function freePanelId(layout: WorkspaceLayout, kind: PanelKind): PanelId {
  const taken = new Set(panelsIn(layout).map((panel) => panel.id));
  if (!taken.has(kind)) return kind;

  let suffix = 2;
  while (taken.has(`${kind}-${String(suffix)}`)) suffix += 1;
  return `${kind}-${String(suffix)}`;
}

/**
 * Why a panel of this kind cannot be opened, or `undefined` when it can.
 *
 * Separate from {@link withPanel} for the same reason {@link closureProblem} is
 * separate from {@link withoutPanel}: a refusal and a result are different
 * answers, and comparing the two layouts cannot tell them apart.
 *
 * Bringing a panel forward is not a refusal. A panel open behind another tab is
 * one the user cannot see, so showing it is a real change; only a panel that is
 * already the one they are looking at has nothing to do.
 */
export function openingProblem(
  layout: WorkspaceLayout,
  descriptor: PanelDescriptor,
): string | undefined {
  if (descriptor.allowsMultiple) return undefined;

  const open = openPanelOfKind(layout, descriptor.kind);
  if (open === undefined) return undefined;

  return groupContaining(layout, open.id)?.activePanelId === open.id &&
    layout.activePanelId === open.id
    ? `The ${descriptor.title} panel is already open.`
    : undefined;
}

/**
 * Opens a panel of a kind, or brings the open one forward.
 *
 * REQ-UX-057 makes docking core infrastructure, and a panel the user closed has
 * to be reachable again or the close command is a one-way door. The descriptor
 * decides where it goes, which is the whole purpose of `defaultRegion`: the
 * layout does not have to have anticipated the panel.
 *
 * A panel already open is never opened twice unless its kind allows several. An
 * Inspector in two places would show one selection in two panels, and neither
 * would be the authoritative one (REQ-EDIT-072).
 *
 * Given `beside`, a panel of a kind the user may have several of opens in a
 * group of its own beside the group holding it, where that is the main area.
 */
export function withPanel(
  layout: WorkspaceLayout,
  descriptor: PanelDescriptor,
  beside?: PanelId,
): WorkspaceLayout {
  if (beside !== undefined) return withPanelBeside(layout, descriptor, beside);
  const open = descriptor.allowsMultiple ? undefined : openPanelOfKind(layout, descriptor.kind);

  if (open !== undefined) {
    return {
      ...layout,
      groups: layout.groups.map((group) =>
        group.panels.some((panel) => panel.id === open.id)
          ? { ...group, activePanelId: open.id }
          : group,
      ),
      activePanelId: open.id,
    };
  }

  const panel: OpenPanel = { id: freePanelId(layout, descriptor.kind), kind: descriptor.kind };

  return {
    ...layout,
    groups: withPanelPlacedIn(layout.groups, panel, descriptor.defaultRegion),
    activePanelId: panel.id,
  };
}

/**
 * Opens a panel of a kind in a group of its own beside the group holding
 * `beside`, the two sharing the width that group had, so both are on screen
 * at once: a second view of an asset beside the first (REQ-EDIT-061). Only
 * the main area splits so, and only for a kind the user may have several of;
 * otherwise the panel opens as {@link withPanel} opens it without `beside`.
 */
function withPanelBeside(
  layout: WorkspaceLayout,
  descriptor: PanelDescriptor,
  beside: PanelId,
): WorkspaceLayout {
  const index = layout.groups.findIndex((group) =>
    group.panels.some((panel) => panel.id === beside),
  );
  const group = layout.groups[index];
  if (group?.region !== DockRegion.Centre || !descriptor.allowsMultiple) {
    return withPanel(layout, descriptor);
  }
  const panel: OpenPanel = { id: freePanelId(layout, descriptor.kind), kind: descriptor.kind };
  const half = group.proportion / 2;
  const groups = [
    ...layout.groups.slice(0, index),
    { ...group, proportion: half },
    { region: DockRegion.Centre, proportion: half, panels: [panel], activePanelId: panel.id },
    ...layout.groups.slice(index + 1),
  ];
  return { ...layout, groups, activePanelId: panel.id };
}

/** How each region is named in a sentence about a panel being there. */
const REGION_PHRASES: Readonly<Record<DockRegion, string>> = {
  [DockRegion.Left]: 'on the left',
  [DockRegion.Centre]: 'in the middle',
  [DockRegion.Right]: 'on the right',
  [DockRegion.Bottom]: 'along the bottom',
  [DockRegion.Floating]: 'floating',
};

/**
 * Where a region is, as the end of a sentence: "The Assets panel is ..."
 *
 * One vocabulary for the refusal that says a panel is already there and the
 * announcement that says it has arrived, so the two cannot describe one place
 * in two ways.
 */
export function regionPhrase(region: DockRegion): string {
  return REGION_PHRASES[region];
}

/** Whether a group is docked in the workspace rather than floating over it. */
export function isDocked(group: { readonly region?: unknown }): boolean {
  return group.region !== DockRegion.Floating;
}

/**
 * Why a panel cannot be moved into a region, or `undefined` when it can.
 *
 * Separate from {@link withPanelMoved} for the reason {@link closureProblem} is
 * separate from {@link withoutPanel}, and so that a menu entry can say why it
 * cannot be chosen before the user chooses it, rather than claim to be
 * available and then refuse.
 *
 * Floating the last docked panel is refused. Every docked group gone would
 * leave a workspace with nothing to float over: the engine would draw its
 * empty-grid watermark behind the floating panels, nothing could be resized,
 * and the floating placements, measured against the docked groups' extent,
 * would be read back as the whole screen and stored that way.
 */
export function movingProblem(
  layout: WorkspaceLayout,
  id: PanelId,
  region: DockRegion,
): string | undefined {
  const plan = planMove(layout, id, region);
  return typeof plan === 'string' ? plan : undefined;
}

/**
 * The groups a move would leave, or why it is refused: the one answer both the
 * question and the move read. Were the move to read the groups a second time,
 * it would need a fallback for a refusal it could not meet, and that fallback
 * would report the panel moved when it was not.
 */
function planMove(
  layout: WorkspaceLayout,
  id: PanelId,
  region: DockRegion,
): readonly PanelGroup[] | string {
  const from = groupContaining(layout, id);
  const panel = from?.panels.find((one) => one.id === id);
  if (from === undefined || panel === undefined) return PANEL_NOT_OPEN;

  // Already there, alone or with others: a move into its own group would only
  // put its tab last, which is not what "move" asks for.
  if (from.region === region) return `That panel is already ${REGION_PHRASES[region]}.`;

  // Asked of the layout the move would make. Asked of the groups with the panel
  // taken out, the only panel left would be a move with nothing in its way, and
  // floating it would leave nothing docked.
  const moved = withPanelPlacedIn(withoutPanelIn(layout.groups, id), panel, region);
  if (leavesNothingDocked(moved)) {
    return 'That is the last docked panel, and floating it would leave nothing for the others to float over.';
  }

  return moved;
}

/**
 * Moves a panel into a region, and says why it could not.
 *
 * REQ-UX-057 asks for panels that can be moved between regions, and the docking
 * engine does that with the browser's drag-and-drop, which a touch screen never
 * produces and a keyboard cannot reach at all. Left to the engine, the
 * arrangement would be a mouse-only feature on a phase whose own criteria make
 * touch and keyboard first-class (`REQ-UX-005`), so the operation lives here,
 * where a command can call it and neither a pointer nor an engine is involved.
 *
 * A move is the panel taken out of its group and placed in the region's, so it
 * is written as exactly that. The group it leaves is dropped when it held
 * nothing else, so the move never leaves an empty region behind.
 */
export function withPanelMoved(
  layout: WorkspaceLayout,
  id: PanelId,
  region: DockRegion,
): WorkspaceLayout | string {
  const plan = planMove(layout, id, region);
  return typeof plan === 'string' ? plan : { ...layout, groups: plan, activePanelId: id };
}
