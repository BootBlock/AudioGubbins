/**
 * The select: a control for choosing one of a fixed set, drawn as a secondary
 * button with a chevron, whose open list is a menu at least as wide as it.
 */

import { Select } from 'radix-ui';
import { useId, type KeyboardEvent, type ReactNode } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import {
  type ControlDescription,
  DescriptionHint,
  DescriptionText,
} from '../control-description.js';

/** One option of a select. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;

  /** The glyph drawn before the label, where the option has one. */
  readonly icon?: IconName;
}

/** What a select takes. */
export interface OptionSelectProps {
  /** The visible label, and the select's accessible name. */
  readonly label: string;

  /**
   * Keeps the label for a screen reader alone, where what surrounds the select
   * already says what it chooses, such as a column heading over a row of them.
   */
  readonly labelHidden?: boolean;

  /**
   * A sentence saying what the choice does: standing under the select, or
   * behind an (i) beside its label.
   */
  readonly description?: ControlDescription;

  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
}

/**
 * Keeps a closed trigger from choosing by the first character typed at it, as
 * a native select does. Every select here runs a command as it changes, and a
 * command is run deliberately: asked to press letter keys so AudioGubbins can
 * learn their keyboard, a user with focus on this control would otherwise
 * switch their shortcut profile instead. Typing ahead stays where it belongs,
 * in the open list. The handler runs first and the primitive's own is skipped
 * once the event is defaulted.
 */
function chooseNothingWhileShut(event: KeyboardEvent<HTMLButtonElement>): void {
  const typed = event.key.length === 1 && event.key !== ' ';
  const bare = !event.altKey && !event.ctrlKey && !event.metaKey;
  if (typed && bare) event.preventDefault();
}

/** One option of the open list: its glyph, its label and, when chosen, a tick. */
function OptionRow({
  option,
  glyphs,
}: {
  readonly option: SelectOption;
  readonly glyphs: boolean;
}): ReactNode {
  return (
    <Select.Item value={option.value} className="ag-select-item ag-lit-row ag-touch-sized">
      {glyphs &&
        (option.icon === undefined ? (
          <span className="ag-menu-item-glyph" aria-hidden="true" />
        ) : (
          <Icon name={option.icon} className="ag-menu-item-glyph" />
        ))}
      <Select.ItemText asChild>
        <span className="ag-select-item-text">{option.label}</span>
      </Select.ItemText>
      <Select.ItemIndicator className="ag-select-indicator">
        <Icon name="checked" />
      </Select.ItemIndicator>
    </Select.Item>
  );
}

/**
 * The select's label, drawn or said alone, and the (i) of a description kept
 * behind one, beside the label or, where the label is said alone, in its
 * place.
 */
function SelectHeading({
  label,
  labelId,
  labelHidden,
  description,
}: {
  readonly label: string;
  readonly labelId: string;
  readonly labelHidden: boolean;
  readonly description: ControlDescription | undefined;
}): ReactNode {
  return (
    <>
      <span className={labelHidden ? 'ag-visually-hidden' : 'ag-labelled ag-select-label'}>
        <span id={labelId}>{label}</span>
        {!labelHidden && <DescriptionHint description={description} />}
      </span>
      {labelHidden && <DescriptionHint description={description} />}
    </>
  );
}

/** The open list: a menu of the options, at least as wide as the trigger. */
function OptionList({ options }: { readonly options: readonly SelectOption[] }): ReactNode {
  const glyphs = options.some((option) => option.icon !== undefined);
  return (
    <Select.Portal>
      <Select.Content
        className="ag-select-content ag-overlay"
        position="popper"
        sideOffset={4}
        {...(glyphs ? { 'data-ag-glyphs': '' } : {})}
      >
        <Select.Viewport className="ag-select-viewport">
          {options.map((option) => (
            <OptionRow key={option.value} option={option} glyphs={glyphs} />
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  );
}

/** A control for choosing one of a fixed set. */
export function OptionSelect({
  label,
  labelHidden = false,
  description,
  value,
  options,
  onValueChange,
  disabled = false,
}: OptionSelectProps): ReactNode {
  const labelId = useId();
  const descriptionId = useId();
  const chosen = options.find((option) => option.value === value);

  return (
    <div className="ag-select-field">
      <SelectHeading
        label={label}
        labelId={labelId}
        labelHidden={labelHidden}
        description={description}
      />
      <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <Select.Trigger
          className="ag-select-trigger ag-touch-sized"
          aria-labelledby={labelId}
          {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
          onKeyDown={chooseNothingWhileShut}
        >
          <span className="ag-select-value">
            {chosen?.icon !== undefined && <Icon name={chosen.icon} />}
            <Select.Value />
          </span>
          <Select.Icon className="ag-select-icon">
            <Icon name="open-list" />
          </Select.Icon>
        </Select.Trigger>
        <OptionList options={options} />
      </Select.Root>
      <DescriptionText
        description={description}
        id={descriptionId}
        className="ag-select-description"
      />
    </div>
  );
}
