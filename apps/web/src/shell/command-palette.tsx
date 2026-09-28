/**
 * The command palette.
 *
 * REQ-EDIT-073 requires command discovery. The palette is how a user finds an
 * action whose menu they cannot remember, so it lists every command including
 * the ones that cannot run, with the reason. Hiding an unavailable command
 * makes it look as though it does not exist, and sends the user hunting through
 * menus for something that is simply not applicable yet.
 *
 * The ranking lives in `@audiogubbins/commands` and is tested there. This is
 * the surface: a field, a list, and the keyboard behaviour that makes a palette
 * usable without the pointer.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  type KeyboardConvention,
  searchCommands,
  type Command,
  type CommandId,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import { ModalDialog, VisuallyHidden } from '@audiogubbins/design-system';
import type { KeyboardLayout } from '@audiogubbins/input';

import { highlightAfter } from './palette-navigation.js';
import { useSettled } from './use-settled.js';

/**
 * What the palette needs.
 *
 * The palette stays mounted while it is shut. It has to: a dialogue remembers
 * where focus has been by listening from the moment it mounts, and one that
 * mounted as it opened would have learnt nothing to go back to. Closing it from
 * the palette's own handler is what resets the query and the highlight, without
 * an effect that sets state during render. A palette that remembered the last
 * search would run the wrong command for a user who opened it and pressed Enter
 * expecting their new one.
 */
export interface CommandPaletteProps<TContext> {
  readonly open: boolean;
  readonly onClose: () => void;

  readonly commands: readonly Command<TContext>[];
  readonly context: TContext;
  readonly profile: ShortcutProfile;
  readonly convention: KeyboardConvention;

  /** What the user's keyboard layout types, which each shortcut is written in. */
  readonly layout: KeyboardLayout;

  /** Runs the chosen command. */
  readonly onRun: (id: CommandId) => void;
}

/** The result count, once the reader has stopped typing. */
function useSettledCount(count: number): string {
  const settled = useSettled(count);
  if (!settled.settled) return '';
  if (settled.value === 0) return 'No commands match.';
  return settled.value === 1 ? 'One command matches.' : `${String(settled.value)} commands match.`;
}

/** Finds and runs a command by name. */
export function CommandPalette<TContext>({
  open,
  onClose,
  commands,
  context,
  profile,
  convention,
  layout,
  onRun,
}: CommandPaletteProps<TContext>): ReactNode {
  const [query, setQuery] = useState('');
  const [requested, setRequested] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const field = useRef<HTMLInputElement>(null);

  /** Closes the palette, leaving it ready for the next time it opens. */
  const close = (): void => {
    setQuery('');
    setRequested(0);
    onClose();
  };

  const results = useMemo(
    () => searchCommands(commands, query, { context, profile, convention, layout, limit: 40 }),
    [commands, query, context, profile, convention, layout],
  );

  // The highlight is clamped as it is read rather than corrected afterwards. A
  // stored index that outlives a shrinking list would leave Enter running
  // nothing while the interface showed something selected.
  const highlighted = Math.min(requested, Math.max(results.length - 1, 0));
  const settledCount = useSettledCount(results.length);

  const chosen = results[highlighted];

  // The list is a fixed scroll box holding about a dozen of up to forty
  // results, and `aria-activedescendant` moves a screen reader's cursor without
  // moving the browser's scroll. Unscrolled, a sighted keyboard user arrowing
  // past the twelfth result would watch the highlight leave the screen and then
  // press Enter on a command they could not see.
  useEffect(() => {
    const option = list.current?.children[highlighted];
    if (option instanceof HTMLElement) option.scrollIntoView({ block: 'nearest' });
  }, [highlighted, results.length]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const next = highlightAfter(event, highlighted, results.length);
    if (next !== undefined) {
      event.preventDefault();
      setRequested(next);
      return;
    }

    if (event.key === 'Enter' && chosen !== undefined) {
      event.preventDefault();

      // An unavailable command is offered so the user can see it and read why,
      // not so pressing Enter appears to work and does nothing.
      if (chosen.unavailableReason !== undefined) return;

      close();
      onRun(chosen.command.id);
    }
  };

  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Run a command"
      description="Type part of a command name. Use the arrow keys to choose, Control or Command with Home or End for the first or the last, and Enter to run it."
    >
      <div className="ag-palette">
        <label className="ag-visually-hidden" htmlFor="ag-palette-query">
          Search commands
        </label>
        <input
          ref={field}
          id="ag-palette-query"
          className="ag-palette-field ag-touch-sized"
          type="text"
          value={query}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search commands"
          role="combobox"
          // Expanded only while there is a list. It points at the results
          // either way: at the list, or at the sentence an empty search draws
          // in its place, which carries the same identifier, so the combobox
          // never names an element that does not exist.
          aria-expanded={results.length > 0}
          aria-controls="ag-palette-results"
          aria-activedescendant={
            chosen === undefined ? undefined : `ag-palette-${chosen.command.id}`
          }
          onChange={(event) => {
            setQuery(event.target.value);
            setRequested(0);
          }}
          onKeyDown={onKeyDown}
        />

        <VisuallyHidden>
          {/*
            `aria-atomic`, so the whole sentence is read rather than the number
            alone, which is what a browser may read from a region whose text
            changed in one place.
          */}
          <span aria-live="polite" aria-atomic="true">
            {settledCount}
          </span>
        </VisuallyHidden>

        {results.length === 0 ? (
          <p className="ag-palette-empty" id="ag-palette-results">
            No command matches that.
          </p>
        ) : (
          <ul ref={list} className="ag-palette-results" id="ag-palette-results" role="listbox">
            {results.map((result, index) => (
              // An option of a combobox's listbox is not focusable and takes
              // no key of its own: the field holds the keyboard, and Enter on
              // it runs the highlighted row. A key listener here would be a
              // second, unreachable route.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the listbox pattern keeps the keyboard on the field
              <li
                key={result.command.id}
                id={`ag-palette-${result.command.id}`}
                className="ag-palette-result ag-touch-sized"
                role="option"
                aria-selected={index === highlighted}
                aria-disabled={result.unavailableReason !== undefined}
                data-ag-highlighted={index === highlighted ? '' : undefined}
                // Pointer down is refused so that focus stays in the search
                // field: let through, it would move focus out and the palette
                // would close under the pointer before the click lands. Only
                // for a mouse, which is the pointer whose click follows a
                // refused press. On any other, refusing the press would also
                // suppress the mouse events the engine synthesises from the
                // tap, and WebKit's synthesised click would go with them: the
                // row would then run nothing at all. Were the exception named
                // as touch alone, a pencil, reported as `pen` through the same
                // pipeline, would take the route this refusal is narrowed to
                // cure. A tap moves focus out instead, and the click handler
                // puts it back where the row cannot run.
                onPointerDown={(event) => {
                  if (event.pointerType !== 'mouse') return;
                  event.preventDefault();
                }}
                // The command runs on the click, not on the press. Were it run
                // on the press, it could not be called off: a user with a
                // tremor, a head pointer or an imprecise touch could not slide
                // off the wrong row, and this phase has no undo (WCAG 2.5.2).
                onClick={() => {
                  if (result.unavailableReason !== undefined) {
                    field.current?.focus();
                    return;
                  }
                  close();
                  onRun(result.command.id);
                }}
              >
                <span className="ag-palette-label">{result.command.label}</span>

                {result.shortcutText !== undefined && (
                  <span className="ag-palette-shortcut">{result.shortcutText}</span>
                )}

                {result.unavailableReason !== undefined && (
                  <span className="ag-palette-reason">{result.unavailableReason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalDialog>
  );
}
