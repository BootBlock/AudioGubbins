/**
 * The power switch: a processor's, or any unit's, on and off, as a backlit
 * push button.
 *
 * A switch to a screen reader and the keyboard (Radix): it says whether it is
 * on, and Space or Enter turns it over. It has no visible label of its own, as
 * a power button on a unit has none, so it is named by what it powers.
 */

import { Switch } from 'radix-ui';
import type { ReactNode } from 'react';

import { ControlHint, describedBy } from '../control-hint.js';
import { PowerSwitchDrawing } from './power-switch-drawing.js';

/** What a power switch takes. */
export interface PowerSwitchProps {
  /** The accessible name: what it powers, for example "Equaliser". */
  readonly label: string;

  /** Whether it is on. */
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;

  /** The hint shown on hover or focus. */
  readonly hint?: string;

  readonly disabled?: boolean;

  /**
   * Why it cannot be turned over now, or `undefined` while it can. It keeps
   * its focus and opens the reason on hover or focus (ADR-0013).
   */
  readonly unavailableReason?: string;
}

/** A unit's on and off, as a backlit push button. */
export function PowerSwitch({
  label,
  checked,
  onCheckedChange,
  hint,
  disabled = false,
  unavailableReason,
}: PowerSwitchProps): ReactNode {
  const unavailable = unavailableReason !== undefined;
  return (
    <ControlHint hint={hint} unavailableReason={unavailableReason}>
      {({ reasonId }) => (
        <Switch.Root
          className="ag-power-switch ag-touch-target"
          aria-label={label}
          checked={checked}
          // Named again for the reason the switch gives: the hint's trigger
          // writes a `data-state` of its own onto the same element.
          data-state={checked ? 'checked' : 'unchecked'}
          onCheckedChange={(next) => {
            if (!unavailable) onCheckedChange(next);
          }}
          disabled={disabled}
          {...(unavailable ? { 'aria-disabled': true, 'data-ag-unavailable': '' } : {})}
          {...describedBy(reasonId)}
        >
          <PowerSwitchDrawing on={checked} />
        </Switch.Root>
      )}
    </ControlHint>
  );
}
