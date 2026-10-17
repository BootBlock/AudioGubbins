/**
 * What the dock draws of its own besides the engine's chrome: the glyph of a
 * panel, which its tab shows beside its title, and the drop guide over each
 * group while a tab is dragged (design language, "Dock chrome").
 *
 * Written against the shape of the engine it reads, as only the adapter may
 * name the engine; the engine's own interface is one.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { PanelKind } from '../panel.js';
import { kindOf } from './panel-parameters.js';

/**
 * Draws the glyph of a kind of panel, which its tab and the landing area of a
 * drag show beside its title (design language, sections 10 and 11).
 *
 * Given by the application, which reaches the icon set through the design
 * system; this package names no icon. A glyph is decoration beside the title,
 * which is what the tab is named, so it is hidden from assistive technology.
 */
export type PanelGlyph = (kind: PanelKind) => ReactNode;

/** The glyph drawer the dock was given, which every tab and drop guide reads. */
export const PanelGlyphContext = createContext<PanelGlyph | undefined>(undefined);

/** A subscription to one of the engine's events, until it is disposed. */
interface Subscription {
  dispose(): void;
}

/** One of the engine's panels, as a drag carries it. */
interface CarriedPanel {
  readonly id: string;
  readonly params?: unknown;
  readonly title?: string | undefined;
}

/** One of the engine's groups, as the guide is drawn in it. */
interface GuidedGroup {
  readonly id: string;
  readonly element: HTMLElement;
  readonly activePanel?: CarriedPanel | undefined;
}

/** The part of the engine the drop guides read. */
export interface GuidedEngine {
  readonly groups: readonly GuidedGroup[];
  onDidAddGroup(listener: () => void): Subscription;
  onDidRemoveGroup(listener: () => void): Subscription;
  onWillDragPanel(listener: (event: { readonly panel: CarriedPanel }) => void): Subscription;
  onWillDragGroup(listener: (event: { readonly group: GuidedGroup }) => void): Subscription;
}

/** The panel being dragged, for the landing area to name. */
interface DraggedPanel {
  readonly kind: string;
  readonly title: string;
}

/** The panel a drag carries, by its kind and its title. */
function carried(panel: CarriedPanel | undefined): DraggedPanel | undefined {
  return panel === undefined
    ? undefined
    : { kind: kindOf(panel.params) ?? panel.id, title: panel.title ?? panel.id };
}

/** The five places a drop on a group's contents can put the panel. */
const DROP_ZONES = ['top', 'left', 'centre', 'right', 'bottom'] as const;

/**
 * What the dock draws over a group while a tab is dragged across it: the
 * compass of its drop targets, each drawn as the group it would make, and the
 * dragged panel's glyph and title, which the landing area shows.
 *
 * Which target is lit, and whether any is shown, is the engine's own state,
 * read by the workspace stylesheet from the drop overlay the engine draws, so
 * this marks out what the engine does and decides nothing: the drop lands
 * where the engine's own reading of the pointer puts it, whether or not the
 * pointer is over the compass. Hidden from assistive technology, as the
 * engine's overlay is: a drag is a pointer's; the keyboard moves a panel by
 * command.
 */
function DropGuide({ dragged }: { readonly dragged: DraggedPanel | undefined }): ReactNode {
  const glyph = useContext(PanelGlyphContext);
  return (
    <div className="ag-dock-drop-guide" aria-hidden="true">
      <div className="ag-dock-compass">
        {DROP_ZONES.map((zone) => (
          <span key={zone} className="ag-dock-compass-cell" data-zone={zone}>
            <span className="ag-dock-compass-diagram">
              <span className="ag-dock-compass-part" />
            </span>
          </span>
        ))}
      </div>
      {dragged !== undefined && (
        <div className="ag-dock-landing-label">
          {glyph?.(dragged.kind)}
          <span>{dragged.title}</span>
        </div>
      )}
    </div>
  );
}

/**
 * A drop guide in every group the engine holds, following the groups as they
 * come and go, each naming the panel the drag under way carries.
 */
export function DropGuides({ engine }: { readonly engine: GuidedEngine }): ReactNode {
  const [groups, setGroups] = useState<readonly GuidedGroup[]>(() => [...engine.groups]);
  const [dragged, setDragged] = useState<DraggedPanel | undefined>(undefined);

  useEffect(() => {
    const publish = (): void => {
      setGroups([...engine.groups]);
    };
    publish();
    const subscriptions = [
      engine.onDidAddGroup(publish),
      engine.onDidRemoveGroup(publish),
      engine.onWillDragPanel((event) => {
        setDragged(carried(event.panel));
      }),
      engine.onWillDragGroup((event) => {
        setDragged(carried(event.group.activePanel));
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.dispose();
    };
  }, [engine]);

  return groups.map((group) =>
    createPortal(<DropGuide dragged={dragged} />, group.element, group.id),
  );
}
