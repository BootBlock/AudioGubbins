/**
 * Telling the user something they did not ask about.
 *
 * Two channels for one sentence: a live region a screen reader reads, and a
 * notice a sighted user can see. They live together because they are halves of
 * one behaviour, and because kept apart, one of them would go missing: a
 * refused command announced and shown nowhere is indistinguishable from a
 * command that did nothing.
 *
 * Nothing here moves focus. An announcement interrupts what a user is reading,
 * never what they are doing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** Something to say to a screen reader. */
export interface LiveAnnouncement {
  /** British-English text, a sentence. */
  readonly text: string;

  /** Whether it interrupts what is being read. */
  readonly urgent: boolean;

  /** Distinguishes this announcement from an identical earlier one. */
  readonly sequence: number;

  /**
   * Whether it is shown as well as said. Shown unless this says `false`.
   *
   * `false` for what is already on screen in its own place: a chord waiting for
   * its next key is in the status bar, and shown again as a notice it would
   * stay over the command palette the chord has just opened.
   */
  readonly shown?: boolean;

  /**
   * Whether it says why something was not done. A refusal stays as long as an
   * urgent notice, however politely it is spoken: its reason takes as long to
   * read and act on either way, and a polite one would otherwise be gone in
   * five seconds.
   */
  readonly refusal?: boolean;
}

/**
 * How many regions each politeness keeps.
 *
 * Two, used in turn. A live region fires when its text changes, so saying the
 * same thing twice into one region says it once: React sees the same string,
 * leaves the text node alone, and the second refusal is silent. Alternating
 * makes every announcement a real text change in whichever region is idle. With
 * one region, three repeated refusals would produce no DOM mutation in it at
 * all.
 */
const REGIONS_PER_POLITENESS = 2;

/** The regions, in the order they are rendered. */
const REGION_SLOTS = [
  { urgent: false, role: 'status', live: 'polite' },
  { urgent: true, role: 'alert', live: 'assertive' },
] as const;

/**
 * Announces a change to a screen reader without moving focus.
 *
 * For something the user needs to know but did not ask about: a command
 * refusing, an autosave finishing, a capability turning out to be unavailable.
 *
 * Politeness is chosen by rendering into a different region rather than by
 * changing `aria-live` on one. Mutating that attribute is unreliable across
 * screen readers, because a region's politeness is taken when the region is
 * created rather than when its text changes, so an urgent message could arrive
 * politely or a polite one could interrupt.
 */
export function LiveRegion({
  announcement,
}: {
  readonly announcement?: LiveAnnouncement;
}): ReactNode {
  const slot = (announcement?.sequence ?? 0) % REGIONS_PER_POLITENESS;

  return (
    <div className="ag-live-regions">
      {REGION_SLOTS.flatMap((politeness) =>
        Array.from({ length: REGIONS_PER_POLITENESS }, (_, index) => (
          <div
            key={`${politeness.live}-${String(index)}`}
            className="ag-visually-hidden"
            role={politeness.role}
            aria-live={politeness.live}
            aria-atomic="true"
          >
            {announcement?.urgent === politeness.urgent && index === slot ? announcement.text : ''}
          </div>
        )),
      )}
    </div>
  );
}

/**
 * How long a notice stays on screen, in milliseconds.
 *
 * Long enough to read a sentence at an unhurried pace, and long enough to reach
 * for a mouse after noticing it. An urgent notice, and any refusal, stays
 * longer, because the reason something was refused usually takes longer to act
 * on than a confirmation that something worked.
 *
 * A floor rather than the whole answer: see {@link noticeDuration}.
 */
export const NOTICE_DURATION = { ordinary: 5_000, urgent: 8_000 } as const;

/**
 * How long an unhurried reader takes over one word, in milliseconds.
 *
 * Two hundred words a minute, which is the slow end of what is usually
 * measured for reading on screen. A notice is read once, in the middle of
 * doing something else, so the slow end is the right one.
 */
const MILLISECONDS_A_WORD = 300;

/**
 * The longest any notice stays, however much it says.
 *
 * Length is a floor and not the whole answer: with no ceiling, a notice quoting
 * stored text would stay as long as its word count said, over a surface the
 * reader may be using. A hundred words is more than any notice worth reading on
 * the way past, and what is longer belongs in the status bar.
 */
const LONGEST_NOTICE_MS = 100 * MILLISECONDS_A_WORD;

/**
 * How long a notice stays, given what it says.
 *
 * The fixed times above are right for a sentence. They are not right for
 * everything: a notice about storage that could not be read can run to about a
 * hundred and forty words, which at an unhurried pace is over forty seconds of
 * reading, and the fixed times would show it for eight. A notice that cannot be
 * read before it goes is a notice that was never shown.
 */
function noticeDuration(text: string, lasting: boolean): number {
  const base = lasting ? NOTICE_DURATION.urgent : NOTICE_DURATION.ordinary;
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  return Math.min(LONGEST_NOTICE_MS, Math.max(base, words * MILLISECONDS_A_WORD));
}

