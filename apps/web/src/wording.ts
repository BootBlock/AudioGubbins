/**
 * How the shell writes a name, a time and a quantity of storage in what it
 * says: the one wording every surface and every command uses, so the Storage
 * panel, a cleanup's confirmation and what a command says after it agree to the
 * byte (REQ-STOR-200, REQ-STOR-106). A count is said by the text package's
 * rule, which the project commands share.
 *
 * A name is quoted as the shell quotes a workspace's. A time is written in
 * British English whatever the browser's own locale, so a backup listed in
 * Settings and the same backup named by a command read alike. Storage is
 * written in steps of 1,024, as the diagnostic log's own size is, rounded to
 * no more figures than a person compares by.
 */

/** A name as a sentence quotes it. */
export function quoted(name: string): string {
  return `"${name}"`;
}

/** A moment, to the minute. */
const MOMENT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** A day, with no time of it. */
const DAY = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

/** When something happened, to the minute: "2 Oct 2026, 14:05". */
export function when(at: number): string {
  return MOMENT.format(at);
}

/** The day something happened, where the time of it would be noise: "2 Oct 2026". */
export function day(at: number): string {
  return DAY.format(at);
}

/** The units, smallest first, each 1,024 of the one before. */
const UNITS = ['bytes', 'kB', 'MB', 'GB', 'TB'] as const;

/** A number written with at most one decimal place, grouped as British English groups it. */
const FIGURES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/** A number of bytes, as the person reads it: "12 bytes", "3.4 MB". */
export function describeBytes(bytes: number): string {
  if (bytes === 1) return '1 byte';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${FIGURES.format(value)} ${UNITS[unit] ?? 'bytes'}`;
}
