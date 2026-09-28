/**
 * A file port that saves nothing and remembers everything.
 *
 * Lets a test assert what a command offered the user as a file without anything
 * reaching the disk or the browser's download machinery.
 */

import type { TextFiles } from '../io/text-files.js';

/** A port that keeps what it was given. */
export interface RecordedTextFiles extends TextFiles {
  readonly saved: readonly { readonly filename: string; readonly text: string }[];
}

/** Creates the port, optionally refusing every save with the given reason. */
export function recordingTextFiles(refusal?: string): RecordedTextFiles {
  const saved: { filename: string; text: string }[] = [];
  return {
    saved,
    save(filename, text) {
      if (refusal !== undefined) return refusal;
      saved.push({ filename, text });
      return undefined;
    },
  };
}
