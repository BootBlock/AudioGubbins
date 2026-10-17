/**
 * The radio group: one choice of several, each drawn as a panel lamp beside
 * its label.
 *
 * Radix supplies the roles and the keyboard: one Tab stop, the arrow keys move
 * to and choose the next choice, as native radios do. Each choice's lamp is lit
 * while it is the one chosen (design language, section 10). Where the choices
 * are few and short enough to sit in one well, the segmented control is the
 * choice instead.
 */

import { RadioGroup as Radio } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import {
  type ControlDescription,
  DescriptionHint,
  DescriptionText,
} from '../control-description.js';
import { ControlHint, describedBy } from '../control-hint.js';
import { PanelLamp } from './panel-lamp.js';

/** One choice of a radio group. */
export interface RadioOption {
  readonly value: string;
  readonly label: string;

  /**
   * A sentence saying what choosing it does: standing under the label, or
   * behind an (i) beside the choice.
   */
  readonly description?: ControlDescription;
}

/** What a radio group takes. */
export interface RadioGroupProps {
  /** The group's visible heading and accessible name. */
  readonly label: string;

  readonly value: string;
  readonly options: readonly RadioOption[];
  readonly onValueChange: (value: string) => void;

  /** Choices side by side rather than stacked. */
  readonly horizontal?: boolean;

  readonly disabled?: boolean;

  /**
   * Why the choice cannot be changed now, or `undefined` while it can. The
   * group keeps its focus and opens the reason on hover or focus (ADR-0013).
   */
  readonly unavailableReason?: string;
}

/**
 * One choice of the group: its lamp, lit while it is the one chosen, beside its
 * label, and the (i) of a description kept behind one.
 *
 * The (i) is beside the choice rather than in it: the choice is a button to a
 * screen reader, and a button inside a button is neither reachable nor said.
 */
function RadioChoice({
  option,
  chosen,
  labelId,
  descriptionId,
}: {
  readonly option: RadioOption;
  readonly chosen: boolean;
  readonly labelId: string;
  readonly descriptionId: string;
}): ReactNode {
  return (
    <span className="ag-radio-choice">
      <Radio.Item
        value={option.value}
        className="ag-radio-option ag-touch-sized"
        // Named by its label alone: the description is inside the
        // choice too, and is its description rather than its name.
        aria-labelledby={labelId}
        {...describedBy(option.description === undefined ? undefined : descriptionId)}
      >
        <span className="ag-radio-lamp">
          <PanelLamp lit={chosen} />
        </span>
        <span className="ag-radio-text">
          <span className="ag-radio-label" id={labelId}>
            {option.label}
          </span>
          <DescriptionText
            description={option.description}
            id={descriptionId}
            className="ag-radio-description"
          />
        </span>
      </Radio.Item>
      <DescriptionHint description={option.description} />
    </span>
  );
}

/** One choice of several, each a panel lamp. */
export function RadioGroup({
  label,
  value,
  options,
  onValueChange,
  horizontal = false,
  disabled = false,
  unavailableReason,
}: RadioGroupProps): ReactNode {
  const labelId = useId();
  const optionIds = useId();
  const unavailable = unavailableReason !== undefined;

  return (
    <div className="ag-radio-field">
      <span className="ag-radio-heading" id={labelId}>
        {label}
      </span>
      <ControlHint unavailableReason={unavailableReason}>
        {({ reasonId }) => (
          <Radio.Root
            className="ag-radio-group"
            data-ag-horizontal={horizontal ? '' : undefined}
            orientation={horizontal ? 'horizontal' : 'vertical'}
            aria-labelledby={labelId}
            value={value}
            onValueChange={(next) => {
              if (!unavailable) onValueChange(next);
            }}
            disabled={disabled}
            {...(unavailable ? { 'aria-disabled': true, 'data-ag-unavailable': '' } : {})}
            {...describedBy(reasonId)}
          >
            {options.map((option, index) => (
              <RadioChoice
                key={option.value}
                option={option}
                chosen={option.value === value}
                labelId={`${optionIds}-label-${String(index)}`}
                descriptionId={`${optionIds}-description-${String(index)}`}
              />
            ))}
          </Radio.Root>
        )}
      </ControlHint>
    </div>
  );
}
