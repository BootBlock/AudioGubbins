/**
 * The modal dialogue.
 *
 * Focus moves into it and comes back out to where it started, Escape closes it,
 * a screen reader is told what appeared, and the rest of the application is
 * inert while it is open. Radix solves those; this applies the solution the
 * same way to every dialogue, in the design language's frosted glass.
 */

import { Dialog } from 'radix-ui';
import { useId, useRef, type ReactNode } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { DialogueNotice, useDialogueOpen } from '../announcement.js';
import { Button, ButtonTone } from '../button.js';
import { useFocusReturn } from '../focus-return.js';

/** What a dialogue takes. */
export interface ModalDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;

  /** The dialogue's heading, a few words such as "File already exists". Also its accessible name. */
  readonly title: string;

  /** The glyph before the title, in the accent. */
  readonly icon?: IconName;

  /**
   * A sentence describing what the dialogue is for: the explanation the terse
   * title leaves out, at the head of the body.
   *
   * Required rather than optional: a screen-reader user meets the dialogue with
   * no surrounding context, and a title alone often does not say what will
   * happen. Radix warns when it is missing; making it required means the
   * warning never has to appear.
   */
  readonly description: string;

  /**
   * The accessible name of a close button at the header's far end, where the
   * dialogue has one. Without it the dialogue closes by Escape and by its own
   * actions alone.
   */
  readonly closeLabel?: string;

  readonly children: ReactNode;

  /**
   * The footer's leading side: a status, or the reason the main action cannot
   * be taken. Where the dialogue is too narrow for it beside the actions, it
   * sits above them.
   */
  readonly status?: ReactNode;

  /**
   * The buttons along the bottom, at its trailing end: the safe action first,
   * and a destructive action last, after Cancel or Keep. The order given is the
   * order drawn and the order the keyboard meets them in.
   */
  readonly actions?: ReactNode;
}

/**
 * Leaves Escape to a control that records key presses while it listens.
 *
 * The dialogue listens in the capture phase, so without this it would close
 * before a shortcut recorder saw the key it uses to stop recording, and the
 * recording would be lost with the dialogue.
 */
function leaveEscapeToRecorder(event: KeyboardEvent): void {
  if (
    event.target instanceof Element &&
    event.target.closest('[data-ag-captures-escape]') !== null
  ) {
    event.preventDefault();
  }
}

/** The glyph in the accent, the terse title, and the close button at the far end. */
function DialogueHeader({
  title,
  icon,
  closeLabel,
}: Pick<ModalDialogProps, 'title' | 'icon' | 'closeLabel'>): ReactNode {
  return (
    <header className="ag-dialog-header">
      {icon !== undefined && <Icon name={icon} />}
      <Dialog.Title className="ag-dialog-title">{title}</Dialog.Title>
      {closeLabel !== undefined && (
        <Dialog.Close asChild>
          <Button tone={ButtonTone.Quiet} iconOnly label={closeLabel}>
            <Icon name="close" />
          </Button>
        </Dialog.Close>
      )}
    </header>
  );
}

/**
 * A modal dialogue: a header holding its title, then what it holds, which
 * scrolls, then a footer that does not.
 *
 * A notice raised while it is open is shown in the footer, above its actions,
 * and not over the page: see `NoticeProvider`. The footer stays in sight
 * because the refusal in it has to be: above the actions of a dialogue that
 * scrolled as a whole, it would be out of sight whenever the reader pressed a
 * control near the top. Only the part between scrolls, so no control can be
 * scrolled under the footer, and the footer has no cap, so it never cuts the
 * refusal. Where the three are taller than the page allows, the dialogue
 * scrolls as a whole, and the reader can scroll to the part of a refusal the
 * control they are on leaves out of sight.
 */
export function ModalDialog({
  open,
  onOpenChange,
  title,
  icon,
  description,
  closeLabel,
  children,
  status,
  actions,
}: ModalDialogProps): ReactNode {
  const content = useRef<HTMLDivElement | null>(null);

  const restoreFocus = useFocusReturn(content);

  const dialogue = useId();
  useDialogueOpen(dialogue, open);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ag-dialog-overlay" />
        <Dialog.Content
          ref={content}
          className="ag-dialog"
          // Said of itself, as Radix leaves unsaid: the page behind is inert
          // while it is open, which assistive technology is told by this and
          // the application's shortcuts read from it.
          aria-modal="true"
          onEscapeKeyDown={leaveEscapeToRecorder}
          onCloseAutoFocus={(event) => {
            // Left to Radix when nothing could be restored, rather than
            // pretending otherwise. That happens when the dialogue was opened
            // before the user had focused anything, where the body is where
            // focus genuinely was.
            if (restoreFocus()) event.preventDefault();
          }}
        >
          <DialogueHeader
            title={title}
            {...(icon === undefined ? {} : { icon })}
            {...(closeLabel === undefined ? {} : { closeLabel })}
          />
          <div className="ag-dialog-scroll">
            <Dialog.Description className="ag-dialog-description">{description}</Dialog.Description>
            <div className="ag-dialog-body">{children}</div>
          </div>
          <div className="ag-dialog-footer">
            <DialogueNotice dialogue={dialogue} />
            {status !== undefined && <div className="ag-dialog-status">{status}</div>}
            {actions !== undefined && <div className="ag-dialog-actions">{actions}</div>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
