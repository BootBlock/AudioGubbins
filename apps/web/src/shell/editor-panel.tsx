/**
 * The Editor panel: one view of an asset (REQ-EDIT-061). Its toolbar, the
 * active selection scope, the waveform surface, the scroll position and what
 * the view is waiting for; or, where it shows no asset, the assets it can open.
 *
 * The surface is a canvas the renderer draws (`editor-surface.ts`), mounted
 * once per panel and fed from the stores, so React draws the controls around
 * it and never a sample or a peak (the packet's rule against a DOM element per
 * sample). It is the view's one focusable region, an application to assistive
 * technology, whose state the toolbar and the readouts beside it say. A right
 * click or a long press on it opens the editor's context actions (REQ-UX-067).
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';

import { Button, ContextActions, useTheme, type MenuGroup } from '@audiogubbins/design-system';
import type { EditorViewState } from '@audiogubbins/editor-view';
import { visibleRange } from '@audiogubbins/timeline';
import type { PeakStatus } from '@audiogubbins/waveform';

import type { EditorAsset } from '../assets/editor-asset.js';
import { EditorSurface } from '../editor/editor-surface.js';
import { editorPaletteOf, editorTypeOf } from '../editor/theme-palette.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import { EditorReadouts, MarkerList } from './editor-readouts.js';
import { EditorToolbar } from './editor-toolbar.js';
import { SelectionScope } from './selection-scope.js';

/** The editor's context actions, each a command run as the menus run it. */
const CONTEXT_GROUPS: readonly (readonly string[])[] = [
  ['transport.play', 'editor.add-marker', 'editor.remove-markers'],
  ['editor.zoom-in', 'editor.zoom-out', 'editor.zoom-to-fit', 'editor.zoom-to-selection'],
  ['editor.select-all', 'editor.clear-selection', 'editor.new-view'],
];

/** What the view's peaks are waiting for, in words, or nothing once they are whole. */
function peaksText(status: PeakStatus | undefined): string | undefined {
  switch (status?.kind) {
    case undefined:
    case 'complete':
      return undefined;
    case 'reading-cache':
      return 'Reading the kept waveform…';
    case 'generating':
      return `Making the waveform: ${String(Math.floor(status.progress * 100))}%`;
    case 'failed':
      return `The waveform could not be made: ${status.reason}`;
  }
}

/** The assets a view can open, as buttons. */
function AssetChooser({
  panel,
  parts,
}: {
  readonly panel: string;
  readonly parts: EditorPanelParts;
}): ReactNode {
  const { assets, problems } = useSyncExternalStore(parts.assets.subscribe, parts.assets.get);
  return (
    <div className="ag-editor-chooser">
      <p>Choose an asset to open in this view.</p>
      <ul className="ag-editor-assets">
        {assets.map((asset) => (
          <li key={asset.id} className="ag-editor-asset">
            <Button
              onClick={() => {
                parts.run('editor.open-asset', { view: panel, asset: asset.id });
              }}
            >
              {asset.name}
            </Button>
            <p className="ag-panel-note">{asset.description}</p>
          </li>
        ))}
      </ul>
      {problems.map((problem) => (
        <p key={problem} className="ag-panel-note" data-ag-status="unavailable">
          {problem}
        </p>
      ))}
    </div>
  );
}

/** The context actions, each entry the command it runs, named with the view. */
function contextGroups(parts: EditorPanelParts, panel: string): readonly MenuGroup[] {
  return CONTEXT_GROUPS.map((ids, index) => ({
    key: String(index),
    items: ids.map((id) => {
      const reason = parts.unavailableReason(id);
      return {
        key: id,
        label: parts.labelFor(id),
        ...(reason === undefined ? {} : { unavailableReason: reason }),
        onSelect: () => {
          parts.run(id, { view: panel });
        },
      };
    }),
  }));
}

/**
 * Mounts the surface in `host` for panel `panel`, once, and hands it the
 * theme's colours as they change: a change of theme reaches its next frame.
 */
function useEditorSurface(
  host: RefObject<HTMLDivElement | null>,
  panel: string,
  parts: EditorPanelParts,
  onPeaks: (status: PeakStatus) => void,
): void {
  const theme = useTheme();
  const look = useRef({ palette: editorPaletteOf(theme), type: editorTypeOf(theme) });
  const surface = useRef<EditorSurface | undefined>(undefined);

  useEffect(() => {
    look.current = { palette: editorPaletteOf(theme), type: editorTypeOf(theme) };
    surface.current?.redraw();
  }, [theme]);

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const made = new EditorSurface({
      host: element,
      panel,
      stores: parts.stores,
      peaks: parts.peaks,
      graphics: parts.graphics,
      look: () => look.current,
      run: (command) => {
        parts.run(command.id, command.args);
      },
      report: (report) => {
        parts.rendererReports.report(panel, report);
      },
      peaksChanged: onPeaks,
      logger: parts.logger,
    });
    surface.current = made;
    return () => {
      made.dispose();
      surface.current = undefined;
      parts.rendererReports.forget(panel);
    };
  }, [host, panel, parts, onPeaks]);
}

