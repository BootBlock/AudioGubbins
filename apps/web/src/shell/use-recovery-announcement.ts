/**
 * Telling a screen-reader user that something they saved could not be read.
 *
 * A recovery is found while the application starts, and the status bar shows
 * it. The status bar is not a live region, so unannounced, the notice would
 * reach only a user who looked at it: a screen-reader user whose saved
 * workspaces could not be read would start the session with the built-in ones,
 * no explanation, and a "Dismiss notice" button after the whole dock whose
 * purpose they could not tell (REQ-UX-059, WCAG 4.1.3). The status bar keeps
 * the notice as the copy a user can return to; this says it once, as it
 * appears.
 */

import { useEffect, useRef } from 'react';

import { sentencesWithin } from '@audiogubbins/text';

import type { StandingRecovery } from '../state/recovery-notices.js';

/**
 * How many words the announcement says before it points at the status bar: a
 * budget for the notices' consequences, because their facts are always said.
 *
 * Every notice's fact is said whole, whatever the facts come to, and a notice
 * whose text waits for room says in its fact what cannot be kept until there
 * is, so no loss goes unsaid for want of words. What the facts leave of this is
 * for each notice's consequences, where its text is and why, in the order the
 * notices stand, for as many whole sentences as fit. Where the facts come to
 * more, the limit is theirs, and no consequence is said. They do where every
 * store's text waits for room: over stored text none of which is JSON, the
 * three facts come to 78 words, the layout's 18, the collection's 33 and the
 * profiles' 27. With no text waiting they come to 66 or more where the layout
 * was written for another format version, the whole collection is damaged, and
 * two or more profiles could not be read, the one in use among them: the
 * layout's reason is 15 words where the stored version is one word or none and
 * up to 34 where it is quoted text, the collection's damage 21 and the
 * profiles' 30. Where the one in use is the only profile that could not be
 * read, they come to 65 or more.
 *
 * At an unhurried pace this is about seventeen seconds of speech, said
 * assertively at the moment the user arrives. Every notice whole, with the
 * advice on making room, can run to over two hundred words, which is over a
 * minute.
 */
const WORDS_SAID = 60;

/** Where the whole of every notice stays, for a reader who wants the rest. */
const THE_REST = 'The status bar has the rest.';

/** How many words a text has, counted as `sentencesWithin` counts them. */
function wordsIn(text: string): number {
  return text.trim().split(/\s+/u).length;
}

/**
 * What is said of the notices standing: every notice's fact, then their
 * consequences in whole sentences up to {@link WORDS_SAID}, then where to find
 * the rest when anything is left out, the advice the status bar keeps apart
 * included.
 *
 * Consequences worded alike are said once: "The text that could not be read
 * is kept aside", said after each fact, would be said three times in a row.
 */
function saidOf({ notices, waitsForRoom }: StandingRecovery): string {
  const facts = notices.map(({ notice }) => notice.fact).join(' ');
  const consequences = [...new Set(notices.map(({ notice }) => notice.consequences))].join(' ');
  const { said, whole } = sentencesWithin(
    `${facts} ${consequences}`,
    Math.max(WORDS_SAID, wordsIn(facts)),
  );
  return whole && !waitsForRoom ? said : `${said} ${THE_REST}`;
}

/**
 * Announces the recovery notices the first time there are any: the workspace's
 * and the shortcut profiles', as the status bar shows them.
 *
 * Once, and all of them in one announcement: they are found together when the
 * application starts, and two urgent announcements in a row are one too many
 * for a user who has not yet done anything. Held by a ref rather than state, so
 * the second run React's strict mode makes of every effect says nothing again.
 *
 * Shortened by {@link saidOf}. The status bar keeps the whole of every notice,
 * and the announcement is what a user hears once, uninterrupted, before they
 * have done anything at all.
 */
export function useRecoveryAnnouncement(
  recovery: StandingRecovery,
  announce: (text: string, urgent: boolean) => void,
): void {
  const said = useRef(false);

  useEffect(() => {
    if (said.current || recovery.notices.length === 0) return;
    said.current = true;
    announce(saidOf(recovery), true);
  }, [recovery, announce]);
}
