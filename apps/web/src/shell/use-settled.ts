/**
 * A value as it is once the user stops changing it.
 *
 * A polite live region queues rather than replaces, so a sentence that changes
 * on every keystroke or every key press is read out in full, once per change,
 * before the reader reaches the one they wanted: eight sentences for a
 * eight-letter search, and a fifty-five-word instruction again after each of
 * the nine keys it asked for. The practice for anything a live region reports
 * while the user is still working is to wait for a pause, which is what this
 * does.
 *
 * Here rather than in each surface: the palette's result count, the export
 * dialogue's note preview and the Shortcuts settings' progress all want the
 * same wait.
 */

import { useEffect, useState } from 'react';

/** How long the user must stop before what changed is said. */
const QUIET_MS = 500;

/**
 * A value that has settled, or the fact that nothing has settled yet.
 *
 * Two answers rather than one. Answered as the value or `undefined`, a caller
 * whose own value can be `undefined` could not tell "still changing" from
 * "settled, and there is nothing to say": a caller passing a
 * `string | undefined` would have the two meanings as the same value, and would
 * read correctly only where both cases happened to want an empty string.
 */
export type Settled<TValue> =
  | { readonly settled: true; readonly value: TValue }
  | { readonly settled: false; readonly value?: undefined };

/** Nothing has settled yet, which is where every wait starts. */
const NOTHING_YET = { settled: false } as const;

/**
 * `value` once it has stopped changing for {@link QUIET_MS}.
 *
 * Answers the value rather than a sentence, so each caller says it in its own
 * words and nothing here has to know about any of them.
 */
export function useSettled<TValue>(value: TValue): Settled<TValue> {
  const [settled, setSettled] = useState<Settled<TValue>>(NOTHING_YET);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled({ settled: true, value });
    }, QUIET_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [value]);

  return settled;
}
