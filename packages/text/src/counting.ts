/**
 * How many of something a sentence says there are: the count, then the noun
 * that agrees with it.
 *
 * English agrees a noun with a count of one alone, so none takes the plural, as
 * "0 changes" does. The caller gives both forms, because English makes a plural
 * in too many ways to derive one ("1 branch", "2 branches"), and a phrase
 * agrees whole ("1 clip that plays it", "2 clips that play it").
 */

/** `count` and the noun that agrees with it: "1 change", "3 changes". */
export function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}
