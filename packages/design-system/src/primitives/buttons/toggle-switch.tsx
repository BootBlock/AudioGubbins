/**
 * The switch: a control for something that is on or off.
 *
 * Hardware (design language, section 10): a track recessed into the panel with
 * a glossy bead whose LED lights in the accent when it is on. Radix supplies
 * the role, the state and the keyboard; the drawing is the track, the bead and
 * the LED, which the stylesheet lights from the state the control reports
 * (`aria-checked`), so the drawing can never disagree with what a screen reader
 * hears.
 */

import { Switch } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { ControlHint, describedBy } from './control-hint.js';

/** What a switch takes. */
export interface ToggleSwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;

  /** A sentence explaining what turning it on does. */
  readonly description?: string;

  readonly disabled?: boolean;

  /**
   * Why the switch cannot be changed now, or `undefined` while it can. It
   * keeps its focus, says it is unavailable and opens the reason on hover or
   * focus (ADR-0013).
   */
  readonly unavailableReason?: string;

  /** The small track, for a choice inside a dense row. */
  readonly small?: boolean;
}

/** A control for something that is on or off. */
export function ToggleSwitch({
  label,
  checked,
  onCheckedChange,
  description,
  disabled = false,
  unavailableReason,
  small = false,
}: ToggleSwitchProps): ReactNode {
  const labelId = useId();
  const descriptionId = useId();
  const unavailable = unavailableReason !== undefined;

  return (
    <div className="ag-switch-field">
      <div className="ag-switch-text">
        <span className="ag-switch-label" id={labelId}>
          {label}
        </span>
        {description !== undefined && (
          <span className="ag-switch-description" id={descriptionId}>
            {description}
          </span>
        )}
      </div>
      <ControlHint unavailableReason={unavailableReason}>
        {({ reasonId }) => (
          <Switch.Root
            className="ag-switch ag-touch-target"
            data-ag-small={small ? '' : undefined}
            checked={checked}
            // The switch's own state, named again: the hint's trigger is
            // composed onto the same element and writes its own `data-state`,
            // which would otherwise replace the one a reader of the page relies
            // on to tell the switch's state.
            data-state={checked ? 'checked' : 'unchecked'}
            onCheckedChange={(next) => {
              if (!unavailable) onCheckedChange(next);
            }}
            disabled={disabled}
            {...(unavailable ? { 'aria-disabled': true, 'data-ag-unavailable': '' } : {})}
            aria-labelledby={labelId}
            {...describedBy(description === undefined ? undefined : descriptionId, reasonId)}
          >
            <span className="ag-switch-track" aria-hidden="true">
              <span className="ag-switch-lit" />
              <Switch.Thumb className="ag-switch-bead">
                <span className="ag-switch-led" />
              </Switch.Thumb>
            </span>
          </Switch.Root>
        )}
      </ControlHint>
    </div>
  );
}
