/**
 * The check: one choice that is made or not, beside its label.
 *
 * Hardware, as the switch is (design language, section 10): a small well
 * recessed into the panel that, checked, fills with the call to action's light,
 * lit from above, with a tick drawn in the text colour on the accent. Radix
 * supplies the role, the state and the keyboard; the stylesheet draws the state
 * the control reports (`aria-checked`).
 */

import { Checkbox } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { ControlHint, describedBy } from './control-hint.js';

/** What a check takes. */
export interface CheckProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;

  /** A sentence explaining what the choice does. */
  readonly description?: string;

  readonly disabled?: boolean;

  /**
   * Why the choice cannot be changed now, or `undefined` while it can. The
   * check keeps its focus and opens the reason on hover or focus (ADR-0013).
   */
  readonly unavailableReason?: string;
}

/** A choice that is made or not. */
export function Check({
  label,
  checked,
  onCheckedChange,
  description,
  disabled = false,
  unavailableReason,
}: CheckProps): ReactNode {
  const controlId = useId();
  const labelId = useId();
  const descriptionId = useId();
  const unavailable = unavailableReason !== undefined;

  return (
    <div className="ag-check-field">
      <ControlHint unavailableReason={unavailableReason}>
        {({ reasonId }) => (
          <Checkbox.Root
            id={controlId}
            className="ag-check ag-touch-target"
            checked={checked}
            // Named again for the reason the switch gives: the hint's trigger
            // writes a `data-state` of its own onto the same element.
            data-state={checked ? 'checked' : 'unchecked'}
            onCheckedChange={(next) => {
              if (!unavailable) onCheckedChange(next === true);
            }}
            disabled={disabled}
            {...(unavailable ? { 'aria-disabled': true, 'data-ag-unavailable': '' } : {})}
            aria-labelledby={labelId}
            {...describedBy(description === undefined ? undefined : descriptionId, reasonId)}
          >
            {/* Always drawn, so the tick can fade in and out rather than appear. */}
            <Checkbox.Indicator className="ag-check-tick" forceMount aria-hidden="true" />
          </Checkbox.Root>
        )}
      </ControlHint>
      <div className="ag-check-text">
        {/* A label element, so a press on the words makes the choice, as a
            native check's label does. */}
        <label className="ag-check-label" id={labelId} htmlFor={controlId}>
          {label}
        </label>
        {description !== undefined && (
          <span className="ag-check-description" id={descriptionId}>
            {description}
          </span>
        )}
      </div>
    </div>
  );
}
