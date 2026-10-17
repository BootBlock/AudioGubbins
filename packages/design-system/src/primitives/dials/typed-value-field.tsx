/**
 * A dial's value as a field (design language, section 10): the value as it
 * reads, which becomes editable on a click or Enter so a number can be typed
 * rather than turned to. What is typed goes to the caller as written, which
 * reads it in its own unit; the field knows no unit.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';

/** What a dial's value field shows, and what it does with a value typed into it. */
export interface DialTyping {
  /** The field's accessible name, for example `Threshold in dB, typed`. */
  readonly label: string;

  /** The text the field starts from when it opens for typing, for example `-18`. */
  readonly text: string;

  /** Runs with what was typed when the person presses Enter. */
  readonly onSubmit: (typed: string) => void;
}

/** A dial's value field. */
export interface TypedValueFieldProps {
  /** The value as it reads at rest, for example `−18 dB`. */
  readonly display: string;

  readonly typing: DialTyping;

  /** Whether the dial is locked, which locks its field with it. */
  readonly locked: boolean;
}

/** A dial's value, shown at rest and typed into on a click or Enter. */
export function TypedValueField({ display, typing, locked }: TypedValueFieldProps): ReactNode {
  // What is being typed while the field is open; closed, the field shows the
  // value the dial has, so a change made elsewhere is seen in it.
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const open = typed !== undefined;

  // Whether the field is closing from the keyboard, which gives the keyboard
  // back to the value it closed to rather than dropping it on the page.
  const returning = useRef(false);

  // Opened, the field takes the keyboard with its text chosen, so typing
  // replaces the value as it does in any field a person tabs into. Stable, so
  // it runs as the input arrives and not again at each keystroke.
  const takeKeyboard = useCallback((element: HTMLInputElement | null) => {
    element?.focus();
    element?.select();
  }, []);
  const giveKeyboardBack = useCallback((element: HTMLButtonElement | null) => {
    if (element === null || !returning.current) return;
    returning.current = false;
    element.focus();
  }, []);

  const close = (): void => {
    returning.current = true;
    setTyped(undefined);
  };

  if (!open) {
    return (
      <button
        ref={giveKeyboardBack}
        type="button"
        className="ag-dial-field"
        aria-label={typing.label}
        disabled={locked}
        onClick={() => {
          setTyped(typing.text);
        }}
      >
        {display}
      </button>
    );
  }

  return (
    <input
      ref={takeKeyboard}
      className="ag-dial-field"
      data-ag-editing=""
      aria-label={typing.label}
      value={typed}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => {
        setTyped(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          typing.onSubmit(typed);
          close();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
      // Leaving the field puts the typing away: only Enter sends a value, so
      // a number half typed is never set by a click elsewhere.
      onBlur={() => {
        setTyped(undefined);
      }}
    />
  );
}
