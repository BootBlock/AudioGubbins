/**
 * The glyph of each kind of panel: the one its tab shows beside its title, the
 * landing area of a drag beside its name, and the command that shows it in the
 * menus and the palette (design language, sections 10 and 11). One table, so a
 * panel is drawn with the same glyph wherever it appears.
 */

import { Icon, type IconName } from '@audiogubbins/design-system';
import { PanelKinds, type PanelKind, type PanelGlyph } from '@audiogubbins/workspace';

import { EditingPanelKinds, ModelPanelKinds, ProjectPanelKinds } from '../panel-kinds.js';

/**
 * Each kind of panel's glyph, in the icon vocabulary's own words; the command
 * that shows a panel takes the same one (`command-glyphs.ts`).
 */
export const PANEL_GLYPHS: ReadonlyMap<PanelKind, IconName> = new Map<PanelKind, IconName>([
  [PanelKinds.AssetBrowser, 'assets'],
  [PanelKinds.Inspector, 'inspector'],
  [PanelKinds.Editor, 'waveform'],
  [PanelKinds.Transport, 'transport'],
  [PanelKinds.Diagnostics, 'diagnostics'],
  [PanelKinds.Capabilities, 'capabilities'],
  [PanelKinds.Picture, 'picture'],
  [PanelKinds.Recording, 'recorder'],
  [PanelKinds.Spectral, 'spectral'],
  [PanelKinds.GameGroups, 'asset-groups'],
  [PanelKinds.LoopEditor, 'loop'],
  [PanelKinds.GamePreview, 'game-preview'],
  [ProjectPanelKinds.History, 'history'],
  [ProjectPanelKinds.Storage, 'storage'],
  [EditingPanelKinds.Analysis, 'analysis'],
  [EditingPanelKinds.Library, 'library'],
  [EditingPanelKinds.Rack, 'effects-rack'],
  [ModelPanelKinds.ModelPacks, 'model-packs'],
]);

/**
 * Draws a panel's glyph, or nothing for a kind with none, such as a panel
 * kept in a stored workspace whose kind this version does not know.
 */
export const panelGlyph: PanelGlyph = (kind) => {
  const name = PANEL_GLYPHS.get(kind);
  return name === undefined ? null : <Icon name={name} />;
};
