/**
 * The icon: one glyph of the vocabulary, drawn in its grid and centred by its
 * ink.
 *
 * Every icon in AudioGubbins is one of these (ADR-0108), so the set, the
 * stroke, the sizes and the centring are decided once. The size and the stroke
 * come from the tokens through the `ag-icon` classes alone: the stroke is set
 * in grid units, so it scales with the icon and is never a pixel width.
 */

import { createElement } from 'react';

import { ICON_GLYPHS, type IconName } from './vocabulary.js';

/** The sizes of the design language's icon scale. */
export const IconSize = {
  /** A badge, a stepper's chevrons, a scope chip, a chain arrow. */
  Small: 'small',

  /** An icon set in label text: a status item, a section header, a hint, a field's error. */
  Inline: 'inline',

  /** Every icon in a control, menu row, tab, list row and toolbar. */
  Control: 'control',

  /** The play glyph, the palette's search glyph, a drop target's preview, a profile card. */
  Feature: 'feature',

  /** An empty state's or a failure screen's mark. */
  Mark: 'mark',
} as const;

/** The sizes of the design language's icon scale. */
export type IconSize = (typeof IconSize)[keyof typeof IconSize];

/** What an icon takes. */
export interface IconProps {
  readonly name: IconName;
  readonly size?: IconSize;

  /**
   * What the icon means, for a screen reader.
   *
   * Given only where the icon says something its surroundings do not: a status
   * told by a glyph alone. An icon beside a label, or inside a button that
   * names itself, is decoration, and is hidden from assistive technology so it
   * is not announced twice.
   */
  readonly label?: string;

  readonly className?: string;
}

/** The icon. */
export function Icon({ name, size = IconSize.Control, label, className }: IconProps) {
  const glyph = ICON_GLYPHS[name];
  const classes = ['ag-icon', `ag-icon-${size}`, className].filter(Boolean).join(' ');
  const naming =
    label === undefined
      ? ({ 'aria-hidden': true, focusable: 'false' } as const)
      : ({ role: 'img', 'aria-label': label } as const);

  return (
    <svg
      {...naming}
      className={classes}
      viewBox="0 0 24 24"
      fill={glyph.filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={name}
    >
      <g transform={`translate(${String(glyph.offset.x)} ${String(glyph.offset.y)})`}>
        {glyph.elements.map(([tag, { key, ...attributes }], index) =>
          createElement(tag, { ...attributes, key: key ?? index }),
        )}
      </g>
    </svg>
  );
}
