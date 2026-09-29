/**
 * The colours a view draws with, and the font it writes in. The application
 * fills them from the theme's tokens (REQ-UX-155, ADR-0012), so a view has no
 * colour of its own and follows a change of theme on its next frame.
 */

import type { Colour } from '@audiogubbins/renderer';

export interface EditorPalette {
  readonly background: Colour;
  readonly laneSeparator: Colour;
  readonly centreLine: Colour;
  readonly peak: Colour;
  readonly rms: Colour;
  readonly clipped: Colour;
  /** Where peaks are not yet known. */
  readonly pending: Colour;
  readonly grid: Colour;
  readonly rulerBackground: Colour;
  readonly rulerTick: Colour;
  /** The ruler's labels, on its own background. */
  readonly rulerText: Colour;
  /** Names written on the display: a marker's, a region's. */
  readonly text: Colour;
  /** Supporting text on the display: a channel's name, a frequency, a note. */
  readonly quietText: Colour;
  readonly selectionFill: Colour;
  /** A kept selection that is not the active facet. */
  readonly inactiveSelectionFill: Colour;
  readonly selectionBorder: Colour;
  readonly playhead: Colour;
  readonly marker: Colour;
  readonly selectedMarker: Colour;
  readonly region: Colour;
  readonly loop: Colour;
  readonly snap: Colour;
  readonly spectrogramBackground: Colour;
}

/** The font a view writes labels in, as a CSS font shorthand. */
export interface EditorType {
  readonly label: string;
  readonly small: string;
}
