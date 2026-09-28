/**
 * How many corrections each review round made, read from the review record,
 * and the counts the resume note, the evidence and the record itself state.
 *
 * A round's count is the number of its markers in the record, each written
 * `**Corrected in the <ordinal> round (` with the findings that showed it,
 * wherever it is written: in a row, or in the prose of a preamble. The
 * parenthesis is part of the marker: rounds eight to twelve each name the bare
 * phrase once more, in the sentence that says how their markers are written,
 * and the ninth round has a marker whose parenthesis holds no finding. Text is
 * read as one run of words, so a marker or a count wrapped across two lines of
 * prose is read as one written on a single line; the tenth round's correction
 * to the ninth round's preamble is one.
 *
 * Each reader answers what it could not read beside what it read, so a
 * sentence written in a shape the rule does not know fails it rather than
 * being passed over. An ordinal is read as one word or as two joined by a
 * hyphen, as "twenty-first" is written, so a round past the twentieth is read
 * or refused, never skipped.
 */

/** A word, or two joined by a hyphen, as an ordinal or a number is written out. */
const WORD = '([a-z]+(?:-[a-z]+)?)';

/** The ordinals up to the nineteenth, each written as one word. */
const UNIT_ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
] as const;

const UNITS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const TENS = [
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

/**
 * The ordinals the record names its rounds by, the first round first, to the
 * ninety-ninth: each tens' own, as "thirtieth", and each unit's after it, as
 * "thirty-first".
 */
export const ORDINALS: readonly string[] = [
  ...UNIT_ORDINALS,
  ...TENS.flatMap((tens) => [
    `${tens.slice(0, -1)}ieth`,
    ...UNIT_ORDINALS.slice(0, 9).map((unit) => `${tens}-${unit}`),
  ]),
];

/** A number written out in words, from one to ninety-nine. */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ...UNITS.map((word, index) => [word, index + 1] as const),
  ...TENS.flatMap((tens, index) => {
    const value = (index + 2) * 10;
    return [
      [tens, value] as const,
      ...UNITS.slice(0, 9).map((unit, step) => [`${tens}-${unit}`, value + step + 1] as const),
    ];
  }),
]);

/** The number a word writes out, whatever its case, or `undefined` for a word that writes none. */
export function numberOfWords(word: string): number | undefined {
  return NUMBER_WORDS.get(word.toLowerCase());
}

/** The round an ordinal names, counted from one, or `undefined` for another word. */
export function roundOfOrdinal(word: string): number | undefined {
  const index = ORDINALS.findIndex((ordinal) => ordinal === word.toLowerCase());
  return index === -1 ? undefined : index + 1;
}

/** Text as one run of words, every run of white space one space. */
function asOneRun(text: string): string {
  return text.replaceAll(/\s+/gu, ' ');
}

/** What a reader read, and the words it could not read. */
export interface Reading<T> {
  readonly read: T;
  readonly unread: readonly string[];
}

/** What a count counts: every marker of its round, or only those in a table's rows. */
export const Counted = {
  Corrections: 'corrections',
  Rows: 'rows',
} as const;
export type Counted = (typeof Counted)[keyof typeof Counted];

/** One round's markers: all of them, and those in a table's rows. */
export type MarkerCount = Readonly<Record<Counted, number>>;

const MARKER = new RegExp(String.raw`\*\*Corrected in the ${WORD} round \(`, 'giu');

/** The heading of a round's own part of the record. */
const ROUND_HEADING = new RegExp(String.raw`^## The ${WORD} round`, 'gimu');

/** The ordinal each round's heading names it by, in the order the record gives them. */
export function roundHeadings(record: string): readonly string[] {
  return [...record.matchAll(ROUND_HEADING)].map((one) => one[1] ?? '');
}

/**
 * The markers each round wrote, by round. A table's row is one line, so the
 * markers in rows are read line by line, and every marker from the text read
 * as one run.
 */
export function correctionMarkers(record: string): Reading<ReadonlyMap<number, MarkerCount>> {
  const counts = new Map<number, { corrections: number; rows: number }>();
  const unread: string[] = [];
  const countOf = (round: number): { corrections: number; rows: number } => {
    const count = counts.get(round) ?? { corrections: 0, rows: 0 };
    counts.set(round, count);
    return count;
  };

  for (const [, ordinal = ''] of asOneRun(record).matchAll(MARKER)) {
    const round = roundOfOrdinal(ordinal);
    if (round === undefined) unread.push(ordinal);
    else countOf(round).corrections += 1;
  }
  for (const row of record.split(/\r?\n/u).filter((line) => line.startsWith('|'))) {
    for (const [, ordinal = ''] of row.matchAll(MARKER)) {
      const round = roundOfOrdinal(ordinal);
      if (round !== undefined) countOf(round).rows += 1;
    }
  }
  return { read: counts, unread };
}

/**
 * A count a document states for one round, and what it counts. `stated` is
 * absent where no number could be read.
 */
export interface StatedCount {
  readonly round: number;
  readonly of: Counted;
  readonly stated: number | undefined;
}

