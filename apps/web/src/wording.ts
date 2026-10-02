/**
 * How the shell writes a name and a quantity of storage in what it says: the
 * one wording every surface and every command uses, so the Storage panel, a
 * cleanup's confirmation and what a command says after it agree to the byte
 * (REQ-STOR-200, REQ-STOR-106).
 *
 * A name is quoted as the shell quotes a workspace's. Storage is written in
 * steps of 1,024, as the diagnostic log's own size is, rounded to no more
 * figures than a person compares by.
 */

/** A name as a sentence quotes it. */
export function quoted(name: string): string {
  return `"${name}"`;
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
