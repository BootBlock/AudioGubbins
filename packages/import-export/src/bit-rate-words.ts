/**
 * A list of bit rates as a sentence gives it, the same in a refusal and in the
 * Export dialog: each one where there are few, such as "96, 128, 160 or 192";
 * and where there are many, each even run of three or more as one stretch,
 * such as "every 8 from 8 to 576", so a browser's encoder that takes every
 * bit rate it was asked is said in a few words.
 */

/** The most bit rates listed one by one. */
const LISTED_UP_TO = 8;

/** The shortest even run said as a stretch. */
const SHORTEST_STRETCH = 3;

/** Words joined as a list whose last is "or", such as "1, 2 or 6". */
export function either(words: readonly string[]): string {
  const last = words.at(-1) ?? '';
  return words.length < 2 ? last : `${words.slice(0, -1).join(', ')} or ${last}`;
}

/** The runs of `rates`, ascending, each the longest stretch of one step from where the last ended. */
function stretches(rates: readonly number[]): readonly (readonly number[])[] {
  const runs: number[][] = [];
  let start = 0;
  while (start < rates.length) {
    const first = rates[start] ?? 0;
    const step = (rates[start + 1] ?? first) - first;
    let end = start + 1;
    while (end < rates.length && (rates[end] ?? 0) - (rates[end - 1] ?? 0) === step) end += 1;
    const run = rates.slice(start, end);
    if (run.length >= SHORTEST_STRETCH) {
      runs.push(run);
      start = end;
    } else {
      runs.push([first]);
      start += 1;
    }
  }
  return runs;
}

/** `rates`, ascending whole kbit/s, as a sentence gives them, without the unit. */
export function bitRatesWords(rates: readonly number[]): string {
  if (rates.length <= LISTED_UP_TO) return either(rates.map(String));
  return either(
    stretches(rates).map((run) => {
      const first = run[0] ?? 0;
      const last = run.at(-1) ?? first;
      return run.length === 1
        ? String(first)
        : `every ${String((run[1] ?? first) - first)} from ${String(first)} to ${String(last)}`;
    }),
  );
}
