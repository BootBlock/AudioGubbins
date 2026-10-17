/**
 * A command's unavailable reason as the props a design-system control takes
 * it by (ADR-0013): the reason while there is one, and nothing at all while
 * the control can be used, since the controls tell an absent reason from one
 * given as `undefined`.
 */

/** The props that give a control `reason`, or none while it can be used. */
export function optionalReason(reason: string | undefined): {
  readonly unavailableReason?: string;
} {
  return reason === undefined ? {} : { unavailableReason: reason };
}