/** The waveform surface, mounted once for the panel. */
function Surface({
  panel,
  asset,
  parts,
  onPeaks,
}: {
  readonly panel: string;
  readonly asset: EditorAsset;
  readonly parts: EditorPanelParts;
  readonly onPeaks: (status: PeakStatus) => void;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  useEditorSurface(host, panel, parts, onPeaks);
  return (
    <ContextActions label="Editor actions" groups={contextGroups(parts, panel)}>
      <div
        ref={host}
        className="ag-editor-surface"
        role="application"
        aria-roledescription="waveform editor"
        aria-label={`Waveform of ${asset.name}`}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- an application region takes the keyboard for its own keys, the held space bar among them, so it must be reachable by Tab
        tabIndex={0}
      />
    </ContextActions>
  );
}

/** The scroll position, as a slider over where the view's left edge can be. */
function ScrollPosition({
  panel,
  asset,
  state,
  parts,
}: {
  readonly panel: string;
  readonly asset: EditorAsset;
  readonly state: EditorViewState;
  readonly parts: EditorPanelParts;
}): ReactNode {
  const shown = visibleRange(state.viewport, asset.length);
  return (
    <input
      className="ag-editor-scroll"
      type="range"
      aria-label="Position in the asset"
      min={0}
      max={Math.max(0, asset.length - (shown.end - shown.start))}
      step={1}
      value={shown.start}
      onChange={(event) => {
        parts.run('editor.scroll-to', { view: panel, position: Number(event.target.value) });
      }}
    />
  );
}

/** A view of an asset. */
function EditorView({
  panel,
  title,
  asset,
  state,
  parts,
}: {
  readonly panel: string;
  readonly title: string;
  readonly asset: EditorAsset;
  readonly state: EditorViewState;
  readonly parts: EditorPanelParts;
}): ReactNode {
  const [peaks, setPeaks] = useState<PeakStatus | undefined>(undefined);
  const waiting = peaksText(peaks);
  const selection = parts.stores.selections.of(asset.id);
  return (
    <section className="ag-panel ag-editor">
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-editor-asset-name">{asset.name}</p>
      <p className="ag-panel-note">
        Markers and selections last for this session; keeping them in a project arrives with the
        project system.
      </p>
      <EditorToolbar
        panel={panel}
        asset={asset}
        state={state}
        commands={{ run: parts.run, shortcutFor: parts.shortcutFor }}
      />
      <SelectionScope selection={selection} asset={asset} state={state} />
      <Surface panel={panel} asset={asset} parts={parts} onPeaks={setPeaks} />
      <ScrollPosition panel={panel} asset={asset} state={state} parts={parts} />
      <EditorReadouts asset={asset} state={state} parts={parts} />
      <MarkerList
        panel={panel}
        asset={asset}
        state={state}
        markers={parts.stores.content.of(asset).markers}
        selection={selection}
        parts={parts}
      />
      {waiting !== undefined && <p className="ag-panel-note">{waiting}</p>}
    </section>
  );
}

/** The Editor panel. */
export function EditorPanel({
  panel,
  title,
  parts,
}: {
  readonly panel: string;
  readonly title: string;
  readonly parts: EditorPanelParts;
}): ReactNode {
  // Each reading is this view's own part of its store, so a change to another
  // view, or to another asset, does not render this one again.
  const { stores } = parts;
  const entry = useSyncExternalStore(stores.editorViews.subscribe, () =>
    stores.editorViews.entry(panel),
  );
  useSyncExternalStore(parts.assets.subscribe, parts.assets.get);
  const asset = entry === undefined ? undefined : parts.assets.find(entry.asset);
  useSyncExternalStore(stores.selections.subscribe, () =>
    asset === undefined ? undefined : stores.selections.of(asset.id),
  );
  useSyncExternalStore(stores.content.subscribe, () =>
    asset === undefined ? undefined : stores.content.of(asset),
  );
  useSyncExternalStore(stores.cues.subscribe, () =>
    asset === undefined ? undefined : stores.playhead(asset),
  );
  useSyncExternalStore(stores.audio.subscribe, () =>
    asset === undefined ? false : stores.playing(asset.id),
  );
  if (entry !== undefined && asset !== undefined) {
    return (
      <EditorView panel={panel} title={title} asset={asset} state={entry.state} parts={parts} />
    );
  }
  return (
    <section className="ag-panel ag-editor">
      <h2 className="ag-panel-title">{title}</h2>
      {entry !== undefined && (
        <p className="ag-panel-note">The asset this view showed is not open in this session.</p>
      )}
      <AssetChooser panel={panel} parts={parts} />
    </section>
  );
}
