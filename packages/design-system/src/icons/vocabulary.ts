/**
 * The icon vocabulary: every icon AudioGubbins draws, named in its own words.
 *
 * A feature names an icon by what it means here (`close`, `fade-in`,
 * `check-fails`), never by the glyph that draws it, so a glyph can be changed
 * in one place, and two meanings that share a glyph today can part tomorrow.
 * The names are this map's keys, so a name with no glyph is a type error rather
 * than a blank square at runtime. Each glyph is measured and placed as the map
 * is built, once, when the module loads.
 *
 * The geometry comes from Lucide's per-glyph modules, one static import each,
 * which keeps the bundle to the glyphs named here; the glyphs Lucide lacks
 * are drawn beside this module in the same node data. The map is joined from
 * its parts, one module per area of the application. The knob, meter and
 * spectrogram glyphs are still to be drawn, and nothing stands in for them.
 */

import { AUDIO_ICONS } from './audio-icons.js';
import { PANEL_ICONS } from './panel-icons.js';
import type { PlacedGlyph } from './placed-glyph.js';
import { PROJECT_ICONS } from './project-icons.js';
import { SHELL_ICONS } from './shell-icons.js';

/**
 * The names two parts share. A name in two parts would let one glyph silently
 * replace the other when the parts are joined, where one map refused it as a
 * duplicate key; this keeps that refusal: `NoNameShared` fails to compile
 * unless the parts share no name.
 */
type Shared<A, B> = keyof A & keyof B;
type Nothing<T extends never> = T;
export type NoNameShared = [
  Nothing<Shared<typeof SHELL_ICONS, typeof AUDIO_ICONS>>,
  Nothing<Shared<typeof SHELL_ICONS, typeof PANEL_ICONS>>,
  Nothing<Shared<typeof SHELL_ICONS, typeof PROJECT_ICONS>>,
  Nothing<Shared<typeof AUDIO_ICONS, typeof PANEL_ICONS>>,
  Nothing<Shared<typeof AUDIO_ICONS, typeof PROJECT_ICONS>>,
  Nothing<Shared<typeof PANEL_ICONS, typeof PROJECT_ICONS>>,
];
const VOCABULARY = {
  ...SHELL_ICONS,
  ...AUDIO_ICONS,
  ...PANEL_ICONS,
  ...PROJECT_ICONS,
} as const;

/** The name of an icon AudioGubbins draws. */
export type IconName = keyof typeof VOCABULARY;

/** Every icon's glyph, measured and placed. */
export const ICON_GLYPHS: Readonly<Record<IconName, PlacedGlyph>> = VOCABULARY;