/**
 * Who shows a notice: the page, or the dialogue that was open when it arrived.
 *
 * A notice belongs to the surface it was raised on. Drawn over a dialogue, a
 * notice would lie over part of it wherever it was put, and every place covers
 * something the reader needs: the actions at the foot, the title or a control
 * at the top, and, placed beside the reader's focus, it would be squeezed to a
 * sliver too small to read once the dialogue itself held focus, as a click on
 * its text gives it. In the dialogue's own flow a notice covers nothing, and
 * the footer it is in never cuts it: where the dialogue is taller than the
 * page, the reader scrolls the dialogue to reach it.
 *
 * `nobody` is a notice whose surface has gone: a dialogue closed with its
 * notice in it, or a notice over the page when a dialogue opened over it.
 */
type NoticeOwner =
  | { readonly by: 'the page' }
  | { readonly by: 'a dialogue'; readonly dialogue: string }
  | { readonly by: 'nobody' };

/** A notice's owner, with the notice it was settled for. */
interface NoticeOwnership {
  readonly sequence: number;
  readonly owner: NoticeOwner;
}

/** What the surfaces read, and what a dialogue tells them. */
interface NoticeChannel {
  /** The latest notice. */
  readonly notice: LiveAnnouncement | undefined;

  /** Who shows it, or `undefined` until that is settled. */
  readonly owner: NoticeOwner | undefined;

  /** A dialogue opened: what arrives from now on is its own. */
  readonly opened: (dialogue: string) => void;

  /** A dialogue closed: its notice goes with it. */
  readonly closed: (dialogue: string) => void;
}

/**
 * No channel outside a {@link NoticeProvider}. A default that showed nothing
 * would make a surface rendered outside it silent, and a refusal could then be
 * said and shown nowhere.
 */
const NoticeContext = createContext<NoticeChannel | undefined>(undefined);

/** The channel, or an error naming what is missing. */
function useNoticeChannel(reader: string): NoticeChannel {
  const channel = useContext(NoticeContext);
  if (channel === undefined) {
    throw new Error(`${reader} was rendered outside a NoticeProvider, so no notice reaches it.`);
  }
  return channel;
}

/** What {@link NoticeProvider} takes. */
export interface NoticeProviderProps {
  /** The latest notice, or `undefined` when there is nothing to show. */
  readonly notice: LiveAnnouncement | undefined;

  readonly children: ReactNode;
}

/**
 * Says the latest notice, and hands it to the surface it belongs to.
 *
 * The one way in for both halves of an announcement: it renders the
 * {@link LiveRegion} a screen reader reads, and every visible surface reads
 * the same notice from it, so neither half can be given a notice the other was
 * not. Around everything that can show one: the {@link NoticeSurface} over the
 * page, and every `ModalDialog`, which shows a notice raised while it is open
 * in its own flow. Settled when the notice arrives, from the dialogues open at
 * that moment, so a command that closes its dialogue and then reports is shown
 * over the page it returned to.
 */
export function NoticeProvider({ notice, children }: NoticeProviderProps): ReactNode {
  // The dialogues open now, the one opened last on top. Read when a notice
  // arrives rather than drawn from, so it is kept outside the render.
  const open = useRef<readonly string[]>([]);
  const [ownership, setOwnership] = useState<NoticeOwnership | undefined>(undefined);

  const sequence = notice?.sequence;
  // A layout effect, so a notice is placed before it is painted. A dialogue's
  // own effect runs before this one, so one opened in the same step as the
  // notice arrived is already counted.
  useLayoutEffect(() => {
    if (sequence === undefined) return;
    const top = open.current.at(-1);
    setOwnership({
      sequence,
      owner: top === undefined ? { by: 'the page' } : { by: 'a dialogue', dialogue: top },
    });
  }, [sequence]);

  const opened = useCallback((dialogue: string) => {
    open.current = [...open.current.filter((each) => each !== dialogue), dialogue];
    setOwnership((current) =>
      current?.owner.by === 'the page' ? { ...current, owner: { by: 'nobody' } } : current,
    );
  }, []);

  const closed = useCallback((dialogue: string) => {
    open.current = open.current.filter((each) => each !== dialogue);
    setOwnership((current) =>
      current?.owner.by === 'a dialogue' && current.owner.dialogue === dialogue
        ? { ...current, owner: { by: 'nobody' } }
        : current,
    );
  }, []);

  const owner =
    notice !== undefined && ownership?.sequence === notice.sequence ? ownership.owner : undefined;
  const channel = useMemo(
    () => ({ notice, owner, opened, closed }),
    [notice, owner, opened, closed],
  );

  return (
    <NoticeContext.Provider value={channel}>
      <LiveRegion {...(notice === undefined ? {} : { announcement: notice })} />
      {children}
    </NoticeContext.Provider>
  );
}

