/**
 * The specimens of the shared components no component group owns: `Icon`,
 * every glyph of its vocabulary at each size of the icon scale, and
 * `VisuallyHidden`, which must draw nothing.
 *
 * The glyphs are listed from the vocabulary itself, so a glyph added to it is
 * in the inventory, and in its capture, without this file changing.
 */

import { Icon, IconSize, VisuallyHidden, type IconName } from '@audiogubbins/design-system';

import { ICON_GLYPHS } from '../../../../../packages/design-system/src/icons/vocabulary.js';
import type { Specimen } from '../specimen.js';
import './foundation.specimens.css';

/** Whether a key of the glyph map names an icon, which every key does. */
function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICON_GLYPHS, name);
}

/** Every icon of the vocabulary, in the order the vocabulary lists them. */
const ICON_NAMES: readonly IconName[] = Object.keys(ICON_GLYPHS).filter(isIconName);

/** Every glyph at one size, each named under it. */
function glyphSheet(size: IconSize) {
  return (
    <ul className="inventory-glyphs">
      {ICON_NAMES.map((name) => (
        <li key={name} className="inventory-glyph">
          <Icon name={name} size={size} />
          <span className="inventory-glyph-name">{name}</span>
        </li>
      ))}
    </ul>
  );
}

const iconSpecimens: readonly Specimen[] = Object.values(IconSize).map((size) => ({
  component: 'Icon',
  state: size,
  render: () => glyphSheet(size),
}));

const specimens: readonly Specimen[] = [
  ...iconSpecimens,
  {
    component: 'VisuallyHidden',
    state: 'default',
    // The words either side are drawn, one space apart; the hidden sentence
    // between them must leave no ink and no gap of its own.
    render: () => (
      <p className="inventory-hidden-text">
        Before <VisuallyHidden>This sentence is for a screen reader alone.</VisuallyHidden>
        after
      </p>
    ),
  },
];

export default specimens;
