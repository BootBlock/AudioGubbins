/**
 * Inserting a token at a template field's caret from its token list: where
 * the caret was when the list opened, where the list is drawn, the text with
 * the token in it, and the caret put back after it.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

import type { TemplateToken } from './template-syntax.js';
import type { TokenMenuPlacement } from './token-menu.js';

/** What inserting a token works on. */
export interface TokenInsertionTarget {
  readonly field: RefObject<HTMLInputElement | null>;
  readonly value: string;
  readonly onValueChange: (value: string) => void;

  /** The most characters the field takes, where it has a bound. */
  readonly maxLength: number | undefined;

  /** Keeps the highlighting under the text after the caret moves. */
  readonly follow: () => void;
}

/** Where the list is drawn for a field: as wide as it, from its leading edge. */
function placementOf(box: Element): TokenMenuPlacement {
  const bounds = box.getBoundingClientRect();
  const button = box.querySelector('.ag-template-tokens-button');
  const from = button?.getBoundingClientRect().left ?? bounds.left;
  return { inlineSize: bounds.width, alignOffset: bounds.left - from };
}

/** `value` with `token` written over the selection, and where the caret goes after it. */
function withToken(
  value: string,
  { start, end }: { readonly start: number; readonly end: number },
  token: TemplateToken,
): { readonly next: string; readonly after: number } {
  const written = `{${token.name}}`;
  return {
    next: value.slice(0, start) + written + value.slice(end),
    after: start + written.length,
  };
}

/** The token list's state, and inserting the token chosen in it at the caret. */
export function useTokenInsertion({
  field,
  value,
  onValueChange,
  maxLength,
  follow,
}: TokenInsertionTarget) {
  const caret = useRef({ start: value.length, end: value.length });
  const restoreCaret = useRef(false);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<TokenMenuPlacement | undefined>(undefined);

  // After a token is inserted, the caret goes after it once the new text is in.
  useLayoutEffect(() => {
    const element = field.current;
    if (restoreCaret.current && element !== null && document.activeElement === element) {
      element.setSelectionRange(caret.current.start, caret.current.end);
      restoreCaret.current = false;
    }
    follow();
  }, [value, field, follow]);

  return {
    open,
    placement,

    /** Opens the list as wide as the field, keeping where the caret was. */
    opened: (): void => {
      const element = field.current;
      const box = element?.closest('.ag-text-field-box');
      if (element === null || box === null || box === undefined) return;
      caret.current = {
        start: element.selectionStart ?? value.length,
        end: element.selectionEnd ?? value.length,
      };
      setPlacement(placementOf(box));
      setOpen(true);
    },
    closed: (): void => {
      setOpen(false);
    },

    /** Writes the chosen token over the selection the caret held. */
    insert: (token: TemplateToken): void => {
      const { next, after } = withToken(value, caret.current, token);
      // Stopped at the bound what reads the value has, as typing is.
      if (maxLength !== undefined && next.length > maxLength) return;
      caret.current = { start: after, end: after };
      restoreCaret.current = true;
      onValueChange(next);
    },

    /** Gives focus back to the field, with the caret where it was or after the token. */
    backToField: (): void => {
      const element = field.current;
      if (element === null) return;
      element.focus();
      element.setSelectionRange(caret.current.start, caret.current.end);
      follow();
    },
  };
}