/** What the notice surface needs. */
export interface NoticeSurfaceProps {
  /** Overrides how long it stays. For tests and previews. */
  readonly durationMs?: number;
}

/**
 * The visible half of an announcement, over the page.
 *
 * A live region tells a screen reader and shows a sighted user nothing, so
 * without this a command that refused would look exactly like a command that
 * did nothing. That is how a user decides an application is unreliable. This is
 * the other half: the same sentence, where it can be read.
 *
 * It is `aria-hidden`, because the live region holds the same sentence until
 * the next one, where a screen-reader user can find it again: shown to them
 * here as well, they would meet it twice. A dialogue's line is not hidden,
 * because the live region lies outside the dialogue and is reached only by
 * browsing out of it, while the line sits beside the control pressed.
 *
 * Portalled into the document body and given a stacking order rather than
 * being placed in the status bar, which a notice can then be drawn clear of.
 * A notice raised while a dialogue is open is the dialogue's, and is shown in
 * it rather than here: see {@link NoticeProvider}.
 */
export function NoticeSurface({ durationMs }: NoticeSurfaceProps): ReactNode {
  const { notice, owner } = useNoticeChannel('NoticeSurface');

  // Which notice has had its time, rather than which notice is showing. What
  // is showing is derived from the channel, so the surface never has to be
  // put into a state the channel already describes.
  const [dismissed, setDismissed] = useState<number | undefined>(undefined);

  const shown =
    notice !== undefined &&
    owner?.by === 'the page' &&
    notice.shown !== false &&
    notice.sequence !== dismissed
      ? notice
      : undefined;

  useEffect(() => {
    if (shown === undefined) return undefined;

    const lasting = shown.urgent || shown.refusal === true;
    const stay = durationMs ?? noticeDuration(shown.text, lasting);
    const timer = setTimeout(() => {
      setDismissed(shown.sequence);
    }, stay);

    return () => {
      clearTimeout(timer);
    };
  }, [shown, durationMs]);

  if (shown === undefined) return null;

  return createPortal(
    <div
      className="ag-notice"
      data-ag-notice={shown.urgent ? 'urgent' : 'ordinary'}
      aria-hidden="true"
    >
      {shown.text}
    </div>,
    document.body,
  );
}

/**
 * Tells the notices that a dialogue is open, while it is.
 *
 * For `ModalDialog`. A layout effect, so the dialogue is counted before
 * a notice raised in the same step is placed.
 */
export function useDialogueOpen(dialogue: string, open: boolean): void {
  const { opened, closed } = useNoticeChannel('A dialogue');

  useLayoutEffect(() => {
    if (!open) return undefined;
    opened(dialogue);
    return () => {
      closed(dialogue);
    };
  }, [dialogue, open, opened, closed]);
}

/**
 * A notice raised while a dialogue is open, in the dialogue's flow.
 *
 * Above its actions, where the result of pressing one is read. It stays until
 * the next notice or until the dialogue closes, with no time of its own: it
 * covers nothing, so nothing is gained by taking it away, and a long refusal
 * taken away on a timer would be taken away from a reader part of the way
 * through it.
 *
 * Plain text to a screen reader, not a live region. The live region says it
 * once as it arrives, and a paragraph put into the page is not said as it
 * appears, so it is not heard twice. Not hidden, because a screen-reader user
 * whose announcement was cut off finds it again here, beside the control they
 * pressed: the live region lies outside the dialogue, and is reached only by
 * browsing out of it.
 *
 * In the dialogue's footer, which does not scroll with the rest. Where the
 * dialogue is too tall for the page and scrolls as a whole, the line is
 * brought into view as it arrives, and then the control the reader is on,
 * which wins where the visible part cannot hold both: the notice is in the
 * flow, so the reader can scroll to it, and a control scrolled out of view is
 * one they cannot see they are on.
 */
export function DialogueNotice({ dialogue }: { readonly dialogue: string }): ReactNode {
  const { notice, owner } = useNoticeChannel('DialogueNotice');
  const line = useRef<HTMLParagraphElement>(null);

  const shown =
    notice !== undefined &&
    owner?.by === 'a dialogue' &&
    owner.dialogue === dialogue &&
    notice.shown !== false
      ? notice
      : undefined;

  useLayoutEffect(() => {
    const element = line.current;
    if (shown === undefined || element === null) return;

    element.scrollIntoView({ block: 'nearest' });
    const focused = document.activeElement;
    const content = element.closest('.ag-dialog');
    if (
      focused instanceof HTMLElement &&
      focused !== content &&
      content?.contains(focused) === true
    ) {
      focused.scrollIntoView({ block: 'nearest' });
    }
  }, [shown]);

  if (shown === undefined) return null;

  return (
    <p
      ref={line}
      className="ag-dialog-notice"
      data-ag-notice={shown.urgent ? 'urgent' : 'ordinary'}
    >
      {shown.text}
    </p>
  );
}
