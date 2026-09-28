/**
 * Settings controls that stay in the tab order while they cannot be used.
 *
 * Shared by the sections whose controls run a command that can be unavailable:
 * each reads the command's own availability, so no section decides for itself
 * what is allowed.
 */

import { useId, type ReactNode, type Ref } from 'react';

import { Button, type ButtonTone } from '@audiogubbins/design-system';

/**
 * A button that stays in the tab order while it cannot be used, tied to what
 * says why, and does nothing when pressed then.
 *
 * Disabled, a button would leave the tab order and say nothing, and enabled
 * whatever the command answers, Reset could be pressed on a workspace with
 * nothing to reset. The menus show such a command unavailable with its reason,
 * and these buttons answer as the menus do. The reason is said beside the
 * button ({@link ReasonedButton}), or once above the many it is the reason of
 * ({@link useSharedReasons}).
 */
export function NotedButton({
  reasonId,
  onPress,
  tone,
  compact,
  label,
  ref,
  children,
}: {
  /** The element saying why it cannot be used now, or `undefined` when it can. */
  readonly reasonId: string | undefined;
  readonly onPress: () => void;
  readonly tone?: ButtonTone;
  readonly compact?: boolean;
  readonly label?: string;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Button
      {...(tone === undefined ? {} : { tone })}
      {...(compact === undefined ? {} : { compact })}
      {...(label === undefined ? {} : { label })}
      {...(ref === undefined ? {} : { ref })}
      aria-disabled={reasonId !== undefined}
      {...(reasonId === undefined ? {} : { 'aria-describedby': reasonId })}
      onClick={() => {
        if (reasonId === undefined) onPress();
      }}
    >
      {children}
    </Button>
  );
}

/** A {@link NotedButton} with its reason beside it. */
export function ReasonedButton({
  reason,
  onPress,
  tone,
  children,
}: {
  readonly reason: string | undefined;
  readonly onPress: () => void;
  readonly tone?: ButtonTone;
  readonly children: ReactNode;
}): ReactNode {
  const reasonId = useId();
  return (
    <span className="ag-settings-reasoned">
      <NotedButton
        {...(tone === undefined ? {} : { tone })}
        reasonId={reason === undefined ? undefined : reasonId}
        onPress={onPress}
      >
        {children}
      </NotedButton>
      {reason !== undefined && (
        // The state it is, which is what colours it: the attribute says a
        // thing cannot be done, and the reason beside a button that cannot be
        // pressed is exactly that.
        <span id={reasonId} className="ag-settings-note" data-ag-status="unavailable">
          {reason}
        </span>
      )}
    </span>
  );
}

/**
 * A file chooser drawn as a button, which stays in the tab order while it
 * cannot be used, tied to what says why, and opens no picker then.
 *
 * A file input rather than a button, because only a real one opens the
 * browser's own picker. The label is the control a user sees and operates;
 * the input is hidden from sight and not from the accessibility tree, so it
 * keeps its name, its focus ring and its place in the tab order, and it
 * carries the state and the reason. The label is marked unavailable with it,
 * so it looks as an unavailable button does.
 */
export function NotedFileButton({
  reasonId,
  accept,
  onFile,
  children,
}: {
  /** The element saying why it cannot be used now, or `undefined` when it can. */
  readonly reasonId: string | undefined;

  /** The kinds of file the picker offers. */
  readonly accept: string;

  /** Takes the file chosen. */
  readonly onFile: (file: File) => void;

  readonly children: ReactNode;
}): ReactNode {
  return (
    <label
      className="ag-button ag-file-button"
      {...(reasonId === undefined ? {} : { 'data-ag-unavailable': '' })}
    >
      {children}
      <input
        type="file"
        accept={accept}
        className="ag-visually-hidden"
        aria-disabled={reasonId !== undefined}
        {...(reasonId === undefined ? {} : { 'aria-describedby': reasonId })}
        onClick={(event) => {
          // A press on the label reaches the input as this click, whose
          // default is the picker, so no file is chosen and none is read.
          if (reasonId !== undefined) event.preventDefault();
        }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared at once, so choosing the same file again is a change.
          event.target.value = '';
          if (file !== undefined) onFile(file);
        }}
      />
    </label>
  );
}

/** The reasons of many controls, each said once, and the note saying each. */
export interface SharedReasons<Control extends string> {
  /** Each reason once, in the order first given, with its note's id. */
  readonly said: readonly { readonly id: string; readonly reason: string }[];

  /**
   * The note saying why `control` cannot be used now, or `undefined` when it
   * can.
   */
  readonly idOf: (control: Control) => string | undefined;
}

/**
 * The reasons of many controls, each said once, for {@link SharedReasonNotes}
 * to show above them.
 *
 * Said beside each, one reason for every row of a table would be read by a
 * screen reader at every row, and fill the table with one sentence. A control
 * whose reason differs from the others' has a note of its own.
 */
export function useSharedReasons<Control extends string>(
  reasons: Readonly<Record<Control, string | undefined>>,
): SharedReasons<Control> {
  const base = useId();
  const said = [...new Set(Object.values<string | undefined>(reasons))]
    .filter((reason) => reason !== undefined)
    .map((reason, index) => ({ id: `${base}-${String(index)}`, reason }));
  return {
    said,
    idOf: (control) => said.find((one) => one.reason === reasons[control])?.id,
  };
}

/** The notes of {@link useSharedReasons}, each in the state it says. */
export function SharedReasonNotes<Control extends string>({
  reasons,
}: {
  readonly reasons: SharedReasons<Control>;
}): ReactNode {
  return reasons.said.map(({ id, reason }) => (
    <p key={id} id={id} className="ag-settings-note" data-ag-status="unavailable">
      {reason}
    </p>
  ));
}
