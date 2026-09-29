/**
 * Handing text to the user as a file.
 *
 * A port rather than a browser call inside a command. The command layer has no
 * DOM, a command must stay testable without a browser (REQ-EXEC-136.4), and the
 * two things that save files here - a shortcut profile and a diagnostic report
 * - must both be observable in a test without anything reaching the real disk.
 *
 * Saving is the only direction. Reading a file needs a picker the user opens,
 * which is a gesture in a dialogue rather than something a command can start.
 */

import { offerDownload } from './download.js';

/** Offers text to the user as a file. */
export interface TextFiles {
  /**
   * Offers the text as a download.
   *
   * Returns the reason it could not, or `undefined` when the browser accepted
   * it. Accepted is all that can be known: whether the user then kept the file
   * is the browser's business and is not reported to the page.
   */
  save(filename: string, text: string, mediaType: string): string | undefined;
}

/** Saves through the browser's own download. */
export function browserTextFiles(): TextFiles {
  return {
    save(filename, text, mediaType) {
      try {
        offerDownload(new Blob([text], { type: mediaType }), filename);
        return undefined;
      } catch (error) {
        // A browser that refuses a Blob or a synthetic click - a locked-down
        // kiosk, a sandboxed frame - is told to the user rather than swallowed.
        // REQ-PRIV-161 requires an export failure to stay local and actionable.
        return error instanceof Error
          ? `The browser would not save the file: ${error.message}`
          : 'The browser would not save the file.';
      }
    },
  };
}
