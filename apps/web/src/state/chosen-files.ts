/**
 * Files the person chose, handed to the command that opens them.
 *
 * A command's arguments are values that can be written down, and a file
 * cannot be, so the control that took the file from the person's choice hands
 * it over here and runs the command with the token it is given. The command
 * takes the file once; a token run again, as a replayed command would be,
 * finds nothing and says so, rather than opening something the person did not
 * choose this time.
 */

/** Holds chosen files until the command that opens each takes it. */
export interface ChosenFiles {
  /** Holds `file`, and answers the token the command names it by. */
  readonly offer: (file: File) => string;
  /** The file of `token`, once, or `undefined`. */
  readonly take: (token: string) => File | undefined;
}

/** Makes the holder, empty. */
export function createChosenFiles(): ChosenFiles {
  const held = new Map<string, File>();
  let offered = 0;
  return {
    offer: (file) => {
      offered += 1;
      const token = `chosen-${String(offered)}`;
      held.set(token, file);
      return token;
    },
    take: (token) => {
      const file = held.get(token);
      held.delete(token);
      return file;
    },
  };
}
