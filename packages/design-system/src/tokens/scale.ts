/**
 * Spacing, size and typography scales.
 *
 * REQ-UX-071 requires density preferences rather than one compromise layout,
 * and REQ-UX-155 requires touch-target scaling. Those are the same problem: a
 * control sized for a mouse is too small for a finger, and a control sized for
 * a finger wastes a laptop screen.
 *
 * The scales are therefore functions of the density, not constants. A component
 * asks for `space.medium` and gets whatever that means under the current
 * density, so no component holds a number that has to change when the density
 * does.
 *
 * Every value is the design language's (`docs/design/design-language.md`,
 * sections 1 to 4 and 7 to 10), and every box is a multiple of the 2-pixel grid
 * unit. A hairline is the stated exception, so `space.hair` and the meter's gap
 * are 1.
 */

import { Density } from './preferences.js';

/** The base unit every box is a multiple of, in pixels. */
export type GridScale = {
  readonly unit: number;
};

/** Spacing steps, in pixels. */
export type SpacingScale = {
  readonly none: number;

  /** The gap between menu, list and palette rows: a hairline. */
  readonly hair: number;

  /** Tabs in a strip, buttons in a toolbar group, a segmented control's padding. */
  readonly micro: number;

  readonly tiny: number;
  readonly small: number;
  readonly medium: number;
  readonly large: number;
  readonly huge: number;

  /** What a container insets its content by, on every side. */
  readonly inset: number;

  /** The gap between panels, and between a splitter's halves. */
  readonly gutter: number;

  /** A leading padding that clears an edge bar or a glyph. */
  readonly insetLeading: number;

  /** A dialogue's body and footer, the command palette's field. */
  readonly insetWide: number;

  /** A failure card, the focus specimen row. */
  readonly insetFeature: number;
};

/** Corner radii, in pixels. */
export type RadiusScale = {
  readonly none: number;

  /** A template token's wash, a meter's segments, a skeleton line's ends. */
  readonly hairline: number;

  /** A key cap, an inline field, a thumbnail, a tag. */
  readonly small: number;

  /** Every control: button, field, select, tab, menu row, list row, card, well. */
  readonly control: number;

  /** A panel, overlay, notice or banner: a control's radius plus the inset. */
  readonly container: number;

  /** The workspace frame, a failure screen: a container's radius plus the gutter. */
  readonly frame: number;

  /** For a pill or a circular control. */
  readonly full: number;
};

/** Text sizes, in pixels, one per role of the type scale. */
export type TypographyScale = {
  /** A failure screen's title. */
  readonly display: number;

  /** A dialogue's title, a panel's subject, an empty state's title, the palette's field. */
  readonly heading: number;

  /** Running text, a menu row, a field's value, a control's own label. */
  readonly body: number;

  /** Supporting text: a sub-line, a unit, a note, a field's error, the status bar. */
  readonly label: number;

  /** A group title, a table's head, a shortcut. */
  readonly caption: number;

  /** The transport's time readout, in the numeric family. */
  readonly readout: number;

  /** A meter's and the frequency axis's printed scale. */
  readonly scale: number;

  /** The ruler's labels. */
  readonly ruler: number;
};

/** Control sizes, in pixels. */
export type ControlScale = {
  /**
   * Height of every control of one line: button, field, select, tab, menu row.
   * A smaller variant is stated by its control as a `calc()` of this.
   */
  readonly height: number;

  /** A list row of two lines. */
  readonly rowHeight: number;

  /** An icon inside a control, a menu row, a tab, a list row or a toolbar. */
  readonly iconSize: number;

  /**
   * The smallest square a pointer must be able to hit.
   *
   * A visually small control still carries a hit area of at least this, because
   * WCAG 2.2 asks for 24 pixels and a finger needs more. The gap between the
   * drawn control and its hit area is invisible and is what makes a dense
   * toolbar usable on a tablet (REQ-UX-067).
   */
  readonly minimumTouchTarget: number;

  /**
   * The least size a text input's text is drawn at where a finger is among the
   * inputs. Safari on an iPhone zooms the page into a field drawn smaller as it
   * takes focus, and leaves it zoomed, with the surface round it partly off
   * the screen; the page keeps zoom for the reader, so the field grows instead.
   */
  readonly minimumTouchText: number;
};

/** Icon sizes outside a control, in pixels, and the one stroke. */
export type IconScale = {
  /**
   * The stroke, in units of the icon's 24-unit grid rather than pixels, so it
   * scales with the icon and every size draws the same weight of line.
   */
  readonly stroke: number;

  /** A badge, a stepper's chevrons, a scope chip. */
  readonly sizeSmall: number;

  /** An icon set in label text: a status item, a section header, a hint. */
  readonly sizeInline: number;

  /** The play glyph, the palette's search glyph, a drop target's preview. */
  readonly sizeFeature: number;

  /** An empty state's or failure screen's mark. */
  readonly sizeMark: number;
};

/** The shell's bars, in pixels. */
export type ShellScale = {
  /** The top bar: a control's height and an inset above and below it. */
  readonly topBarBlockSize: number;

  readonly transportBlockSize: number;
};

/** The status bar's strip, in pixels. */
export type StatusBarScale = {
  readonly blockSize: number;
};

/** The keyboard focus ring, in pixels. */
export type FocusScale = {
  readonly ringWidth: number;

  /** The gap between a control's edge and its ring. */
  readonly ringOffset: number;

  /**
   * How far the ring reaches past an element's edge: its width and its offset.
   * A container that scrolls pads by this, or the ring loses its edges.
   */
  readonly ringReach: number;
};

