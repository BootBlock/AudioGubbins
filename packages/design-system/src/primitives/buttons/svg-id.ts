/**
 * An identifier for a gradient or a filter inside one drawn control, unique to
 * that instance of it.
 *
 * Each hardware control draws its gradients in its own SVG and points at them
 * with `url(#…)`. Two controls on a page would otherwise share one identifier,
 * and every switch after the first would be drawn with the first one's light.
 * React's own identifiers carry punctuation a `url()` reference does not take
 * unescaped, so the identifier keeps only what an SVG reference can hold.
 */

import { useId } from 'react';

const NOT_NAME_CHARACTERS = /[^A-Za-z0-9_-]/g;

/** A function naming each of a control's definitions uniquely, by its part. */
export function useSvgIds(prefix: string): (part: string) => string {
  const base = `${prefix}-${useId().replace(NOT_NAME_CHARACTERS, '')}`;
  return (part) => `${base}-${part}`;
}
