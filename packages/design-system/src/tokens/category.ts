/**
 * The marker and track colours.
 *
 * Keyed by name, because a project stores the name. REQ-UX-070 keeps the colour
 * itself out of the project: a marker recorded as `coral` stays legible when
 * the user switches to a light theme, while one recorded as a hexadecimal value
 * does not.
 *
 * A module of its own because the chrome reads one of them too: the call to
 * action's second hue and the backdrop's lower glow are the rose of this set,
 * so a change to the rose reaches all three.
 */

import { oklch, type Oklch } from './colour.js';
import { finish, type Finishing } from './finish.js';

/** The hue of each category colour, by the name a project stores. */
export const CATEGORY_HUES = {
  coral: 25,
  amber: 70,
  lime: 120,
  teal: 180,
  sky: 230,
  indigo: 275,
  violet: 305,
  rose: 350,
} as const;

/** A category colour's name. */
export type CategoryName = keyof typeof CATEGORY_HUES;

function isCategoryName(value: string): value is CategoryName {
  return Object.hasOwn(CATEGORY_HUES, value);
}

/** Every category colour's name, filtered through the predicate rather than asserted. */
export const CATEGORY_NAMES: readonly CategoryName[] =
  Object.keys(CATEGORY_HUES).filter(isCategoryName);

/** How a category colour is built: in which theme, at which brightness and contrast. */
export interface CategoryOptions extends Finishing {
  readonly dark: boolean;
}

/** One category colour. */
export function categoryColour(name: CategoryName, options: CategoryOptions): Oklch {
  return finish(oklch(options.dark ? 0.72 : 0.55, 0.14, CATEGORY_HUES[name]), options);
}
