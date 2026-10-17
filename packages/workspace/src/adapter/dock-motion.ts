/**
 * How the dock moves, at each motion level (REQ-UX-222; the design language's
 * MotionSpec, "Dock and panel transitions" and "Workspace transitions").
 *
 * Two mechanisms carry it, both the platform's own (ADR-0014). A change the
 * application makes outside the engine (a panel opened, closed, docked,
 * floated or moved by a command, and a workspace switched) builds the dock
 * again, so the stage runs that rebuild as a view transition, and each group is
 * named here so the browser morphs it from its old box to its new one. A drop
 * the engine makes itself rearranges its own elements in the drop's handler,
 * with no moment to run as a transition, so its groups are measured as the
 * drop begins and settled into their new places afterwards with the Web
 * Animations API.
 *
 * Kept apart from the adapter, which alone may name the engine: everything
 * here reads elements and panel identifiers.
 */

/** The motion levels as the dock follows them. */
export const DockMotionLevel = {
  /** Every dock motion: groups morph, arrive and leave. */
  Full: 'full',

  /** Only fades: the old and new arrangements cross, and nothing moves. */
  Reduced: 'reduced',

  /** Nothing animates: every change is immediate. */
  Off: 'off',
} as const;

export type DockMotionLevel = (typeof DockMotionLevel)[keyof typeof DockMotionLevel];

/** A duration in milliseconds and the easing it runs on. */
export interface DockTiming {
  readonly duration: number;
  readonly easing: string;
}

/**
 * What the dock is told of the motion level, as the theme resolves it: the
 * level, and the timings of a group that moves and of one that arrives.
 *
 * Given as values rather than read from the stylesheet, because a Web
 * Animation is written in script, and the theme's typed motion scale is what
 * its tokens are written from.
 */
export interface DockMotion {
  readonly level: DockMotionLevel;

  /** A group docked, floated or moved, and a drop settling. */
  readonly move: DockTiming;

  /** A group arriving. */
  readonly enter: DockTiming;

  /** The scale an arriving group grows from (1 below the full level). */
  readonly enterScale: number;
}

/** One group as the dock draws it. */
export interface DrawnDockGroup {
  readonly element: HTMLElement;

  /** The panels it holds, by identifier. */
  readonly panels: readonly string[];

  /** The panel it shows, where it shows one. */
  readonly activePanel: string | undefined;
}

/** What a rebuild of the dock is, which decides what of it is named. */
export const DockChange = {
  /** The same workspace, arranged differently: every group keeps its identity. */
  Arrangement: 'arrangement',

  /** Another workspace: only a panel both share keeps its identity. */
  Workspace: 'workspace',
} as const;

export type DockChange = (typeof DockChange)[keyof typeof DockChange];

/** The view-transition name each panel's group went out under. */
export type DepartedNames = ReadonlyMap<string, string>;

/**
 * Names the groups leaving, before the browser captures them, and answers the
 * name each panel left under.
 *
 * In a workspace switch only a group holding a panel the next workspace also
 * shows is named; the rest stay in the dock region's own picture, which fades
 * and settles back as one, as the language asks of a workspace leaving.
 */
export function nameDeparting(
  groups: readonly DrawnDockGroup[],
  change: DockChange,
  arriving: ReadonlySet<string>,
): DepartedNames {
  const names = new Map<string, string>();
  groups.forEach((group, index) => {
    if (change === DockChange.Workspace && !group.panels.some((panel) => arriving.has(panel))) {
      return;
    }
    const name = `ag-dock-group-${String(index)}`;
    group.element.style.viewTransitionName = name;
    for (const panel of group.panels) names.set(panel, name);
  });
  return names;
}

/**
 * Names the groups arriving, after the dock is built again: a group takes the
 * name of the group its panel in front left under, else of the group any of its
 * panels left under, so a group whose panels moved morphs from where they
 * were. A group with no such panel arrives under a name of its own in a change
 * of arrangement, and with none in a workspace switch, where it is part of the
 * workspace fading in.
 */
export function nameArriving(
  groups: readonly DrawnDockGroup[],
  change: DockChange,
  departed: DepartedNames,
): void {
  const taken = new Set<string>();
  groups.forEach((group, index) => {
    const inherited = [group.activePanel, ...group.panels]
      .map((panel) => (panel === undefined ? undefined : departed.get(panel)))
      .find((name) => name !== undefined && !taken.has(name));

    const name =
      inherited ?? (change === DockChange.Arrangement ? `ag-dock-arrived-${String(index)}` : '');
    if (name === '') return;
    taken.add(name);
    group.element.style.viewTransitionName = name;
  });
}

