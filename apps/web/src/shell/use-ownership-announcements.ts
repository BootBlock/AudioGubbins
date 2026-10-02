/**
 * Saying aloud what changes about who may change the open project, as it
 * changes (REQ-STOR-098, REQ-UX-005).
 *
 * The banner shows it, and a screen-reader user working in a panel would not
 * hear the banner change: another tab asking for the project, another tab
 * taking it over, and the project coming free are each said once, the first two
 * urgently, since each asks for an answer or has stopped the person's work.
 * What recovery found on opening is said once too.
 */

import { useEffect, useRef } from 'react';

import type { Announce } from '../commands/voiced-execution.js';
import type { OpenProjectState } from '../state/open-project-store.js';
import { quoted } from '../wording.js';
import { accessSentence, recoverySentences, requestSentence } from './project-words.js';

/** What was last heard of the open project. */
interface Heard {
  readonly project?: string;
  readonly access?: string;
  readonly requests: ReadonlySet<string>;
  readonly report: boolean;
}

/** Says what changed since the last render, and remembers what it heard. */
export function useOwnershipAnnouncements(open: OpenProjectState, announce: Announce): void {
  const heard = useRef<Heard>({ requests: new Set(), report: false });

  useEffect(() => {
    if (open.kind !== 'open') {
      heard.current = { requests: new Set(), report: false };
      return;
    }
    const { snapshot, report } = open;
    const before = heard.current;
    const same = before.project === snapshot.project;
    const name = quoted(snapshot.model.state.project.displayName);
    const { access } = snapshot;
    const requests = access.kind === 'writable' ? access.transferRequests : [];
    const kind = access.kind === 'read-only' ? `read-only:${access.reason.kind}` : access.kind;

    for (const request of requests) {
      if (!before.requests.has(request.id)) announce(requestSentence(request.from, name), true);
    }
    const changed = same && before.access !== undefined && before.access !== kind;
    const said = accessSentence(access, name);
    if (changed && said !== undefined && access.kind !== 'handed-over') {
      announce(said, access.kind === 'lost');
    }
    if (report !== undefined && !(same && before.report)) {
      announce(
        `When ${name} was opened, some of it had to be recovered. ${recoverySentences(report).join(' ')}`,
        false,
      );
    }
    heard.current = {
      project: snapshot.project,
      access: kind,
      requests: new Set(requests.map((request) => request.id)),
      report: report !== undefined,
    };
  }, [open, announce]);
}