/** The hardware controls' sizes, in pixels. */
export type HardwareScale = {
  readonly knobSize: number;
  readonly switchWidth: number;
  readonly switchHeight: number;

  /** A lit segment of a horizontal level meter. */
  readonly meterSegment: number;

  /** The gap between two segments: a hairline. */
  readonly meterGap: number;
};

/** The editing display's strips, in pixels. */
export type DisplayScale = {
  readonly rulerHeight: number;
  readonly regionLaneHeight: number;
  readonly overviewHeight: number;
};

/** An empty, loading or error state's parts, in pixels. */
export type StateScale = {
  /** The circle holding an empty or error state's glyph. */
  readonly markSize: number;
};

/** Everything the layout depends on, for one density. */
export interface Metrics {
  readonly grid: GridScale;
  readonly space: SpacingScale;
  readonly radius: RadiusScale;
  readonly text: TypographyScale;
  readonly control: ControlScale;
  readonly icon: IconScale;
  readonly shell: ShellScale;
  readonly statusBar: StatusBarScale;
  readonly focus: FocusScale;
  readonly hardware: HardwareScale;
  readonly display: DisplayScale;
  readonly state: StateScale;
}

const GRID: GridScale = { unit: 2 };

/** The same in both densities: an icon outside a control is read at one size. */
const ICONS: IconScale = {
  stroke: 1.75,
  sizeSmall: 12,
  sizeInline: 14,
  sizeFeature: 20,
  sizeMark: 24,
};

/**
 * The ring is drawn as a band of shadow rather than as an outline, so it is
 * painted at its declared width at every scale and needs no allowance for an
 * engine that rounds an outline down (`tokens.css`).
 */
const FOCUS: FocusScale = { ringWidth: 2, ringOffset: 2, ringReach: 4 };

/**
 * The radii that nest, derived rather than written: a container's corner is its
 * content's corner plus the inset between them, and the frame's is the
 * container's plus the gutter, so a change to one keeps the corners concentric.
 */
function nestedRadii(space: SpacingScale, control: number): RadiusScale {
  const container = control + space.inset;
  return {
    none: 0,
    hairline: 2,
    small: 4,
    control,
    container,
    frame: container + space.gutter,
    full: 9999,
  };
}

const COMFORTABLE_SPACE: SpacingScale = {
  none: 0,
  hair: 1,
  micro: 2,
  tiny: 4,
  small: 6,
  medium: 10,
  large: 14,
  huge: 28,
  inset: 8,
  gutter: 8,
  insetLeading: 12,
  insetWide: 16,
  insetFeature: 24,
};

const COMPACT_SPACE: SpacingScale = {
  none: 0,
  hair: 1,
  micro: 2,
  tiny: 2,
  small: 6,
  medium: 8,
  large: 14,
  huge: 22,
  inset: 6,
  gutter: 6,
  insetLeading: 10,
  insetWide: 12,
  insetFeature: 18,
};

const COMFORTABLE_CONTROL: ControlScale = {
  height: 28,
  rowHeight: 44,
  iconSize: 16,
  minimumTouchTarget: 44,
  minimumTouchText: 16,
};

// The drawn control shrinks; the hit area does not. REQ-UX-067 requires touch
// to keep working, and a user who chose a dense workspace on a tablet has not
// asked for controls they cannot hit. The compact height is 24 and no less: a
// row in a menu or a list cannot widen its hit area past its neighbours, so
// what it draws is what a mouse user hits, and WCAG 2.5.8 sets 24 pixels as the
// least a target may be.
const COMPACT_CONTROL: ControlScale = {
  height: 24,
  rowHeight: 36,
  iconSize: 14,
  minimumTouchTarget: 44,
  minimumTouchText: 16,
};

const COMFORTABLE: Metrics = {
  grid: GRID,
  space: COMFORTABLE_SPACE,
  radius: nestedRadii(COMFORTABLE_SPACE, 8),
  text: {
    display: 20,
    heading: 15,
    body: 13,
    label: 12,
    caption: 11,
    readout: 26,
    scale: 9,
    ruler: 10,
  },
  control: COMFORTABLE_CONTROL,
  icon: ICONS,
  shell: {
    topBarBlockSize: COMFORTABLE_CONTROL.height + 2 * COMFORTABLE_SPACE.inset,
    transportBlockSize: 56,
  },
  statusBar: { blockSize: 34 },
  focus: FOCUS,
  hardware: { knobSize: 52, switchWidth: 38, switchHeight: 22, meterSegment: 4, meterGap: 1 },
  display: { rulerHeight: 26, regionLaneHeight: 20, overviewHeight: 22 },
  state: { markSize: 52 },
};

const COMPACT: Metrics = {
  grid: GRID,
  space: COMPACT_SPACE,
  radius: nestedRadii(COMPACT_SPACE, 6),
  text: {
    display: 20,
    heading: 13,
    body: 12,
    label: 11,
    caption: 10,
    readout: 20,
    scale: 9,
    ruler: 9,
  },
  control: COMPACT_CONTROL,
  icon: ICONS,
  shell: {
    topBarBlockSize: COMPACT_CONTROL.height + 2 * COMPACT_SPACE.inset,
    transportBlockSize: 46,
  },
  statusBar: { blockSize: 30 },
  focus: FOCUS,
  hardware: { knobSize: 44, switchWidth: 32, switchHeight: 20, meterSegment: 4, meterGap: 1 },
  display: { rulerHeight: 22, regionLaneHeight: 16, overviewHeight: 22 },
  state: { markSize: 52 },
};

/** The metrics for a density. */
export function metricsFor(density: Density): Metrics {
  return density === Density.Compact ? COMPACT : COMFORTABLE;
}