/** Takes the names off, once the transition that needed them has finished. */
export function forgetNames(groups: readonly DrawnDockGroup[]): void {
  for (const group of groups) group.element.style.viewTransitionName = '';
}

/** Where each group was drawn, measured as a drop begins. */
type MeasuredBoxes = ReadonlyMap<HTMLElement, DOMRectReadOnly>;

/** Measures where each group is drawn now. */
function measureBoxes(groups: readonly DrawnDockGroup[]): MeasuredBoxes {
  return new Map(groups.map((group) => [group.element, group.element.getBoundingClientRect()]));
}

/** The least change of position or size, in CSS pixels, worth settling. */
const SETTLED = 0.5;

/** Whether a group was drawn in the same place and at the same size. */
function samePlace(before: DOMRectReadOnly, after: DOMRectReadOnly): boolean {
  return (
    Math.abs(before.x - after.x) < SETTLED &&
    Math.abs(before.y - after.y) < SETTLED &&
    Math.abs(before.width - after.width) < SETTLED &&
    Math.abs(before.height - after.height) < SETTLED
  );
}

/**
 * Settles each group a drop moved into its new place, and brings in a group the
 * drop made, at the motion level: at full a moved group travels from its old
 * box to its new one and a new group grows in; at reduced each fades in place;
 * off, nothing moves.
 *
 * A group is moved by a transform from its old box, which leaves the engine's
 * own measurements of it alone; the panels inside are drawn at their new size
 * from the first frame, so nothing reflows while it settles.
 */
function settleDrop(
  before: MeasuredBoxes,
  groups: readonly DrawnDockGroup[],
  motion: DockMotion,
): readonly Animation[] {
  if (motion.level === DockMotionLevel.Off) return [];

  const animations: Animation[] = [];
  for (const { element } of groups) {
    const after = element.getBoundingClientRect();
    const was = before.get(element);
    if (was !== undefined && samePlace(was, after)) continue;

    if (motion.level === DockMotionLevel.Reduced) {
      animations.push(
        element.animate([{ opacity: 0.4 }, { opacity: 1 }], {
          duration: motion.move.duration,
          easing: motion.move.easing,
        }),
      );
      continue;
    }

    if (was === undefined) {
      animations.push(
        element.animate(
          [
            { opacity: 0, transform: `scale(${String(motion.enterScale)})` },
            { opacity: 1, transform: 'none' },
          ],
          { duration: motion.enter.duration, easing: motion.enter.easing },
        ),
      );
      continue;
    }

    const shift = `translate(${String(was.x - after.x)}px, ${String(was.y - after.y)}px)`;
    const scale = `scale(${String(was.width / after.width)}, ${String(was.height / after.height)})`;
    animations.push(
      element.animate(
        [
          { transformOrigin: '0 0', transform: `${shift} ${scale}` },
          { transformOrigin: '0 0', transform: 'none' },
        ],
        { duration: motion.move.duration, easing: motion.move.easing },
      ),
    );
  }
  return animations;
}

/** A structural change the engine brackets, and who made it. */
interface LayoutMutation {
  readonly origin: string;
}

/** The part of the engine that says when it changes its structure. */
export interface MutationSource {
  onWillMutateLayout(listener: (event: LayoutMutation) => void): { dispose(): void };
  onDidMutateLayout(listener: (event: LayoutMutation) => void): { dispose(): void };
}

/**
 * Settles every rearrangement the user makes inside the engine, until stopped:
 * a drop, a panel the engine's own key closed.
 *
 * The engine makes such a change in the handler of the gesture, with no moment
 * to run it as a view transition, but it brackets each structural change with
 * a pair of events. Before it, each group is measured; after it, in the same
 * task and so before the next frame is drawn, each is settled from where it was
 * (`settleDrop`). Only a change the user made: one the adapter makes as it
 * builds the dock is part of the stage's transition, and a splitter drag or a
 * window resized changes no structure, so neither is ever eased, which direct
 * manipulation must never be (REQ-UX-069).
 */
export function watchDrops(
  engine: MutationSource,
  groups: () => readonly DrawnDockGroup[],
  motion: () => DockMotion,
): { readonly stop: () => void } {
  let before: MeasuredBoxes | undefined;
  const subscriptions = [
    engine.onWillMutateLayout((event) => {
      if (event.origin === 'user') before = measureBoxes(groups());
    }),
    engine.onDidMutateLayout((event) => {
      if (event.origin !== 'user' || before === undefined) return;
      settleDrop(before, groups(), motion());
      before = undefined;
    }),
  ];
  return {
    stop: () => {
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}
