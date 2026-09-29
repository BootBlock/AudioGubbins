/**
 * The only module in AudioGubbins that knows Dockview exists.
 *
 * REQ-ARCH-151 requires Dockview to sit behind AudioGubbins-owned workspace
 * contracts so the application is not coupled to the docking engine. The
 * architecture rules enforce it: an import of `dockview` from anywhere but this
 * directory is a build failure.
 *
 * The adapter's job is narrow. It mounts panels where an AudioGubbins
 * {@link WorkspaceLayout} says they go, and reports back when the user moves
 * them. It does not decide what a panel is, which panels exist, or what a
 * preset looks like; those are decisions above it, and keeping them above it is
 * what makes them testable without a docking engine.
 */

import type { DockviewApi, DockviewGroupPanel, IDockviewPanelHeaderProps } from 'dockview';
import { DockviewReact, type IDockviewPanelProps } from 'dockview-react';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import {
  DockRegion,
  type OpenPanel,
  titleOf,
  type PanelDescriptor,
  type PanelKind,
  type WorkspaceArrangement,
  type WorkspaceLayout,
} from '../panel.js';
import { keepBaseline } from './baseline.js';
import { createChangeCoalescer, type FrameScheduler } from './coalescer.js';
import {
  arrangementFrom,
  type DrawnGroup,
  type MeasuredGroup,
  type Rectangle,
} from './geometry.js';

/** The browser's own frames, which every report and pairing waits for. */
const ANIMATION_FRAMES: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle);
  },
};

/** Calls `resized` each time `host` is laid out at a new size, until the answer is called. */
function watchSizeOf(host: HTMLElement | undefined, resized: () => void): () => void {
  if (host === undefined) return () => undefined;
  const observer = new ResizeObserver(resized);
  observer.observe(host);
  return () => {
    observer.disconnect();
  };
}

