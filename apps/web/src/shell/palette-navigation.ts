/**
 * Where a key press moves the command palette's highlight.
 *
 * Apart from the palette so the rules can be read and tested without rendering
 * it: which keys belong to the list and which to the search field is the part
 * of the palette most easily got wrong.
 */

/** The parts of a key press the palette's list reads. */
export interface ListPress {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * The result a press highlights, or `undefined` when the press is not the
 * list's to handle and belongs to the search field.
 *
 * The arrows wrap, so the first result is one press from the last. The ends of
 * the list are Control or Command with Home and End. Home and End on their own
 * belong to the text field, as they do in any editable combobox: taking them
 * would move the list when a user who had typed "workspce" pressed Home to mend
 * the start of the word. Not with Shift, which selects to the start or the end
 * of the field.
 */
export function highlightAfter(
  press: ListPress,
  highlighted: number,
  count: number,
): number | undefined {
  const toEnd = (press.ctrlKey || press.metaKey) && !press.shiftKey;
  const span = Math.max(count, 1);

  if (toEnd && press.key === 'Home' && count > 0) return 0;
  if (toEnd && press.key === 'End' && count > 0) return count - 1;
  if (press.key === 'ArrowDown') return (highlighted + 1) % span;
  if (press.key === 'ArrowUp') return (highlighted - 1 + span) % span;
  return undefined;
}
