/**
 * The stored text AudioGubbins could not read, offered to export and discard
 * where the settings speak of what it was: the workspaces' in the Workspaces
 * section, the shortcut profiles' in the Shortcuts section.
 *
 * Shown whenever there is any, whether or not its notice still stands, and
 * before any write is withheld for want of room: the export is how the user
 * keeps what could not be read, and the discard, which cannot be undone, is
 * asked for twice (REQ-STOR-106). Both run a command (REQ-EDIT-073).
 */

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';

import { Button, ButtonTone } from '@audiogubbins/design-system';

import { subjectOf, type NoticeAbout } from '../../state/recovery-notices.js';
import type { UnreadText } from '../../state/text-custody.js';
import type { RunCommand } from './section.js';

/** What the block needs. */
export interface UnreadTextsProps {
  /** What there is of the text that could not be read, each thing only where there is any. */
  readonly unread: readonly UnreadText[];

  readonly run: RunCommand;
}

/** A number of texts, as a sentence opens with it. */
function textsCounted(count: number): string {
  return count === 1 ? 'One text' : `${String(count)} texts`;
}

/**
 * What there is of the text about one thing, and where it is, in a sentence.
 * Text left where it was found is why a store's writes are withheld, so it is
 * said apart from the text set aside.
 */
function describeUnread({ about, setAside, leftInPlace }: UnreadText): string {
  const subject = `about ${subjectOf(about)} that could not be read`;
  const one = leftInPlace === 1;
  const left = `left where ${one ? 'it was' : 'they were'} found, for want of room to set ${one ? 'it' : 'them'} aside`;
  if (leftInPlace === 0) {
    return `${textsCounted(setAside)} ${subject} ${setAside === 1 ? 'is' : 'are'} set aside.`;
  }
  if (setAside === 0) {
    return `${textsCounted(leftInPlace)} ${subject} ${one ? 'is' : 'are'} ${left}.`;
  }
  return `${textsCounted(setAside)} ${subject} ${setAside === 1 ? 'is' : 'are'} set aside, and ${one ? 'one' : String(leftInPlace)} more ${one ? 'is' : 'are'} ${left}.`;
}

/**
 * The second asking of a discard, which cannot be undone: what it costs, and
 * the choice between discarding and keeping. Focus goes to the choice that
 * loses nothing, since the button that asked is gone.
 */
function DiscardConfirmation({
  which,
  onDiscard,
  onKeep,
}: {
  /** What is discarded, as a button's name ends. */
  readonly which: string;
  readonly onDiscard: () => void;
  readonly onKeep: () => void;
}): ReactNode {
  const warningId = useId();
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keep.current?.focus();
  }, []);

  return (
    <div className="ag-settings-row">
      <p id={warningId} className="ag-settings-note" data-ag-status="unavailable">
        Discarding deletes this text for good, and nothing can bring it back. Export it first to
        keep a copy.
      </p>
      <Button
        tone={ButtonTone.Destructive}
        label={`Discard for good ${which}`}
        aria-describedby={warningId}
        onClick={onDiscard}
      >
        Discard for good
      </Button>
      <Button ref={keep} label={`Keep it, ${which}`} aria-describedby={warningId} onClick={onKeep}>
        Keep it
      </Button>
    </div>
  );
}

/**
 * Where Discard is, and what to call as the text is kept, so focus goes back
 * to Discard then: the button pressed to keep it is gone. Not on the first
 * drawing, when nothing was asked.
 */
function useFocusOnKeep(confirming: boolean): {
  readonly discard: RefObject<HTMLButtonElement | null>;
  readonly keeping: () => void;
} {
  const discard = useRef<HTMLButtonElement>(null);
  const kept = useRef(false);

  useEffect(() => {
    if (confirming || !kept.current) return;
    kept.current = false;
    discard.current?.focus();
  }, [confirming]);

  return {
    discard,
    keeping: () => {
      kept.current = true;
    },
  };
}

/** The text about one thing, with its export and its discard. */
function UnreadEntry({
  unread,
  run,
  onDiscarded,
}: {
  readonly unread: UnreadText;
  readonly run: RunCommand;
  readonly onDiscarded: () => void;
}): ReactNode {
  const { about } = unread;
  const [confirming, setConfirming] = useState(false);
  const { discard, keeping } = useFocusOnKeep(confirming);

  const which = `the text about ${subjectOf(about)} that could not be read`;

  return (
    <div>
      <p className="ag-settings-note">{describeUnread(unread)}</p>
      {confirming ? (
        <DiscardConfirmation
          which={which}
          onDiscard={() => {
            if (run('settings.discard-unread-text', { about })) onDiscarded();
            else setConfirming(false);
          }}
          onKeep={() => {
            keeping();
            setConfirming(false);
          }}
        />
      ) : (
        <div className="ag-settings-row">
          <Button
            label={`Export ${which}`}
            onClick={() => {
              run('settings.export-unread-text', { about });
            }}
          >
            Export
          </Button>
          <Button
            ref={discard}
            tone={ButtonTone.Destructive}
            label={`Discard ${which}`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Discard…
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The text that could not be read about each thing given, or nothing where
 * there is none. Focus goes to the block when a discard takes the entry that
 * held it, rather than to the page's body.
 */
export function UnreadTexts({ unread, run }: UnreadTextsProps): ReactNode {
  const block = useRef<HTMLDivElement>(null);
  const [discarded, setDiscarded] = useState<NoticeAbout | undefined>(undefined);

  useEffect(() => {
    if (discarded !== undefined) block.current?.focus();
  }, [discarded]);

  if (unread.length === 0 && discarded === undefined) return null;
  return (
    <div ref={block} tabIndex={-1} role="group" aria-label="Text that could not be read">
      {unread.map((one) => (
        <UnreadEntry
          key={one.about}
          unread={one}
          run={run}
          onDiscarded={() => {
            setDiscarded(one.about);
          }}
        />
      ))}
    </div>
  );
}