/** The rectangle an element occupies, in page coordinates. */
function rectangleOf(element: HTMLElement): Rectangle {
  const box = element.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/** Renders the contents of one panel. */
export type PanelRenderer = (panel: OpenPanel) => ReactNode;

/**
 * The tab AudioGubbins draws, replacing the engine's own.
 *
 * The engine's default tab nests a close control inside the element that
 * carries `role="tab"`. That is a serious accessibility defect on two counts:
 * axe reports the nested interactive controls, and the control is rendered with
 * `tabindex="-1"`, so a keyboard user cannot reach it at all. An accessibility
 * audit of the running application would report both.
 *
 * This tab therefore renders the title and nothing else, which leaves one
 * interactive element per tab and nothing unreachable. Closing a panel is a
 * command like every other action (REQ-EDIT-073), so it is available from the
 * palette, from a menu and from a shortcut, to pointer and keyboard users
 * alike. That is a wider affordance than the control it replaces, not a
 * narrower one.
 *
 * It is not the only way, and the other is the engine's: `dockview@8.3.1` binds
 * Backspace and Delete on the tab that has focus to closing its panel, which
 * this tab does not draw and no menu names. The application answers it — the
 * arrangement that comes back is read for panels that have gone, and the loss
 * is announced in the close command's own words (`panelsClosedBy`) — rather
 * than trying to take the key off the engine, which would leave a keyboard user
 * with a key that does nothing. Read this paragraph against the engine's own
 * tab handler at the next dependency bump: a key it adds or takes away changes
 * what a user can destroy without being asked.
 */
function AudioGubbinsTab(props: IDockviewPanelHeaderProps): ReactNode {
  return <span className="ag-dock-tab">{props.api.title ?? props.api.id}</span>;
}

/** What the adapter needs. */
export interface DockHostProps {
  readonly layout: WorkspaceLayout;

  /** What each kind of panel is. */
  readonly descriptors: ReadonlyMap<string, PanelDescriptor>;

  /** How to draw a panel's contents. */
  readonly renderPanel: PanelRenderer;

  /**
   * Called when the user rearranges the workspace.
   *
   * What is passed back is an arrangement, the groups and the panel in use,
   * with no identity: the caller gives it the workspace on screen, and needs
   * to know nothing about the docking engine.
   */
  readonly onArrangementChange: (arrangement: WorkspaceArrangement) => void;

  /** Whether the interface is dark, so the engine draws to match. */
  readonly dark: boolean;
}

/** Dockview's own name for each docked region. */
const DOCKVIEW_POSITION = {
  [DockRegion.Centre]: 'within',
  [DockRegion.Left]: 'left',
  [DockRegion.Right]: 'right',
  [DockRegion.Bottom]: 'below',
} as const;

/** What a region's groups are called to a screen reader. */
const REGION_NAMES: Readonly<Record<DockRegion, string>> = {
  [DockRegion.Centre]: 'Main panels',
  [DockRegion.Left]: 'Left panels',
  [DockRegion.Right]: 'Right panels',
  [DockRegion.Bottom]: 'Bottom panels',
  [DockRegion.Floating]: 'Floating panels',
};

/**
 * The panel kind a panel was mounted with, from the parameters the engine hands
 * back untyped.
 */
function kindOf(parameters: unknown): string | undefined {
  return typeof parameters === 'object' &&
    parameters !== null &&
    'kind' in parameters &&
    typeof parameters.kind === 'string'
    ? parameters.kind
    : undefined;
}

/**
 * The parameters a panel was mounted with besides its kind, from what the
 * engine hands back untyped, or none. Read back with the panel, since a panel's
 * parameters say which thing it shows, and an arrangement without them would
 * show something else after the next reload.
 */
function parametersOf(parameters: unknown): Pick<OpenPanel, 'parameters'> {
  if (typeof parameters !== 'object' || parameters === null) return {};
  const kept = Object.entries(parameters).filter(
    (entry): entry is [string, string | number | boolean] =>
      entry[0] !== 'kind' && ['string', 'number', 'boolean'].includes(typeof entry[1]),
  );
  return kept.length === 0 ? {} : { parameters: Object.fromEntries(kept) };
}

/** One group of the engine's, measured, with the element it draws in. */
interface MeasuredEngineGroup {
  readonly group: DockviewGroupPanel;
  readonly measured: MeasuredGroup;
}

/**
 * Measures every group the engine holds.
 *
 * The adapter measures; `arrangementFrom` decides. Keeping the decision in a
 * module with no engine types is what makes the read-back testable at all:
 * there, which region each group is in is decided from rectangles a test can
 * write down, and here it could be checked only by mounting the engine.
 */
function measureGroups(
  api: DockviewApi,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly MeasuredEngineGroup[] {
  return api.groups.map((group) => {
    const panels: OpenPanel[] = group.panels.map((panel) => {
      const kind = kindOf(panel.params) ?? panel.id;
      // A title only where it overrides the descriptor's, as a panel is stored:
      // were it read back always, every panel would differ from the one it was
      // drawn from.
      const own = titleOf({ id: panel.id, kind }, descriptors);
      return {
        id: panel.id,
        kind,
        ...(panel.title === undefined || panel.title === own ? {} : { title: panel.title }),
        ...parametersOf(panel.params),
      };
    });

    const active = group.activePanel?.id;

    return {
      group,
      measured: {
        rectangle: rectangleOf(group.element),
        panels,
        floating: group.api.location.type === 'floating',
        ...(active === undefined ? {} : { activePanelId: active }),
      },
    };
  });
}

/**
 * Reads the arrangement back out of the docking engine.
 *
 * Only the parts AudioGubbins owns are read: which panels are where, which is
 * active, how much room each group takes, and where a floating group floats.
 * Dockview's own serialised form is deliberately not stored. It is the engine's
 * private format, it changes between versions, and storing it would make
 * replacing the engine a migration of every user's saved workspaces.
 *
 * The engine's groups come back too, in the order of the layout's, so that
 * whatever else has to be done to them can be done to the right one, and what
 * each measured, so a reading can tell a group that moved.
 */
function readArrangement(
  api: DockviewApi,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  before: readonly DrawnGroup[],
): {
  readonly arrangement: WorkspaceArrangement;
  readonly groups: readonly DockviewGroupPanel[];
  readonly measured: readonly MeasuredGroup[];

  /** The element the grid is drawn in, or `undefined` while nothing is docked. */
  readonly host: HTMLElement | undefined;
} {
  const engineGroups = measureGroups(api, descriptors).filter(
    (one) => one.measured.panels.length > 0,
  );

  // The engine's grid, which a floating group is placed over and measured
  // against. Found through the shell both hold: a floating group is drawn in an
  // overlay beside the grid rather than inside it, so asking a floating group
  // for its enclosing grid would find nothing, and with nothing docked every
  // placement would be read back as the whole screen.
  const host = engineGroups[0]?.group.element
    .closest<HTMLElement>('.dv-shell')
    ?.querySelector<HTMLElement>('.dv-dockview');

  return {
    arrangement: arrangementFrom(
      engineGroups.map((one) => one.measured),
      api.activePanel?.id,
      host === null || host === undefined ? { x: 0, y: 0, width: 0, height: 0 } : rectangleOf(host),
      before,
    ),
    groups: engineGroups.map((one) => one.group),
    measured: engineGroups.map((one) => one.measured),
    host: host ?? undefined,
  };
}

/**
 * Lets a keyboard reach every group's contents.
 *
 * A panel's contents scroll when the group is smaller than they are, and a
 * scrolling region no keyboard can reach cannot be scrolled without a pointer
 * (WCAG 2.1.1). The engine renders each group's contents as a `tabpanel` that
 * takes focus only programmatically; the ARIA tabs pattern gives a tab panel a
 * place in the tab order for exactly this. Groups drawn at the sizes the layout
 * asks for need it: the Transport panel at a sixth of the height overflows, and
 * without this the accessibility audit would refuse it.
 */
function letKeyboardReachContents(groups: readonly DockviewGroupPanel[]): void {
  for (const group of groups) {
    group.element.querySelector('[role="tabpanel"]')?.setAttribute('tabindex', '0');
  }
}

/**
 * Names each group's tab list after its region.
 *
 * The engine renders every group's tabs as an unnamed `tablist`, so without a
 * name a screen reader would announce several tab lists and nothing to tell
 * them apart. The element is the engine's, but it is in the page, and a name is
 * an attribute, so it can be named from outside the engine. Named after the
 * region, which is what a user moving between them needs to know, and numbered
 * where one region holds more than one group. Renamed on every change, because
 * a drag can move a group to another region.
 */
function nameTabLists(
  groups: readonly DockviewGroupPanel[],
  arrangement: WorkspaceArrangement,
): void {
  const seen = new Map<DockRegion, number>();

  arrangement.groups.forEach((group, index) => {
    const count = (seen.get(group.region) ?? 0) + 1;
    seen.set(group.region, count);

    const total = arrangement.groups.filter((one) => one.region === group.region).length;
    const name =
      total > 1 ? `${REGION_NAMES[group.region]} ${String(count)}` : REGION_NAMES[group.region];

    groups[index]?.element.querySelector('[role="tablist"]')?.setAttribute('aria-label', name);
  });
}

/**
 * Where the first panel of a group goes, and at what size.
 *
 * A docked group opens beside the anchor, sized from its stored proportion
 * along the axis its region is sized on. Were the proportion stored and never
 * applied, a panel the user widened would come back at its preset width after a
 * reload. A floating group floats where its placement says, over the workspace.
 */
function firstPanelPlacement(
  api: DockviewApi,
  group: WorkspaceLayout['groups'][number],
  anchor: string | undefined,
  beside: boolean,
) {
  if (group.region === DockRegion.Floating) {
    const placement = group.placement;
    return placement === undefined
      ? { floating: true as const }
      : {
          floating: {
            x: placement.x * api.width,
            y: placement.y * api.height,
            width: placement.width * api.width,
            height: placement.height * api.height,
          },
        };
  }

  if (beside && anchor !== undefined) {
    return {
      initialWidth: group.proportion * api.width,
      position: { referencePanel: anchor, direction: 'right' as const },
    };
  }

  const size =
    group.region === DockRegion.Left || group.region === DockRegion.Right
      ? { initialWidth: group.proportion * api.width }
      : group.region === DockRegion.Bottom
        ? { initialHeight: group.proportion * api.height }
        : {};

  return anchor === undefined
    ? size
    : {
        ...size,
        position: { referencePanel: anchor, direction: DOCKVIEW_POSITION[group.region] },
      };
}

/**
 * Fills the engine with a layout: every group where the layout places it, at
 * its stored size, showing the tab the user left in front.
 */
function mountLayout(
  api: DockviewApi,
  layout: WorkspaceLayout,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): void {
  /** Adds one group, placed where the layout says, and returns its first panel. */
  const addGroup = (
    group: WorkspaceLayout['groups'][number],
    anchor: string | undefined,
    beside = false,
  ): string | undefined => {
    let firstInGroup: string | undefined;

    for (const panel of group.panels) {
      // The engine keeps a group no smaller than the largest minimum of its
      // panels, so a splitter drag cannot crush one. Declared and passed to
      // nothing, the minimum would let a drag take a panel down to the engine's
      // own.
      const minimum = descriptors.get(panel.kind)?.minimumSize;
      const added = api.addPanel({
        id: panel.id,
        component: 'panel',
        title: titleOf(panel, descriptors),
        params: { kind: panel.kind, ...panel.parameters },
        ...(minimum === undefined
          ? {}
          : { minimumWidth: minimum.width, minimumHeight: minimum.height }),

        // The first panel of a group opens the group. Every panel after it
        // joins that group as another tab.
        ...(firstInGroup === undefined
          ? firstPanelPlacement(api, group, anchor, beside)
          : { position: { referencePanel: firstInGroup, direction: 'within' as const } }),
      });

      firstInGroup ??= added.id;
    }

    return firstInGroup;
  };

  // The centre goes in first, with no anchor, so it becomes the main area.
  // Every other group is then placed against the centre.
  //
  // Anchoring each group to the one before it would not work: the direction for
  // the centre is "within", so a centre group added after a left one would join
  // it as a tab instead of becoming the main area, and the editor would appear
  // as a second tab beside the asset browser. Only a browser test can see that,
  // because the unit tests never mount the docking engine.
  //
  // Floating groups go in last, over a workspace whose docked groups are
  // already in place, because they are placed against the whole workspace
  // rather than against a panel.
  const centre = layout.groups.filter((group) => group.region === DockRegion.Centre);
  const surrounding = layout.groups.filter(
    (group) => group.region !== DockRegion.Centre && group.region !== DockRegion.Floating,
  );
  const floating = layout.groups.filter((group) => group.region === DockRegion.Floating);

  // A second group in the main area goes beside the one before it, at its own
  // width, so a split main area comes back split rather than as one stack of
  // tabs; the first is the anchor every other region is placed against.
  let anchor: string | undefined;
  let previous: string | undefined;
  for (const group of centre) {
    const first = addGroup(group, previous, previous !== undefined);
    anchor ??= first;
    previous = first ?? previous;
  }

  for (const group of surrounding) {
    addGroup(group, anchor);
  }

  for (const group of floating) {
    addGroup(group, undefined);
  }

  // Every group's front tab, then the panel the user was working in. Each panel
  // added becomes the front of its group, so without this a group with two tabs
  // would come back showing the last one added whatever the user had chosen.
  // Every group's choice is restored, and then the layout's own.
  for (const group of layout.groups) api.getPanel(group.activePanelId)?.api.setActive();
  if (layout.activePanelId !== undefined) api.getPanel(layout.activePanelId)?.api.setActive();
}

/**
 * Reports every rearrangement the engine makes, until stopped, each read
 * against where the engine is drawing the arrangement last known.
 *
 * Names the tab lists and lets the keyboard into every group on each report,
 * and once at the start.
 */
function watchArrangement(
  api: DockviewApi,
  drawn: WorkspaceArrangement,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  onArrangementChange: (arrangement: WorkspaceArrangement) => void,
): { readonly stop: () => void } {
  /**
   * Reads the arrangement back, naming the tab lists after where they are
   * and letting the keyboard into every group.
   */
  const observe = (before: readonly DrawnGroup[]): ReturnType<typeof readArrangement> => {
    const read = readArrangement(api, descriptors, before);
    nameTabLists(read.groups, read.arrangement);
    letKeyboardReachContents(read.groups);
    return read;
  };

  // Once now as well, rather than only on the first change, so the tab lists
  // have their names before the user has moved anything. What it measures is
  // where the engine drew the layout it was mounted with, so a group still
  // drawn there reads back as that layout stored it, a group resized and put
  // back included.
  const mounted = observe([]);
  const baseline = keepBaseline({
    drawn,
    mounted: mounted.measured,
    measure: (before) => readArrangement(api, descriptors, before).measured,
    watchSize: (resized) => watchSizeOf(mounted.host, resized),
    frames: ANIMATION_FRAMES,
  });

  // Report every rearrangement, so the caller can store it. Dockview fires this
  // for a drag, a close, a resize and a tab change alike, which is right: all
  // four change where the user left their workspace. Coalesced to the first
  // change of a burst and one report a frame after it; see `coalescer.ts` for
  // the constraints that keep this apart from the adapter.
  const coalescer = createChangeCoalescer(() => {
    const read = observe(baseline.groups());
    baseline.reported(read.arrangement, read.measured);
    onArrangementChange(read.arrangement);
  }, ANIMATION_FRAMES);
  const subscription = api.onDidLayoutChange(coalescer.changed);

  // A hidden document runs no frames, and a tab switched away from can be
  // discarded or closed before it is shown again, so what a drag ended on
  // is reported as the page is hidden or left rather than owed to a frame
  // that may never come.
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') coalescer.flush();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', coalescer.flush);

  // Stopped when the mount goes, so nothing reads an engine that has been
  // disposed and nothing reports into the workspace that replaced it.
  return {
    stop: () => {
      coalescer.stop();
      baseline.stop();
      subscription.dispose();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', coalescer.flush);
    },
  };
}

/** Mounts the workspace. */
export function DockHost({
  layout,
  descriptors,
  renderPanel,
  onArrangementChange,
  dark,
}: DockHostProps): ReactNode {
  /**
   * What this mount has to undo when it goes.
   *
   * Left running, the engine's subscription and the coalescing frame would
   * outlive it. Every command that changes the layout outside the dock remounts
   * it, and a frame still pending would then measure an engine that had been
   * disposed: its groups answer, their elements are detached, and every
   * rectangle is zero, so the read-back would classify every group as the
   * centre and hand that to the caller, which would stamp it with whatever
   * workspace was on screen by then. The arrangement of one workspace would be
   * written into another.
   */
  const running = useRef<{ stop: () => void }>(null);

  useEffect(
    () => () => {
      running.current?.stop();
      running.current = null;
    },
    [],
  );
  // Dockview takes a map of component name to component. AudioGubbins has one
  // component that renders any panel, because which panel is a parameter rather
  // than a different component, so the map has a single entry.
  const components = useMemo(
    () => ({
      panel: (props: IDockviewPanelProps) =>
        renderPanel({
          id: props.api.id,
          kind: kindOf(props.params) ?? '',
          ...(props.api.title === undefined ? {} : { title: props.api.title }),
        }),
    }),
    [renderPanel],
  );

  const onReady = useCallback(
    (event: { api: DockviewApi }) => {
      mountLayout(event.api, layout, descriptors);

      running.current?.stop();
      running.current = watchArrangement(event.api, layout, descriptors, onArrangementChange);
    },
    // Listed for the linter's sake and nothing else: the engine calls this
    // once, when it mounts, and never takes a new one. What makes the dock
    // follow a changed layout is the key the shell mounts it under, not these.
    [layout, descriptors, onArrangementChange],
  );

  return (
    <DockviewReact
      components={components}
      defaultTabComponent={AudioGubbinsTab}
      onReady={onReady}
      className={dark ? 'dockview-theme-dark' : 'dockview-theme-light'}
    />
  );
}
