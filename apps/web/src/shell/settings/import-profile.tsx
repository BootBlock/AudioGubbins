/**
 * Choosing a file to read a shortcut profile from.
 *
 * Its own module because it is the one profile action that decides anything
 * for itself: what it will read, and what it says when it will not. The other
 * three hand a command their identifier.
 */

import type { ReactNode } from 'react';

import type { Announce } from '../../commands/voiced-execution.js';
import { NotedFileButton } from './reasoned-button.js';
import type { RunCommand } from './section.js';

/**
 * The largest shortcut profile AudioGubbins will read.
 *
 * The shipped profile is a few hundred bytes and a heavily customised one a few
 * kilobytes, so this is far above anything a person's profile reaches. It
 * exists because a profile is something users share (REQ-UX-066): the file need
 * not be the reader's own, and without a limit the whole of it would be read
 * into memory and parsed whatever its size.
 */
const LARGEST_PROFILE_FILE = 256 * 1024;

/**
 * The Import control of the shortcut settings. Where the command cannot run,
 * no file is chosen, so none is read.
 */
export function ImportProfile(props: {
  readonly run: RunCommand;
  readonly announce: Announce;

  /** The note saying why no profile can be imported now, or `undefined`. */
  readonly reasonId: string | undefined;
}): ReactNode {
  const { run, announce, reasonId } = props;

  return (
    <NotedFileButton
      reasonId={reasonId}
      accept=".json,application/json"
      onFile={(file) => {
        // Refused before it is read, rather than after. A profile is
        // something users share (REQ-UX-066), so the file need not be the
        // reader's own, and refused after, the whole of it would already be
        // read into memory and parsed whatever its size.
        if (file.size > LARGEST_PROFILE_FILE) {
          announce(
            `That file is larger than ${String(Math.round(LARGEST_PROFILE_FILE / 1024))} kB, which is more than any shortcut profile. Nothing was imported.`,
            true,
            { refusal: true },
          );
          return;
        }

        void file.text().then(
          (text) => {
            run('shortcuts.import', { text });
          },
          // A read can fail: a file removed between choosing it and reading
          // it, or one the browser will not open. Unhandled, the reader would
          // choose a file and nothing at all would happen.
          () => {
            announce('That file could not be read. Nothing was imported.', true, {
              refusal: true,
            });
          },
        );
      }}
    >
      Import
    </NotedFileButton>
  );
}
