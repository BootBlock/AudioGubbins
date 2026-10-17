/**
 * A single line of text the user types, and its template variant.
 *
 * Radix has no text input, because a native one needs nothing added to it: it
 * already has the role, the keyboard behaviour and the platform's own
 * corrections and autofill. What it does need is the label association and the
 * design language's field, which is why this exists rather than an `<input>`
 * at each call site.
 */

import {
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import { TemplateEditor } from './template-editor.js';
import type { TemplateVocabulary } from './template-vocabulary.js';

/** What a text field takes. */
export interface TextFieldProps {
  /** The visible label. */
  readonly label: string;

  readonly value: string;
  readonly onValueChange: (value: string) => void;

  /** A sentence saying what the field is for. */
  readonly description?: string;

  /** Shown in the empty field, never as a substitute for the label. */
  readonly placeholder?: string;

  /**
   * Something else on the page that describes the field, beside its own
   * description.
   *
   * For a field whose description names something shown elsewhere: the export
   * dialogue's note preview is drawn below the field, and told to look below
   * it, a reader who cannot see the page would otherwise have no way there.
   */
  readonly describedBy?: string;

  /**
   * The most characters the field accepts, where what reads the value has a
   * bound of its own.
   *
   * Declared here rather than cutting the value afterwards, so the reader is
   * stopped at the bound instead of losing words they have already written.
   */
  readonly maxLength?: number;

  readonly disabled?: boolean;

  /** Runs when the user presses Enter in the field. */
  readonly onSubmit?: () => void;

  /** The unit the value is in, trailing it inside the field. */
  readonly unit?: string;

  /**
   * What is wrong with the value, where something is: the field is drawn
   * invalid, says so to a screen reader, and shows this under it.
   */
  readonly error?: string;

  /**
   * Makes the field a template field: each token of this vocabulary is
   * highlighted where it is written, an unknown one in the danger colour, and
   * a braces button inside the field's end lists them to insert at the caret.
   */
  readonly template?: TemplateVocabulary;
}

/** How the field came to be edited: the keyboard draws the focus ring round it, a pointer does not. */
type Editing = 'pointer' | 'keyboard';

/**
 * Whether the field is being edited, and how it was reached.
 *
 * A browser matches every focused text input as `:focus-visible`, whether a
 * click or the keyboard put focus there, so the field tells the two apart
 * itself: a press on the field comes before the focus it gives, and the press
 * is forgotten as soon as the pointer is lifted, so a later Tab is the
 * keyboard's.
 */
function useEditing() {
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const pressed = useRef(false);
  return {
    editing,
    pressed: () => {
      pressed.current = true;
      window.addEventListener(
        'pointerup',
        () => {
          pressed.current = false;
        },
        { once: true },
      );
    },
    focused: () => {
      setEditing(pressed.current ? 'pointer' : 'keyboard');
    },
    blurred: () => {
      setEditing(undefined);
    },
  };
}

/** The ids a field's `aria-describedby` names, or nothing where none applies. */
function describedByOf(...ids: readonly (string | undefined)[]): {
  readonly 'aria-describedby'?: string;
} {
  const named = ids.filter((one) => one !== undefined).join(' ');
  return named === '' ? {} : { 'aria-describedby': named };
}

/** What the field's input is given: its value, its state and its handlers. */
function inputOf(
  props: {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly placeholder: string | undefined;
    readonly maxLength: number | undefined;
    readonly disabled: boolean;
    readonly onSubmit: (() => void) | undefined;
    readonly error: string | undefined;
  },
  ids: { readonly field: string; readonly describedBy: readonly (string | undefined)[] },
  focus: { readonly focused: () => void; readonly blurred: () => void },
): InputHTMLAttributes<HTMLInputElement> {
  const { value, onValueChange, placeholder, maxLength, disabled, onSubmit, error } = props;
  return {
    id: ids.field,
    className: 'ag-text-field-input',
    type: 'text',
    value,
    disabled,
    autoComplete: 'off',
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(error === undefined ? {} : { 'aria-invalid': true }),
    ...describedByOf(...ids.describedBy),
    onChange: (event) => {
      onValueChange(event.target.value);
    },
    onFocus: focus.focused,
    onBlur: focus.blurred,
    onKeyDown: (event) => {
      if (event.key !== 'Enter' || onSubmit === undefined) return;

      // A field inside a dialogue with no form would otherwise let Enter
      // reach the dialogue, which treats it as the default action.
      event.preventDefault();
      onSubmit();
    },
  };
}

/**
 * Puts the caret in the text for a press on the field around it, such as on
 * its unit, as a press on a native field's padding does.
 */
function caretOnPress(event: PointerEvent<HTMLDivElement>, box: HTMLDivElement | null): void {
  const target = event.target;
  const text = box?.querySelector('input');
  if (
    target instanceof Element &&
    target.closest('input, button') === null &&
    text instanceof HTMLInputElement
  ) {
    event.preventDefault();
    text.focus();
  }
}

/** The field itself, which carries the editing, invalid and unavailable states, and its unit. */
function FieldBox({
  editing,
  invalid,
  disabled,
  pressed,
  unit,
  children,
}: {
  readonly editing: Editing | undefined;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly pressed: () => void;
  readonly unit: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const box = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={box}
      className="ag-text-field-box ag-touch-sized"
      {...(editing === undefined ? {} : { 'data-ag-editing': editing })}
      {...(invalid ? { 'data-ag-invalid': '' } : {})}
      {...(disabled ? { 'data-ag-disabled': '' } : {})}
      onPointerDown={(event) => {
        pressed();
        if (!disabled) caretOnPress(event, box.current);
      }}
    >
      {children}
      {unit !== undefined && <span className="ag-text-field-unit">{unit}</span>}
    </div>
  );
}

/** The field's label, and the sentence saying what it is for. */
function FieldHeading({
  label,
  field,
  description,
  descriptionId,
}: {
  readonly label: string;
  readonly field: string;
  readonly description: string | undefined;
  readonly descriptionId: string;
}): ReactNode {
  return (
    <>
      <label className="ag-text-field-label" htmlFor={field}>
        {label}
      </label>
      {description !== undefined && (
        <span className="ag-text-field-description" id={descriptionId}>
          {description}
        </span>
      )}
    </>
  );
}

/** What is wrong with the value, under the field, with its glyph. */
function FieldError({ id, error }: { readonly id: string; readonly error: string }): ReactNode {
  return (
    <p className="ag-text-field-error" id={id}>
      <Icon name="field-error" size={IconSize.Inline} />
      {error}
    </p>
  );
}

/** A single line of text the user types. */
export function TextField({
  label,
  value,
  onValueChange,
  description,
  describedBy,
  placeholder,
  maxLength,
  disabled = false,
  onSubmit,
  unit,
  error,
  template,
}: TextFieldProps): ReactNode {
  const fieldId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const { editing, pressed, focused, blurred } = useEditing();

  const input = inputOf(
    { value, onValueChange, placeholder, maxLength, disabled, onSubmit, error },
    {
      field: fieldId,
      describedBy: [
        description === undefined ? undefined : descriptionId,
        describedBy,
        error === undefined ? undefined : errorId,
      ],
    },
    { focused, blurred },
  );

  return (
    <div className="ag-text-field">
      <FieldHeading
        label={label}
        field={fieldId}
        description={description}
        descriptionId={descriptionId}
      />
      <FieldBox
        editing={editing}
        invalid={error !== undefined}
        disabled={disabled}
        pressed={pressed}
        unit={unit}
      >
        {template === undefined ? (
          <input {...input} />
        ) : (
          <TemplateEditor
            vocabulary={template}
            value={value}
            onValueChange={onValueChange}
            input={input}
          />
        )}
      </FieldBox>
      {error !== undefined && <FieldError id={errorId} error={error} />}
    </div>
  );
}
