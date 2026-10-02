/**
 * Keeping text nobody has read until it is set aside, and how the user is told
 * where it is, and offered it to export or discard.
 *
 * A store that finds stored text it cannot read holds that text where it is,
 * sets it aside before anything is written over it, and, at the quota, writes
 * nothing over it and tries again with every write. What such a write keeps
 * back is said to the user when it starts, and what a later write keeps again
 * is said once it is kept. The workspace and the shortcut profiles each keep
 * such text; which texts, which parts of theirs a held text keeps back, and
 * what is said of those parts are theirs (`workspace-custody.ts`,
 * `profile-custody.ts`). Where the text is, that AudioGubbins tries again, and
 * what was dropped to make room for it, are worded here once for both, from
 * the nouns each store passes.
 *
 * Every text of a subject, set aside in this session or an earlier one, or
 * held where it was found, is the user's to export and to discard, whether or
 * not its notice still stands (REQ-UX-059, REQ-STOR-106).
 */

import type { Logger } from '@audiogubbins/diagnostics';

import { subjectOf, type NoticeAbout } from './recovery-notices.js';
import { textsSetAside } from './set-aside-texts.js';
import type { StateStorage, Withheld, WriteAccount } from './state-storage.js';

/** A text nobody has read, where it was found, and the key it is set aside under. */
export interface Unread {
  /** The key the text is stored under while it is held where it was found. */
  readonly found: string;

  readonly key: string;
  readonly text: string;
}

/**
 * Where a text nobody has read is, as its notice says it: kept aside, or left
 * where it was found. Left there, `meanwhile` says what comes of what the user
 * changes, kept beside it, or that there is no room (see {@link NO_ROOM}).
 */
export function whereTheTextIs(setAside: boolean, meanwhile: string): string {
  return setAside
    ? 'The text that could not be read is kept aside.'
    : `The text that could not be read is left where it is, and ${meanwhile}.`;
}

/**
 * Why a text is left where it is at the quota, as {@link whereTheTextIs}
 * finishes it. What that costs the user is said in the notice's fact (see
 * {@link factWithNoRoom}), and not again here.
 */
export const NO_ROOM = 'there is no room to set it aside';

/**
 * The fact of a notice whose text is left where it is for want of room: what
 * could not be read, then what cannot be kept until there is room, from the
 * noun for it as it opens a sentence, "The workspace on screen".
 *
 * Said in the fact rather than with where the text is, because the start
 * announcement says every notice's fact, however few words the facts leave for
 * the rest: what the user is losing is never the part left to the status bar.
 */
export function factWithNoRoom(fact: string, notKept: string): string {
  return `${fact} ${notKept} cannot be kept until there is room.`;
}

/**
 * That AudioGubbins tries again to set the text aside, and when. `eachTime`
 * names the change of the user's that writes the store, as "you change a
 * workspace": named as a change saved, beside a sentence saying the change
 * cannot be kept, it would say both.
 */
export function triesAgain(eachTime: string): string {
  return `AudioGubbins tries again each time ${eachTime}, and at the next start.`;
}

/**
 * Where the user can export the text that could not be read, or discard it:
 * the settings section `section` names, "Workspaces". Said last in a notice,
 * after where the text is, so a user who dismisses it knows it is still
 * theirs, and where.
 */
export function whereToExport(section: string): string {
  return `The ${section} settings can export what could not be read, or discard it.`;
}

/** The oldest texts dropped, counted, as a sentence names them. */
function oldestTexts(dropped: number): string {
  return dropped === 1
    ? 'the oldest text set aside before it was'
    : `the ${String(dropped)} oldest texts set aside before it were`;
}

/**
 * What a notice says of the older texts dropped to make room for its text, or
 * nothing where none was.
 */
export function droppedForIt(dropped: number): string {
  return dropped === 0 ? '' : ` To make room for it, ${oldestTexts(dropped)} dropped.`;
}

/**
 * Which parts of a store a write keeps back while texts are held, and what the
 * user is told about them.
 */
export interface HeldTextAccounting<Name extends string, Part> {
  /** The parts written nowhere, given which texts are still held. */
  readonly withheld: (isHeld: (name: Name) => boolean) => ReadonlySet<Part>;

  /** What a write that keeps back these parts says, or `undefined` for none. */
  readonly notKept: (parts: ReadonlySet<Part>) => Withheld | undefined;

  /** What a write that keeps these parts again says, or `undefined` for none. */
  readonly keptAgain: (parts: ReadonlySet<Part>) => string | undefined;
}

/**
 * What a store's texts nobody has read are about, as its notice and the
 * settings name it: the key its texts are set aside under, and those of its
 * texts that can be held where they were found.
 */
export interface UnreadSubject<Name extends string, About extends NoticeAbout> {
  readonly about: About;
  readonly key: string;
  readonly names: readonly Name[];
}

/** How much there is of the text nobody could read about one thing. */
export interface UnreadText {
  readonly about: NoticeAbout;

  /** How many texts are set aside, in this session or an earlier one. */
  readonly setAside: number;

