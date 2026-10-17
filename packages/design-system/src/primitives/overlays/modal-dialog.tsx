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
import { Hint, type HintProps } from './hint.js';

/**
 * What kind of dialogue it is, which sets its width from the density's
 * `--ag-dialogue-width-*` token: a dialogue is as wide as what it holds needs.
 */
export const DialogueVariant = {
  /** One thing under way, such as a file exporting. */
  Narrow: 'narrow',

  /** A prompt or a confirmation: a sentence or two and its actions. */
  Standard: 'standard',

  /** Sections and forms, such as Projects or Export. */
  Wide: 'wide',

  /** Pages of its own, such as Settings or a guided workflow. */
  Spacious: 'spacious',

  /**
   * The command palette: its field is its head, so the title and the
   * description are said to a screen reader and not drawn, what it holds runs
   * to its edges, and it hangs from a fixed place near the top of the window,
   * so its field stays where it was as the list under it grows and shrinks.
   */
  Palette: 'palette',
} as const;

/** What kind of dialogue it is. */
export type DialogueVariant = (typeof DialogueVariant)[keyof typeof DialogueVariant];

/** What every dialogue takes, whatever its kind. */
export interface DialogueFields {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;

  /** The dialogue's heading, a few words such as "File already exists". Also its accessible name. */
  readonly title: string;

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

  readonly children: ReactNode;

  /**
   * The footer's leading side: a status, or the reason the main action cannot
   * be taken. Where the dialogue is too narrow for it beside the actions, it
   * sits above them. The palette's key hints go here.
   */
  readonly status?: ReactNode;

  /**
   * The buttons along the bottom, at its trailing end: the safe action first,
   * and a destructive action last, after Cancel or Keep. The order given is the
   * order drawn and the order the keyboard meets them in.
   */
  readonly actions?: ReactNode;
}

/** The head a dialogue draws: every kind but the palette. */
export interface DrawnDialogueHead {
  /** What kind of dialogue it is, which sets its width. Standard when left out. */
  readonly variant?: Exclude<DialogueVariant, typeof DialogueVariant.Palette>;

  /** The glyph before the title, in the accent. */
  readonly icon?: IconName;

  /**
   * An (i) beside the title, holding what the dialogue as a whole is for where
   * that needs more than its description (design language, section 13).
   */
  readonly hint?: HintProps;

  /**
   * The dialogue's own controls in its header, between the title and the close
   * button: the segmented choice of its sections, as Projects has.
   */
  readonly headerControls?: ReactNode;

  /**
   * The accessible name of a close button at the header's far end, where the
   * dialogue has one. Without it the dialogue closes by Escape and by its own
   * actions alone.
   */
  readonly closeLabel?: string;
}

/**
 * The palette's head, which is said and not drawn, so it holds nothing a
 * reader would have to see or press: a control in it would be reached by Tab
 * and be invisible.
 */
export interface PaletteDialogueHead {
  readonly variant: typeof DialogueVariant.Palette;
  readonly icon?: never;
  readonly hint?: never;
  readonly headerControls?: never;
  readonly closeLabel?: never;
}

/** What a dialogue takes. */
export type ModalDialogProps = DialogueFields & (DrawnDialogueHead | PaletteDialogueHead);

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

/**
 * The glyph in the accent, the terse title and its hint, the dialogue's own
 * controls, and the close button at the far end.
 */
function DialogueHeader({
  title,
  icon,
  hint,
  headerControls,
  closeLabel,
}: Pick<DialogueFields, 'title'> & Omit<DrawnDialogueHead, 'variant'>): ReactNode {
  return (
    <header className="ag-dialog-header">
      <div className="ag-dialog-heading">
        {icon !== undefined && <Icon name={icon} />}
        <Dialog.Title className="ag-dialog-title">{title}</Dialog.Title>
        {hint !== undefined && <Hint {...hint} />}
      </div>
      {headerControls !== undefined && (
        <div className="ag-dialog-header-controls">{headerControls}</div>
      )}
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
export function ModalDialog(props: ModalDialogProps): ReactNode {
  const { open, onOpenChange, title, description, children, status, actions } = props;
  const variant = props.variant ?? DialogueVariant.Standard;

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
          data-ag-variant={variant}
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
          {props.variant === DialogueVariant.Palette ? (
            <Dialog.Title className="ag-visually-hidden">{title}</Dialog.Title>
          ) : (
            <DialogueHeader
              title={title}
              {...(props.icon === undefined ? {} : { icon: props.icon })}
              {...(props.hint === undefined ? {} : { hint: props.hint })}
              {...(props.headerControls === undefined
                ? {}
                : { headerControls: props.headerControls })}
              {...(props.closeLabel === undefined ? {} : { closeLabel: props.closeLabel })}
            />
          )}
          <div className="ag-dialog-scroll">
            <Dialog.Description
              className={
                variant === DialogueVariant.Palette
                  ? 'ag-visually-hidden'
                  : 'ag-dialog-description'
              }
            >
              {description}
            </Dialog.Description>
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
