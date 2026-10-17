/**
 * The faces the interface is set in, and the parts of the type scale that do
 * not change with the density: weights, line heights and tracking.
 *
 * ADR-0108: Inter for every word and JetBrains Mono for every time, level and
 * frequency readout, both variable fonts the application ships itself. Each
 * family names its fallback after it, of the same metrics class, so a face that
 * fails to load changes no layout beyond the type scale's tolerance and never
 * falls through to the browser's serif default.
 */

/** The font families, as CSS `font-family` values. */
export type FontFamilies = {
  /** Every word of the interface. */
  readonly ui: string;

  /** Every time, level, frequency, count and shortcut. */
  readonly numeric: string;

  /**
   * The OpenType features the interface's text is set with, as a CSS
   * `font-feature-settings` value: Inter's single-storey a and open digits.
   */
  readonly features: string;
};

/** Font weights, one per use the language names. */
export type FontWeights = {
  readonly regular: number;

  /** A summary, a readout's sub-line. */
  readonly quiet: number;

  readonly medium: number;

  /** A control's own label: a button, a tab, a list row's name. */
  readonly control: number;

  readonly strong: number;
  readonly heading: number;

  /** The fader's unity label, the A and B letters. */
  readonly bold: number;
};

/** Line heights, as multiples of the text size. */
export type LineHeights = {
  /** Wrapped running and supporting text. */
  readonly body: number;

  /** A reason under a menu row, a table's verdict, a caption. */
  readonly tight: number;

  readonly heading: number;
  readonly readout: number;
};

/** Letter spacing, in ems. */
export type Tracking = {
  /** Display and heading text. */
  readonly tight: number;

  /** The transport's readout. */
  readonly readout: number;

  /** A caption set in upper case. */
  readonly caps: number;
};

/** Everything about the type that is the same at every density. */
export interface Typeface {
  readonly family: FontFamilies;
  readonly weight: FontWeights;
  readonly lineHeight: LineHeights;
  readonly tracking: Tracking;

  /**
   * The size of a number set inline in other text, as a multiple of the text
   * around it: the monospaced family draws larger than Inter at one size.
   */
  readonly numericRatio: number;
}

/** The faces the self-hosted font packages declare (`styles/tokens.css`). */
export const TYPEFACE: Typeface = {
  family: {
    ui: "'Inter Variable', system-ui, sans-serif",
    numeric: "'JetBrains Mono Variable', ui-monospace, monospace",
    features: "'cv11', 'ss01'",
  },
  weight: {
    regular: 400,
    quiet: 450,
    medium: 500,
    control: 550,
    strong: 600,
    heading: 650,
    bold: 700,
  },
  lineHeight: { body: 1.45, tight: 1.35, heading: 1.25, readout: 1.05 },
  tracking: { tight: -0.01, readout: -0.02, caps: 0.06 },
  numericRatio: 0.95,
};