  /** How many are left where they were found, for want of room. */
  readonly leftInPlace: number;
}

/**
 * What a store holds of its text nobody could read, each thing only where
 * there is any: `previous`, the list given, where nothing in it has changed,
 * so a store can tell whether there is anything new to show.
 */
export function unreadNow(
  previous: readonly UnreadText[],
  now: readonly UnreadText[],
): readonly UnreadText[] {
  const some = now.filter((one) => one.setAside + one.leftInPlace > 0);
  const same =
    some.length === previous.length &&
    some.every((one, index) => {
      const before = previous[index];
      return (
        before?.about === one.about &&
        before.setAside === one.setAside &&
        before.leftInPlace === one.leftInPlace
      );
    });
  return same ? previous : some;
}

/** The refusal to export or discard text about something where there is none. */
export function nothingUnreadAbout(about: NoticeAbout): string {
  return `There is no text about ${subjectOf(about)} that could not be read.`;
}

/** The refusal where the browser would not discard the text about something. */
export function notDiscarded(about: NoticeAbout): string {
  return `The browser would not discard the text about ${subjectOf(about)} that could not be read, so it is kept.`;
}

/**
 * What came of discarding text nobody could read: what the user is told the
 * next write keeps again, where the text kept anything back.
 */
export interface Discarded {
  readonly keptAgain: string | undefined;
}

/** One text nobody could read, as it is exported. */
export interface UnreadCopy {
  /** The key it is stored under now. */
  readonly key: string;

  /** Whether it is set aside, or left where it was found. */
  readonly setAside: boolean;

  readonly text: string;
}

/** The custody of a store's texts that nobody has read. */
export interface HeldTexts<Name extends string, About extends NoticeAbout, Part> {
  /** Whether a text is still where it was found, not set aside yet. */
  readonly isHeld: (name: Name) => boolean;

  /** How many older texts were dropped to make room for a text as it was set aside. */
  readonly dropped: (name: Name) => number;

  /**
   * Whether a part is written nowhere until there is room to set a text aside,
   * so something the user changes cannot be kept until there is.
   */
  readonly waitsForRoom: () => boolean;

  /**
   * Tries again to set aside each text still held, and answers what the write
   * that follows keeps back and keeps again, for the user.
   */
  readonly beforeWrite: () => WriteAccount;

  /**
   * Told which keys of that write were refused. A part is said to be kept
   * again only by a write kept whole, as the storage says it, so a write with
   * a refused key leaves it to be said by the next.
   */
  readonly written: (refused: readonly string[]) => void;

  /** How much there is of the text about `about`. */
  readonly unread: (about: About) => UnreadText;

  /** Every text about `about`, those set aside first, oldest first. */
  readonly copies: (about: About) => readonly UnreadCopy[];

  /**
   * Discards every text about `about`, set aside or held where it was found,
   * and answers the parts it lets the next write keep again, or `undefined`
   * where the browser would not discard what is set aside, and nothing is.
   *
   * A held text is let go rather than removed: the next write goes over it, as
   * it would have once it was set aside, and the parts it kept back are kept
   * again. The user is told so by the discard, and not again by the write as
   * though room had been made.
   */
  readonly discard: (about: About) => ReadonlySet<Part> | undefined;
}

/**
 * What the user is told when a write sets aside the text `name` by dropping
 * older texts, which its notice, dismissed or not, may not show; `undefined`
 * where it dropped none.
 */
function droppedToSetAside<Name extends string, About extends NoticeAbout>(
  subjects: readonly UnreadSubject<Name, About>[],
  name: Name,
  dropped: number,
): string | undefined {
  const about = subjects.find((subject) => subject.names.includes(name))?.about;
  if (dropped === 0 || about === undefined) return undefined;
  return `To set aside the text of ${subjectOf(about)} that could not be read, ${oldestTexts(dropped)} dropped.`;
}

/**
 * Every text of a subject, those set aside first, oldest first, then those
 * `held` still holds where they were found, under the key each is stored in.
 */
function copiesOf<Name extends string>(
  storage: StateStorage,
  { key, names }: { readonly key: string; readonly names: readonly Name[] },
  held: ReadonlyMap<Name, Unread>,
): readonly UnreadCopy[] {
  const aside = textsSetAside(storage.read(key)).map((text) => ({ key, setAside: true, text }));
  const inPlace = names.flatMap((name) => {
    const unread = held.get(name);
    return unread === undefined ? [] : [{ key: unread.found, setAside: false, text: unread.text }];
  });
  return [...aside, ...inPlace];
}

/** What a custody holds between one write and the next. */
interface Holding<Name extends string, Part> {
  /** The texts still where they were found. */
  readonly held: Map<Name, Unread>;

  /**
   * How many texts each key holds, read once and then kept from what each
   * set-aside answers, so the settings never read a list to count it.
   */
  readonly counts: Map<string, number>;

  /** How many older texts were dropped to make room for each text set aside. */
  readonly droppedFor: Map<Name, number>;

