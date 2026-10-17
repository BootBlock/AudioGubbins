/**
 * A status LED: a small lamp of a state's colour with its glow, or unlit
 * (design language, section 10, "Status LED"), as a capability row or a
 * model pack leads with its state.
 *
 * A colour says nothing to a reader who cannot see it, or in forced colours,
 * so an LED is either beside words that say its state, and hidden from a
 * screen reader, or names the state itself.
 */

import type { ReactNode } from 'react';

/** What an LED says. */
export const LedTone = {
  /** Working: the success colour. */
  Success: 'success',

  /** Working, reduced: the warning colour. */
  Warning: 'warning',

  /** Not working: the error colour. */
  Error: 'error',

  /** Active or chosen: the accent. */
  Accent: 'accent',

  /** Not in use: unlit, with no glow. */
  Idle: 'idle',
} as const;

/** What an LED says. */
export type LedTone = (typeof LedTone)[keyof typeof LedTone];

/** What a status LED takes. */
export interface StatusLedProps {
  readonly tone: LedTone;

  /**
   * The state in words, such as "Unavailable", for an LED with nothing beside
   * it to say so. Left out, the LED is drawn for the eye alone, and the words
   * beside it say the state.
   */
  readonly label?: string;
}

/** A small lamp of a state's colour. */
export function StatusLed({ tone, label }: StatusLedProps): ReactNode {
  return (
    <span
      className="ag-status-led"
      data-ag-tone={tone}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    />
  );
}
