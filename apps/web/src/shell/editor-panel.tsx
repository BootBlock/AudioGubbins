/**
 * The Editor panel: one view of an asset (REQ-EDIT-061). Its toolbar, the
 * active selection scope, the waveform surface, the scroll position, what the
 * view is waiting for and why its spectrogram is not drawn; or, where it shows
 * no asset, the assets it can open.
 *
 * The surface is a canvas the renderer draws (`editor-surface.ts`), mounted
 * once per panel and fed from the stores, so React draws the controls around
 * it and never a sample or a peak (the packet's rule against a DOM element per
 * sample). It is the view's one focusable region, an application to assistive
 * technology, whose state the toolbar and the readouts beside it say. A right
 * click or a long press on it opens the editor's context actions (REQ-UX-067).
 * The panel marks itself as an editor's, where the clipboard keys copy and
 * paste audio rather than the page's text.
 *
 * Laid out as the design language's panel composition (section 11): the
 * toolbar in one row, the scope under it, the display reaching the panel's
 * bottom inset with the waveform's progress over its bottom trailing corner,
 * and the readings and markers in a quiet row beneath. With no asset shown,
 * the panel's empty state offers the assets it can open.
 */

import { useId, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { Banner, BannerTone } from '@audiogubbins/design-system';
import type { EditorViewState } from '@audiogubbins/editor-view';

import type { EditorAsset } from '../assets/editor-asset.js';
import { EDITOR_PANEL } from '../input/use-shortcuts.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import { AssetChooser } from './editor-panel-chooser.js';
import { EditorDisplay } from './editor-panel-display.js';
import { ScrollPosition } from './editor-panel-scroll.js';
import { EditorReadouts, MarkerList } from './editor-readouts.js';
import { EditorToolbar } from './editor-toolbar.js';
import { SelectionScope } from './selection-scope.js';

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
  const surface = useRef<HTMLDivElement>(null);
  const readings = useId();
  const selection = parts.stores.selections.of(asset.id);
  return (
    <section className="ag-panel ag-editor" {...{ [EDITOR_PANEL]: '' }}>
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-editor-asset-name">{asset.name}</p>
      {asset.owner.kind === 'session' && (
        <Banner tone={BannerTone.Information} icon="read-only">
          {asset.owner.reason}
        </Banner>
      )}
      <EditorToolbar
        panel={panel}
        asset={asset}
        state={state}
        commands={{ run: parts.run, shortcutFor: parts.shortcutFor, labelFor: parts.labelFor }}
      />
      <SelectionScope selection={selection} asset={asset} state={state} />
      <EditorDisplay
        host={surface}
        describedBy={readings}
        panel={panel}
        asset={asset}
        parts={parts}
      />
      <ScrollPosition panel={panel} asset={asset} state={state} parts={parts} />
      <div className="ag-editor-footer">
        <EditorReadouts id={readings} surface={surface} asset={asset} state={state} parts={parts} />
        <MarkerList
          panel={panel}
          asset={asset}
          state={state}
          markers={asset.markers}
          selection={selection}
          parts={parts}
        />
      </div>
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
  useSyncExternalStore(stores.cues.subscribe, () =>
    asset === undefined ? undefined : stores.playhead(asset),
  );
  useSyncExternalStore(stores.audio.subscribe, () =>
    asset === undefined ? false : stores.playing(asset.id),
  );
  const unopened = entry === undefined ? undefined : parts.assets.get().unopened.get(entry.asset);
  if (entry !== undefined && asset !== undefined) {
    return (
      <EditorView panel={panel} title={title} asset={asset} state={entry.state} parts={parts} />
    );
  }
  return (
    <section className="ag-panel ag-editor" {...{ [EDITOR_PANEL]: '' }}>
      <h2 className="ag-panel-title">{title}</h2>
      {unopened !== undefined && (
        <div role="status">
          <Banner tone={BannerTone.Warning} icon="unavailable">
            {`${unopened.name} cannot be shown yet. ${unopened.reason}`}
          </Banner>
        </div>
      )}
      {entry !== undefined && unopened === undefined && (
        <Banner tone={BannerTone.Information} icon="information">
          The asset this view showed is not open in this session.
        </Banner>
      )}
      <AssetChooser panel={panel} parts={parts} />
    </section>
  );
}