  /** The parts the user has been told are kept again, by a write or a discard. */
  readonly toldKeptAgain: Set<Part>;
}

/** Sets aside each text still held, and answers those it set aside, with what each dropped. */
function setAsideEach<Name extends string, Part>(
  storage: StateStorage,
  { held, counts, droppedFor }: Holding<Name, Part>,
): readonly (readonly [Name, number])[] {
  const now: (readonly [Name, number])[] = [];
  for (const [name, unread] of held) {
    const answer = storage.keepAside(unread.key, unread.text);
    counts.set(unread.key, answer.count);
    if (!answer.kept) continue;
    held.delete(name);
    droppedFor.set(name, answer.dropped);
    now.push([name, answer.dropped]);
  }
  return now;
}

/**
 * Discards every text of `subject`, and answers the parts that lets the next
 * write keep again, noted as told, or `undefined` where the browser would not
 * discard what is set aside, and nothing is.
 */
function discardEach<Name extends string, About extends NoticeAbout, Part>(
  storage: StateStorage,
  logger: Logger,
  holding: Holding<Name, Part>,
  withheld: HeldTextAccounting<Name, Part>['withheld'],
  { about, key, names }: UnreadSubject<Name, About>,
): ReadonlySet<Part> | undefined {
  if (!storage.discardAside(key)) return undefined;
  holding.counts.set(key, 0);

  const isHeld = (name: Name): boolean => holding.held.has(name);
  const keptBack = withheld(isHeld);
  for (const name of names) holding.held.delete(name);
  const freed = new Set([...keptBack].filter((part) => !withheld(isHeld).has(part)));
  for (const part of freed) holding.toldKeptAgain.add(part);
  logger.info('Text that could not be read is discarded.', { part: about });
  return freed;
}

/** How much there is of the text about a subject, as its custody holds it. */
function unreadOf<Name extends string, About extends NoticeAbout, Part>(
  { counts, held }: Holding<Name, Part>,
  { about, key, names }: UnreadSubject<Name, About>,
): UnreadText {
  return {
    about,
    setAside: counts.get(key) ?? 0,
    leftInPlace: names.filter((name) => held.has(name)).length,
  };
}

/**
 * Sets aside each text given, as far as there is room, and holds the rest.
 *
 * Each set-aside is read back to be sure (see `StateStorage.keepAside`): a
 * browser at its quota refuses it as readily as anything else, and a copy
 * assumed rather than checked is how text is lost. One refused at the start is
 * said in the store's notice about it rather than as a change that was not
 * saved, because the user has not changed anything yet. Tried again as often
 * as a write asks: a text already set aside is not added twice.
 */
export function holdTexts<Name extends string, About extends NoticeAbout, Part>(
  storage: StateStorage,
  logger: Logger,
  texts: ReadonlyMap<Name, Unread>,
  accounting: HeldTextAccounting<Name, Part>,
  subjects: Readonly<Record<About, UnreadSubject<Name, About>>>,
): HeldTexts<Name, About, Part> {
  const every = Object.values<UnreadSubject<Name, About>>(subjects);
  const holding: Holding<Name, Part> = {
    held: new Map(texts),
    counts: new Map(every.map(({ key }) => [key, textsSetAside(storage.read(key)).length])),
    droppedFor: new Map(),
    toldKeptAgain: new Set(),
  };
  const { held, toldKeptAgain } = holding;

  setAsideEach(storage, holding);
  const isHeld = (name: Name): boolean => held.has(name);

  // The parts the user was told cannot be kept, and those the last write
  // keeps again.
  const withheldAtStart = accounting.withheld(isHeld);
  let keptAgain: ReadonlySet<Part> = new Set();

  return {
    isHeld,

    dropped: (name) => holding.droppedFor.get(name) ?? 0,

    waitsForRoom: () => accounting.withheld(isHeld).size > 0,

    beforeWrite: () => {
      const dropping: (string | undefined)[] = [];
      for (const [name, dropped] of setAsideEach(storage, holding)) {
        logger.info('Text that could not be read is set aside now.', { text: name });
        dropping.push(droppedToSetAside(every, name, dropped));
      }
      const keptBack = accounting.withheld(isHeld);
      keptAgain = new Set(
        [...withheldAtStart].filter((part) => !keptBack.has(part) && !toldKeptAgain.has(part)),
      );

      const notKept = accounting.notKept(keptBack);
      const said = [accounting.keptAgain(keptAgain), ...dropping].filter(
        (one) => one !== undefined,
      );
      return {
        ...(notKept === undefined ? {} : { withheld: notKept }),
        ...(said.length === 0 ? {} : { resumed: said.join(' ') }),
      };
    },

    written: (refused) => {
      if (refused.length === 0) for (const part of keptAgain) toldKeptAgain.add(part);
    },

    unread: (about) => unreadOf(holding, subjects[about]),

    copies: (about) => copiesOf(storage, subjects[about], held),

    discard: (about) => discardEach(storage, logger, holding, accounting.withheld, subjects[about]),
  };
}
