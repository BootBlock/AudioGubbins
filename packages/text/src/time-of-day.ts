/**
 * A time of day as a sentence writes it, to the second.
 *
 * To the second, so two moments in one minute are told apart: two tabs opened
 * in one minute, or two records in the log. In the 24-hour clock of British
 * English whatever the runtime's own locale, so the same moment reads alike in
 * a banner, the log and the settings, and in the reader's own time zone, since
 * it says when something happened to them.
 */

/** The one formatter, made once (G5). */
const TIME_OF_DAY = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** The time of day of a moment in milliseconds since the epoch: "14:05:09". */
export function timeOfDay(at: number): string {
  return TIME_OF_DAY.format(at);
}
