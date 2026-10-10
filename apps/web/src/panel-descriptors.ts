/**
 * The panels this build has, each with the title its tab, heading and menu
 * entry give it and the region it opens in: the workspace package's own and
 * the application's (`panel-kinds.ts`). The composition root hands the table
 * to the workspace, the shell's commands and the menus, so each reads one.
 */

import {
  DockRegion,
  PanelKinds,
  type PanelDescriptor,
  type PanelKind,
} from '@audiogubbins/workspace';

import { EditingPanelKinds, ModelPanelKinds, ProjectPanelKinds } from './panel-kinds.js';

/**
 * Which panels this build has.
 *
 * The workspace validates a stored layout against this, so a layout naming a
 * panel from a later version falls back to a preset rather than failing to
 * mount (REQ-UX-059).
 */
export const PANEL_DESCRIPTORS = new Map<PanelKind, PanelDescriptor>(
  (
    [
      [PanelKinds.AssetBrowser, 'Assets', DockRegion.Left],
      [PanelKinds.Editor, 'Editor', DockRegion.Centre],
      [PanelKinds.Inspector, 'Inspector', DockRegion.Right],
      [PanelKinds.Transport, 'Transport', DockRegion.Bottom],
      [PanelKinds.Diagnostics, 'Diagnostics', DockRegion.Bottom],
      [PanelKinds.Capabilities, 'Capabilities', DockRegion.Bottom],
      [ProjectPanelKinds.History, 'History', DockRegion.Right],
      [ProjectPanelKinds.Storage, 'Storage', DockRegion.Bottom],
      [PanelKinds.Picture, 'Picture', DockRegion.Right],
      [PanelKinds.Recording, 'Recorder', DockRegion.Bottom],
      [PanelKinds.Spectral, 'Spectral', DockRegion.Right],
      [EditingPanelKinds.Analysis, 'Analysis', DockRegion.Bottom],
      [EditingPanelKinds.Library, 'Library', DockRegion.Left],
      [EditingPanelKinds.Rack, 'Effects rack', DockRegion.Right],
      [ModelPanelKinds.ModelPacks, 'Model packs', DockRegion.Bottom],
    ] as const
  ).map(([kind, title, defaultRegion]) => [
    kind,
    {
      kind,
      title,
      defaultRegion,
      allowsMultiple: kind === PanelKinds.Editor,
      closable: true,
      minimumSize: { width: 200, height: 120 },
    },
  ]),
);
