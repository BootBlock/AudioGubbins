/**
 * Which part of a Library entry's row is open, the targets, the new name or the
 * removal asked again, and where the focus goes as each opens and closes: into
 * the part as it is drawn, and back to the control that opened it once it
 * closes, so the person's place is kept.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

/** A part of a row that opens. */
export type Part = 'targets' | 'rename' | 'remove';

/** The part of a row that is open, and how each is opened and closed. */
export interface Opening {
  readonly open: Part | undefined;
  /** The control that opens `part`, which the focus goes back to as it closes. */
  readonly opener: (part: Part) => RefObject<HTMLButtonElement | null>;
  readonly show: (part: Part) => void;
  readonly close: () => void;
}

/** Gives the focus to `ref`'s element as it is drawn. */
export function useFocusOnShow(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    ref.current?.focus();
  }, [ref]);
}

/** One row's opening (see the module comment). */
export function useOpening(): Opening {
  const [open, setOpen] = useState<Part | undefined>(undefined);
  const returnTo = useRef<Part | undefined>(undefined);
  const targets = useRef<HTMLButtonElement>(null);
  const rename = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const opener = (part: Part): RefObject<HTMLButtonElement | null> =>
    part === 'targets' ? targets : part === 'rename' ? rename : remove;
  // Once the row is drawn again without the part that closed.
  useEffect(() => {
    const back = returnTo.current;
    if (open !== undefined || back === undefined) return;
    returnTo.current = undefined;
    (back === 'targets' ? targets : back === 'rename' ? rename : remove).current?.focus();
  }, [open]);
  return {
    open,
    opener,
    show: (part) => {
      returnTo.current = part;
      setOpen(part);
    },
    close: () => {
      setOpen(undefined);
    },
  };
}
