/**
 * The Editor panel's display: the waveform surface the renderer draws, mounted
 * once per panel and fed from the stores, so React draws the controls around
 * it and never a sample or a peak; the context actions a right click or a
 * long press opens on it (REQ-UX-067); and what the view's peaks and
 * spectrogram are waiting for, said beside it.
 *
 * The surface is the view's one focusable region, an application to assistive
 * technology, described by the readings beside it.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import {
  ContextActions,
  useTheme,
  type ContextActionsOpener,
  type MenuGroup,
} from '@audiogubbins/design-system';
import { KEYBOARD_HOME } from '@audiogubbins/workspace';
import type { PeakStatus } from '@audiogubbins/waveform';
import type { SpectrogramStatus } from '@audiogubbins/spectral-analysis';

import type { EditorAsset } from '../assets/editor-asset.js';
import { EditorSurface } from '../editor/editor-surface.js';
import { editorPaletteOf, editorTypeOf } from '../editor/theme-palette.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import { PeaksNote } from './peaks-note.js';
import { SpectrogramNote } from './spectrogram-note.js';

/** The editor's context actions, each a command run as the menus run it. */
const CONTEXT_GROUPS: readonly (readonly string[])[] = [
  ['transport.play', 'editor.add-marker', 'editor.remove-markers'],
  ['editor.zoom-in', 'editor.zoom-out', 'editor.zoom-to-fit', 'editor.zoom-to-selection'],
  ['editor.select-all', 'editor.clear-selection', 'editor.new-view'],
];

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

/** Where the view's peaks and spectrogram are told to, which the panel says beside the canvas. */
interface SurfaceStatus {
  readonly onPeaks: (status: PeakStatus) => void;
  readonly onSpectrogram: (status: SpectrogramStatus | undefined) => void;
}

/**
 * Mounts the surface in `host` for panel `panel`, once, and hands it the
 * theme's colours as they change: a change of theme reaches its next frame.
 *
 * A press it recognises as held still opens the context actions through
 * `actions`.
 */
function useEditorSurface(
  host: RefObject<HTMLDivElement | null>,
  panel: string,
  parts: EditorPanelParts,
  { onPeaks, onSpectrogram }: SurfaceStatus,
  actions: RefObject<ContextActionsOpener | null>,
): void {
  const theme = useTheme();
  const look = useRef({ palette: editorPaletteOf(theme, parts.logger), type: editorTypeOf(theme) });
  const surface = useRef<EditorSurface | undefined>(undefined);

  useEffect(() => {
    look.current = { palette: editorPaletteOf(theme, parts.logger), type: editorTypeOf(theme) };
    surface.current?.redraw();
  }, [theme, parts.logger]);

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const made = new EditorSurface({
      host: element,
      panel,
      stores: parts.stores,
      peaks: parts.peaks,
      spectrograms: parts.spectrograms,
      graphics: parts.graphics,
      look: () => look.current,
      run: (command) => {
        parts.run(command.id, command.args);
      },
      report: (report) => {
        parts.rendererReports.report(panel, report);
      },
      peaksChanged: onPeaks,
      spectrogramChanged: onSpectrogram,
      contextActions: (clientX, clientY) => {
        actions.current?.openAt(clientX, clientY);
      },
      logger: parts.logger,
    });
    surface.current = made;
    return () => {
      made.dispose();
      surface.current = undefined;
      parts.rendererReports.forget(panel);
    };
  }, [host, panel, parts, onPeaks, onSpectrogram, actions]);
}

/** The waveform surface, mounted once for the panel in `host`, and described by `describedBy`. */
function Surface({
  host,
  describedBy,
  panel,
  asset,
  parts,
  status,
}: {
  readonly host: RefObject<HTMLDivElement | null>;
  readonly describedBy: string;
  readonly panel: string;
  readonly asset: EditorAsset;
  readonly parts: EditorPanelParts;
  readonly status: SurfaceStatus;
}): ReactNode {
  const actions = useRef<ContextActionsOpener>(null);
  useEditorSurface(host, panel, parts, status, actions);
  return (
    <ContextActions label="Editor actions" groups={contextGroups(parts, panel)} opener={actions}>
      <div
        ref={host}
        className="ag-editor-surface"
        role="application"
        aria-roledescription="waveform editor"
        aria-label={`Waveform of ${asset.name}`}
        aria-describedby={describedBy}
        // Where the keyboard goes when a command makes this view the one in
        // use: the arrow keys are the surface's own, and nowhere else's.
        {...{ [KEYBOARD_HOME]: '' }}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- an application region takes the keyboard for its own keys, the held space bar among them, so it must be reachable by Tab
        tabIndex={0}
      />
    </ContextActions>
  );
}

/**
 * The display of panel `panel`: the spectrogram's failure above it, and the
 * surface with the waveform's progress, or its failure, drawn over it.
 */
export function EditorDisplay({
  host,
  describedBy,
  panel,
  asset,
  parts,
}: {
  readonly host: RefObject<HTMLDivElement | null>;
  readonly describedBy: string;
  readonly panel: string;
  readonly asset: EditorAsset;
  readonly parts: EditorPanelParts;
}): ReactNode {
  const [peaks, setPeaks] = useState<PeakStatus | undefined>(undefined);
  const [spectrogram, setSpectrogram] = useState<SpectrogramStatus | undefined>(undefined);
  // One value for the surface's life: a new one would mount the surface again.
  const status = useMemo<SurfaceStatus>(
    () => ({ onPeaks: setPeaks, onSpectrogram: setSpectrogram }),
    [],
  );
  return (
    <>
      <SpectrogramNote status={spectrogram} />
      <div className="ag-editor-display">
        <Surface
          host={host}
          describedBy={describedBy}
          panel={panel}
          asset={asset}
          parts={parts}
          status={status}
        />
        <PeaksNote status={peaks} />
      </div>
    </>
  );
}
