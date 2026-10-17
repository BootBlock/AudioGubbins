/**
 * The appearance the inventory page draws its specimens in, as its address
 * states it: `theme` is `dark` or `light`, `density` is `comfortable` or
 * `compact`, and `motion` is `full`, `reduced` or `off`.
 *
 * Read by the page, which themes itself from it, and by the capture, which
 * builds each address from it, so the two cannot name a setting differently.
 * It imports nothing of the design system: the capture runs in Node, and the
 * page maps these words onto the design system's own preferences.
 */

/** The themes the inventory is drawn in. */
export const INVENTORY_THEMES = ['dark', 'light'] as const;

/** The densities the inventory is drawn at. */
export const INVENTORY_DENSITIES = ['comfortable', 'compact'] as const;

/**
 * The motion levels, by the names the motion system gives them: "off" is the
 * level the preferences store as `minimal`.
 */
export const INVENTORY_MOTION_LEVELS = ['full', 'reduced', 'off'] as const;

export type InventoryTheme = (typeof INVENTORY_THEMES)[number];
export type InventoryDensity = (typeof INVENTORY_DENSITIES)[number];
export type InventoryMotion = (typeof INVENTORY_MOTION_LEVELS)[number];

/** One appearance of the whole inventory. */
export interface InventorySettings {
  readonly theme: InventoryTheme;
  readonly density: InventoryDensity;
  readonly motion: InventoryMotion;
}

/**
 * What an address that names no setting draws: the shipped theme and density,
 * and motion off, the level every capture is taken at, so a page opened by
 * hand looks as the baseline does.
 */
export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  theme: 'dark',
  density: 'comfortable',
  motion: 'off',
};

/** The settings an address states, or each setting it names wrongly. */
export type SettingsReading =
  | { readonly ok: true; readonly settings: InventorySettings }
  | { readonly ok: false; readonly problems: readonly string[] };

/** One setting as the query states it: its value, or why it cannot be read. */
type Reading<T> = { readonly value: T } | { readonly problem: string };

/** One setting's value from the query, its default where the query has none. */
function readOne<T extends string>(
  query: URLSearchParams,
  name: string,
  allowed: readonly T[],
  fallback: T,
): Reading<T> {
  const value = query.get(name);
  if (value === null) return { value: fallback };
  const found = allowed.find((one) => one === value);
  return found === undefined
    ? { problem: `${name}=${value} is not one of ${allowed.join(', ')}` }
    : { value: found };
}

/**
 * Reads the settings from an address's query.
 *
 * A value the inventory does not know is refused rather than replaced by the
 * default: a capture asking for `theme=ligth` would otherwise compare the dark
 * theme against the light theme's baseline and report the difference as a
 * regression.
 */
export function readInventorySettings(search: string): SettingsReading {
  const query = new URLSearchParams(search);
  const theme = readOne(query, 'theme', INVENTORY_THEMES, DEFAULT_INVENTORY_SETTINGS.theme);
  const density = readOne(
    query,
    'density',
    INVENTORY_DENSITIES,
    DEFAULT_INVENTORY_SETTINGS.density,
  );
  const motion = readOne(
    query,
    'motion',
    INVENTORY_MOTION_LEVELS,
    DEFAULT_INVENTORY_SETTINGS.motion,
  );

  if ('value' in theme && 'value' in density && 'value' in motion) {
    return {
      ok: true,
      settings: { theme: theme.value, density: density.value, motion: motion.value },
    };
  }
  return {
    ok: false,
    problems: [theme, density, motion].flatMap((one) => ('problem' in one ? [one.problem] : [])),
  };
}

/**
 * The query parameter that narrows the page to one component.
 *
 * The capture draws each component on a page of its own: drawn below the
 * others, a component sits at an offset that a change to any component above
 * it moves, often by a fraction of a pixel, and an edge drawn at another
 * fraction is antialiased differently, so one component's change would fail
 * the comparison of every component after it.
 */
const COMPONENT_PARAMETER = 'component';

/** The component an address narrows the page to, or nothing for every component. */
export function readInventoryComponent(search: string): string | undefined {
  return new URLSearchParams(search).get(COMPONENT_PARAMETER) ?? undefined;
}

/** The query that states a set of settings, and the one component to draw where it names one. */
export function inventoryQuery(settings: InventorySettings, component?: string): string {
  return `?${new URLSearchParams({
    theme: settings.theme,
    density: settings.density,
    motion: settings.motion,
    ...(component === undefined ? {} : { [COMPONENT_PARAMETER]: component }),
  }).toString()}`;
}