/** The heading of a round's section on its corrections to earlier rows. */
const SECTION_HEADING = new RegExp(
  String.raw`^### (?:What the ${WORD} round corrects in earlier rows|Corrections the ${WORD} round made to earlier rows)\r?$`,
  'gimu',
);

/**
 * The counts each of the record's sections on a round's corrections states in
 * its first paragraph.
 *
 * The first number written out before `corrections` or `rows` and capitalised
 * as a sentence's first word is the section's own count: "Twenty-five
 * corrections, each written…", which counts every marker, or "Thirty-six
 * rows.", after the sentence on the marker in the sections headed "Corrections
 * the eighth round made to earlier rows" and the like, which counts the rows.
 * Each "<number> are rows" after it counts the rows too. A section that states
 * no count of its own is read with a count of every marker and no number.
 */
export function sectionCounts(record: string): Reading<readonly StatedCount[]> {
  const counts: StatedCount[] = [];
  const unread: string[] = [];
  for (const match of record.matchAll(SECTION_HEADING)) {
    const ordinal = match[1] ?? match[2] ?? '';
    const round = roundOfOrdinal(ordinal);
    if (round === undefined) {
      unread.push(ordinal);
      continue;
    }
    const after = record.slice(match.index + match[0].length).trimStart();
    const paragraph = asOneRun(after.split(/\r?\n\s*\r?\n/u)[0] ?? '');

    const own = [...paragraph.matchAll(/\b([A-Z][a-z]+(?:-[a-z]+)?) (corrections|rows)\b/gu)]
      .map(([, word = '', of = '']) => ({
        round,
        of: of === 'rows' ? Counted.Rows : Counted.Corrections,
        stated: numberOfWords(word),
      }))
      .find(({ stated }) => stated !== undefined);
    counts.push(own ?? { round, of: Counted.Corrections, stated: undefined });

    for (const [, word = ''] of paragraph.matchAll(/\b([a-z]+(?:-[a-z]+)?) are rows\b/gu)) {
      counts.push({ round, of: Counted.Rows, stated: numberOfWords(word) });
    }
  }
  return { read: counts, unread };
}

/**
 * The sentence of a document that opens with `opening`, whatever the case of
 * either, to its first full stop, or `undefined` where the document has none.
 */
export function sentenceOpening(document: string, opening: string): string | undefined {
  const said = asOneRun(document).toLowerCase();
  const start = said.indexOf(opening.toLowerCase());
  if (start === -1) return undefined;
  const end = said.indexOf('.', start);
  return end === -1 ? undefined : said.slice(start, end + 1);
}

/**
 * The counts the resume note's corrections sentence states, each as `round`, a
 * round's number and the number in words: "round 3 corrected nineteen round-2
 * dispositions, round 4 thirty-five earlier ones, … and round 18 twenty-five".
 */
export function countsByNumber(sentence: string): readonly StatedCount[] {
  return [...sentence.matchAll(/\bround (\d+)(?: corrected)? ([a-z]+(?:-[a-z]+)?)/gu)].map(
    ([, round = '', word = '']) => ({
      round: Number(round),
      of: Counted.Corrections,
      stated: numberOfWords(word),
    }),
  );
}

/** A count as the evidence states it: `the`, a round's ordinal and the number in words. */
const ORDINAL_COUNT = new RegExp(String.raw`\bthe ${WORD}(?: round corrected)? ${WORD}`, 'giu');

/** The words the evidence's corrections sentence writes after `the` that are its prose. */
const PROSE_AFTER_THE: ReadonlySet<string> = new Set(['code']);

/**
 * The counts the evidence's corrections sentence states, each as `the`, a
 * round's ordinal and the number in words: "the third round corrected nineteen
 * second-round dispositions …, the fourth thirty-five earlier ones, … and the
 * eighteenth twenty-five". A word after `the` that is no ordinal is the
 * sentence's prose where {@link PROSE_AFTER_THE} names it, as "the code" is,
 * and unread where it does not.
 */
export function countsByOrdinal(sentence: string): Reading<readonly StatedCount[]> {
  const counts: StatedCount[] = [];
  const unread: string[] = [];
  for (const [, ordinal = '', word = ''] of sentence.matchAll(ORDINAL_COUNT)) {
    const round = roundOfOrdinal(ordinal);
    if (round !== undefined) {
      counts.push({ round, of: Counted.Corrections, stated: numberOfWords(word) });
    } else if (!PROSE_AFTER_THE.has(ordinal.toLowerCase())) {
      unread.push(ordinal);
    }
  }
  return { read: counts, unread };
}

/**
 * The counts the markers give for what each stated count counts, in the same
 * order, so the two can be compared line by line.
 */
export function countedAs(
  stated: readonly StatedCount[],
  markers: ReadonlyMap<number, MarkerCount>,
): readonly StatedCount[] {
  return stated.map(({ round, of }) => ({ round, of, stated: markers.get(round)?.[of] ?? 0 }));
}

/**
 * Each count as `round <number>: <count> <what it counts>`, in the order
 * given, so a failure names the round and both counts.
 */
export function asLines(counts: readonly StatedCount[]): readonly string[] {
  return counts.map(({ round, of, stated }) => `round ${String(round)}: ${String(stated)} ${of}`);
}
