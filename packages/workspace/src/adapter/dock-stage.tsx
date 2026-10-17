/**
 * The stage the dock is built on, which runs each rebuild as a view transition.
 *
 * A change made outside the docking engine (a panel opened, closed, docked,
 * floated or moved by a command, a workspace switched, an arrangement the store
 * refused put back) builds the dock again under a new key. Built at once, every
 * group would jump to its new place. Here the old dock stays on screen until
 * the browser has captured it, the new one is built inside the transition's
 * update, and the browser morphs each named group from its old box to its new
 * one (design language, MotionSpec: "Dock and panel transitions", "Workspace
 * transitions"). `::view-transition` takes no pointer events, so input reaches
 * the live dock while the transition draws.
 *
 * At the reduced level no group is named, so the whole dock cross-fades, with
 * no geometry morph; off, and in a browser without view transitions, the dock
 * is built at once, as it always was.
 */

import {
  createContext,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

import type { WorkspaceLayout } from '../panel.js';
import {
  DockChange,
  DockMotionLevel,
  forgetNames,
  nameArriving,
  nameDeparting,
  type DepartedNames,
  type DockMotion,
  type DrawnDockGroup,
} from './dock-motion.js';

/** What the stage shows: the layout, and the key the dock is built under. */
export interface StagedArrangement {
  /** Changes whenever the dock must be built again. */
  readonly key: string;
  readonly layout: WorkspaceLayout;
}

/** What a dock built on the stage gives it. */
export interface StagedDock {
  /** The groups it draws now. */
  readonly groups: () => readonly DrawnDockGroup[];

  /**
   * Stops it reporting arrangements, because it is about to be replaced.
   *
   * The old dock stays on screen until the browser has captured it, a frame
   * later. A report owed by then would describe the arrangement being replaced,
   * and be stored over the one replacing it, as a report from a dock already
   * gone would be.
   */
  readonly halt: () => void;
}

/** How a dock tells the stage it is built, and answers how to forget it. */
export type AttachDock = (dock: StagedDock) => () => void;

/** The stage a dock is built on, where there is one. */
export const DockStageContext = createContext<AttachDock | undefined>(undefined);

/** What the stage takes. */
export interface DockStageProps {
  readonly arrangement: StagedArrangement;
  readonly motion: DockMotion;

  /** Builds the dock for the arrangement shown, under its key. */
  readonly children: (shown: StagedArrangement) => ReactNode;
}

/** Whether this document can run a same-document view transition. */
function canTransition(): boolean {
  return 'startViewTransition' in document;
}

/**
 * Waits for the next task.
 *
 * The engine mounts each panel through a portal, added by a state update it
 * makes as it is built, which React renders in a task of its own, queued then.
 * A task queued after that one runs once the panels are drawn, so the browser
 * captures the new dock whole rather than its empty groups.
 */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

/** Every panel a layout shows. */
function panelsOf(layout: WorkspaceLayout): ReadonlySet<string> {
  return new Set(layout.groups.flatMap((group) => group.panels.map((panel) => panel.id)));
}

/** The attribute that says a dock transition is running, and of which kind. */
const TRANSITION_ATTRIBUTE = 'data-ag-dock-transition';

/** One rebuild of the dock, run as a view transition. */
interface Rebuild {
  readonly change: DockChange;

  /** Whether groups are named to morph, which only the full level asks for. */
  readonly full: boolean;

  /** The layout the rebuild draws. */
  readonly arriving: WorkspaceLayout;

  /** The dock on the stage, which is the old one until `draw` builds the new. */
  readonly dock: () => StagedDock | undefined;

  /** Builds the new dock, synchronously. */
  readonly draw: () => void;

  /** Called once the transition has finished, whether it ran or was skipped. */
  readonly finished: () => void;
}

/**
 * Runs one rebuild as a view transition: silences the old dock and names its
 * groups before the browser captures it, builds the new one in the update and
 * names its groups once its panels are drawn, and takes every name and the
 * document's mark off once the transition is done.
 */
function rebuildInTransition(rebuild: Rebuild): void {
  const { change, full } = rebuild;
  const root = document.documentElement;

  rebuild.dock()?.halt();
  const departing = rebuild.dock()?.groups() ?? [];
  const departed: DepartedNames = full
    ? nameDeparting(departing, change, panelsOf(rebuild.arriving))
    : new Map();
  root.setAttribute(TRANSITION_ATTRIBUTE, change);

  const transition = document.startViewTransition(async () => {
    rebuild.draw();
    await nextTask();
    if (full) nameArriving(rebuild.dock()?.groups() ?? [], change, departed);
  });

  void transition.finished.finally(() => {
    forgetNames(rebuild.dock()?.groups() ?? []);
    root.removeAttribute(TRANSITION_ATTRIBUTE);
    rebuild.finished();
  });
}

/** Builds the dock, and builds it again in a view transition when its key changes. */
export function DockStage({ arrangement, motion, children }: DockStageProps): ReactNode {
  const [shown, setShown] = useState(arrangement);

  // Bumped when a transition finishes, so a change that arrived while it ran
  // is drawn next.
  const [finished, setFinished] = useState(0);

  const dock = useRef<StagedDock | undefined>(undefined);
  const latest = useRef(arrangement);
  const running = useRef(false);

  const animated = motion.level !== DockMotionLevel.Off && canTransition();

  // While a transition waits to capture the old dock, the old dock is drawn;
  // otherwise the arrangement given, at once.
  const drawn = arrangement.key === shown.key || !animated ? arrangement : shown;

  // Without a transition the dock is drawn from the arrangement given, and the
  // one shown is kept in step as it changes, so a transition started once the
  // level allows one starts from the dock on screen.
  if (!animated && arrangement.key !== shown.key) setShown(arrangement);

  useLayoutEffect(() => {
    latest.current = arrangement;
    if (arrangement.key === shown.key || !animated) return;
    if (running.current) return;
    running.current = true;
    rebuildInTransition({
      change:
        arrangement.layout.id === shown.layout.id ? DockChange.Arrangement : DockChange.Workspace,
      full: motion.level === DockMotionLevel.Full,
      arriving: arrangement.layout,
      dock: () => dock.current,
      draw: () => {
        flushSync(() => {
          setShown(latest.current);
        });
      },
      finished: () => {
        running.current = false;
        setFinished((count) => count + 1);
      },
    });
  }, [arrangement, shown, animated, motion.level, finished]);

  const attach: AttachDock = useCallback((built) => {
    dock.current = built;
    return () => {
      if (dock.current === built) dock.current = undefined;
    };
  }, []);

  return (
    <DockStageContext.Provider value={attach}>
      <div className="ag-dock-stage">{children(drawn)}</div>
    </DockStageContext.Provider>
  );
}
