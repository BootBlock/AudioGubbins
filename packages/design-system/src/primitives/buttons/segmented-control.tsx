/**
 * The segmented control: one choice of a few, all in view, in one well.
 *
 * A radio group to a screen reader and the keyboard (Radix): one Tab stop, the
 * arrow keys move to and choose the next choice, as native radios do. Drawn as
 * the design language's segmented control (section 10): a well with the choices
 * two pixels apart, the chosen one under a translucent accent wash with a faint
 * accent edge (section 7), or, for a tool group, lit as a call to action. The
 * wash is one element that moves to the chosen choice.
 */

import { RadioGroup } from 'radix-ui';
import { useRef, type CSSProperties, type ReactNode } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { useChosenBox, type ChosenBox } from './chosen-box.js';
import { ControlHint, describedBy } from '../control-hint.js';

/** How the choices are drawn. */
export const SegmentedVariant = {
  /** Each choice its label. */
  Text: 'text',

  /** Each choice its glyph, named by its label. */
  Icons: 'icons',

  /** A tool group: square glyph choices, the chosen one lit as a call to action. */
  Tools: 'tools',

  /** The full width, each choice its label over a caption line. */
  Wide: 'wide',
} as const;

/** How the choices are drawn. */
export type SegmentedVariant = (typeof SegmentedVariant)[keyof typeof SegmentedVariant];

/** One choice of a segmented control. */
export interface SegmentedOption {
  readonly value: string;

  /** The visible label, or, drawn as a glyph, the choice's accessible name. */
  readonly label: string;

  /** The glyph, for the icon and tool variants. */
  readonly icon?: IconName;

  /** The caption line under the label, for the wide variant. */
  readonly caption?: string;
}

/** What a segmented control takes. */
export interface SegmentedControlProps {
  /** The accessible name of the group, for example "Display". */
  readonly label: string;

  readonly value: string;
  readonly options: readonly SegmentedOption[];
  readonly onValueChange: (value: string) => void;

  readonly variant?: SegmentedVariant;

  /** The small choices, for a dense row. */
  readonly small?: boolean;

  readonly disabled?: boolean;

  /**
   * Why the choice cannot be changed now, or `undefined` while it can. The
   * group keeps its focus and opens the reason on hover or focus (ADR-0013).
   */
  readonly unavailableReason?: string;
}

/** What draws a choice's face. */
function face(option: SegmentedOption, variant: SegmentedVariant): ReactNode {
  if (variant === SegmentedVariant.Icons || variant === SegmentedVariant.Tools) {
    // A glyph names nothing, so the label stays the choice's name.
    return option.icon === undefined ? (
      option.label
    ) : (
      <>
        <Icon name={option.icon} />
        <span className="ag-visually-hidden">{option.label}</span>
      </>
    );
  }
  return (
    <>
      <span className="ag-segment-label">{option.label}</span>
      {variant === SegmentedVariant.Wide && option.caption !== undefined && (
        <span className="ag-segment-caption">{option.caption}</span>
      )}
    </>
  );
}

/** The custom properties that place the wash over the chosen choice's box. */
function washStyle(box: ChosenBox): CSSProperties & {
  readonly '--ag-segment-left': string;
  readonly '--ag-segment-top': string;
  readonly '--ag-segment-width': string;
  readonly '--ag-segment-height': string;
} {
  const pixels = (value: number): string => `${String(value)}px`;
  return {
    '--ag-segment-left': pixels(box.left),
    '--ag-segment-top': pixels(box.top),
    '--ag-segment-width': pixels(box.width),
    '--ag-segment-height': pixels(box.height),
  };
}

/** One choice of a few, all in view. */
export function SegmentedControl({
  label,
  value,
  options,
  onValueChange,
  variant = SegmentedVariant.Text,
  small = false,
  disabled = false,
  unavailableReason,
}: SegmentedControlProps): ReactNode {
  const group = useRef<HTMLDivElement>(null);
  const box = useChosenBox(group, '.ag-segment[aria-checked="true"]', value);
  const unavailable = unavailableReason !== undefined;

  // The measured box is where the chosen choice is laid out, a fact of the
  // layout rather than a value of the language, carried as custom properties
  // the stylesheet places the wash with.
  const washPlace = box === undefined ? undefined : washStyle(box);

  return (
    <ControlHint unavailableReason={unavailableReason}>
      {({ reasonId }) => (
        <RadioGroup.Root
          ref={group}
          className="ag-segmented"
          data-ag-variant={variant}
          data-ag-small={small ? '' : undefined}
          orientation="horizontal"
          aria-label={label}
          value={value}
          onValueChange={(next) => {
            if (!unavailable) onValueChange(next);
          }}
          disabled={disabled}
          {...(unavailable ? { 'aria-disabled': true, 'data-ag-unavailable': '' } : {})}
          {...describedBy(reasonId)}
        >
          <span
            className="ag-segmented-wash"
            aria-hidden="true"
            data-ag-placed={box === undefined ? undefined : ''}
            style={washPlace}
          />
          {options.map((option) => (
            <RadioGroup.Item
              key={option.value}
              value={option.value}
              className="ag-segment ag-touch-sized"
            >
              {face(option, variant)}
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      )}
    </ControlHint>
  );
}
