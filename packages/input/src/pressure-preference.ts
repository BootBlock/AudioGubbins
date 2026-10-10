/**
 * What the person chooses about pen pressure, as their preferences keep it
 * (REQ-UX-068, ADR-0082).
 *
 * Pressure is optional and a fixed strength is always available, so the choice
 * is two values: whether a pen's pressure varies a tool, and the strength used
 * when it does not. They are the part of `GestureSettings` a person sets; how
 * long a press is held before it is the context action is the input model's,
 * not theirs. The spectral brush is the first tool whose strength can vary,
 * which is why the choice is persisted from its phase (ADR-0017 amended).
 *
 * The fixed strength is stepped, so a strength set on one machine is the same
 * number on every other and a stroke drawn with it is the same mask anywhere.
 */

/** The pressure choice a person makes, which their preferences persist. */
export interface PressurePreference {
  /**
   * Whether pen pressure varies the tool.
   *
   * REQ-UX-068 requires a deterministic fixed strength to remain available on
   * pressure-capable hardware, so this is a preference and not a capability.
   */
  readonly usePenPressure: boolean;

  /** The strength used when pressure is off or unreported, from 0 to 1. */
  readonly fixedStrength: number;
}

/** How many steps the fixed strength has from nothing to full. */
const STRENGTH_STEPS = 20;

/**
 * The fixed strength's control: from `minimum` to `maximum` by `step`. A
 * strength of nothing would make a tool that does nothing, so the lowest is
 * one step.
 */
export const FIXED_STRENGTH_RANGE = {
  minimum: 1 / STRENGTH_STEPS,
  maximum: 1,
  step: 1 / STRENGTH_STEPS,
} as const;

/** The pressure choice before a person makes one: pressure used, three quarters fixed. */
export const DEFAULT_PRESSURE_PREFERENCE: PressurePreference = {
  usePenPressure: true,
  fixedStrength: 0.75,
};

/**
 * `value` as a fixed strength the control offers: the nearest step within the
 * range, or the default where it is no number. Dividing a whole number of
 * steps by their count rounds once, so a step has one value everywhere.
 */
export function fixedStrengthOf(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PRESSURE_PREFERENCE.fixedStrength;
  const stepped = Math.round(value * STRENGTH_STEPS);
  return Math.min(STRENGTH_STEPS, Math.max(1, stepped)) / STRENGTH_STEPS;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The pressure choice in a stored value, field by field: a field that is
 * missing or unusable costs that field, never the other, as every stored
 * preference is read (REQ-EXEC-136.12). A stored strength between steps is
 * taken to its nearest.
 */
export function pressurePreferenceOf(stored: unknown): PressurePreference {
  if (!isRecord(stored)) return DEFAULT_PRESSURE_PREFERENCE;
  const { usePenPressure, fixedStrength } = stored;
  return {
    usePenPressure:
      typeof usePenPressure === 'boolean'
        ? usePenPressure
        : DEFAULT_PRESSURE_PREFERENCE.usePenPressure,
    fixedStrength:
      typeof fixedStrength === 'number'
        ? fixedStrengthOf(fixedStrength)
        : DEFAULT_PRESSURE_PREFERENCE.fixedStrength,
  };
}
