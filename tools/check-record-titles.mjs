#!/usr/bin/env node
/**
 * Refuses a review record whose dispositions name a test that does not exist.
 *
 * A disposition's Proof names the test a mutation failed by that test's title,
 * so a reader can find it and put the defect back themselves. A title renamed
 * after its row was written, quoted from memory or quoted in part names a test
 * that exists nowhere, and with nothing reading the record against the tests,
 * every suite would stay green.
 *
 * The titles are the ones a run reports: Vitest's JSON report, and Playwright's
 * own list. A title written with `%s` is only known once the table it is
 * expanded from has been evaluated, and read as a pattern instead, `names %s`
 * would accept every title that begins with "names".
 *
 * What is read as a citation, in each disposition row of a review record:
 *
 * - a quoted title after "fails" or "fail", which is how a Proof names the
 *   test a mutation failed, and each quoted title chained after it with a
 *   comma, "and" or "or"; and a quoted title written before "fails", as in
 *   `"X" fails without it`, the other way a Proof is written;
 * - a quoted title after "held by", "read by", "asserted by", "under",
 *   "titled", "test" or "names", which is how a row names the test a property
 *   rests on, and after a bare "by" where it runs to three words or more,
 *   because a word or two quoted after "by" is prose;
 * - each title in backticks after "The test is", "The tests are" or "They
 *   are", which is how a correction names the titles tests have now;
 * - and every other string of three words or more in double quotes or in
 *   backticks, because the forms a row names a test in are not a closed list.
 *   Each is a test's title, or is listed in the record as quoted text that
 *   names no test, for the rows it is quoted in. A test's title cannot be
 *   listed so, and nor can its start or its end, unless it is listed as text
 *   a title happens to contain, which a reader has to decide.
 *
 * A citation written as a template, `${…}` or `%s`, names a test that runs
 * once for each row of a table, and resolves where a reported title fits it.
 *
 * The record is append-only, so a title a row once named stays in it after a
 * correction replaces it. The record lists each such title with the one its
 * test has now, one row for each test where it named several, and a row that
 * names the old title must name every new one too, each of which must
 * resolve. A title listed for one that a later correction replaced in turn
 * is followed to the titles its tests have now, since the earlier list keeps
 * what it said. A quote listed so is read as those titles wherever else it
 * is listed, since a quote once listed as prose can later be found to name a
 * test. The lists are tables in the record, under the headings below.
 *
 * Usage:
 *
 * ```
 * node tools/check-record-titles.mjs
 * node tools/check-record-titles.mjs --record <file> --vitest <report.json>
 *   --playwright <list.json> --tests <folder>
 * ```
 *
 * With no arguments it reads every review record under `docs/spec/reviews/`,
 * the report `pnpm test` writes, and a list it asks Playwright for. Run by
 * `pnpm verify:commit` after `pnpm test`, and refuses a report older than a
 * test file, which would describe tests that are no longer there: one under
 * `apps/`, `packages/` or `tests/`, or under the folder `--tests` names.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A Vitest JSON report, as far as the check reads it.
 *
 * @typedef {object} VitestReport
 * @property {readonly VitestFile[]} testResults
 */

/**
 * One test file of a Vitest JSON report, as far as the check reads it.
 *
 * @typedef {object} VitestFile
 * @property {readonly { readonly title: string }[]} assertionResults
 */

/**
 * A suite of a Playwright JSON list, and every suite inside it.
 *
 * @typedef {object} PlaywrightSuite
 * @property {readonly { readonly title: string }[]} [specs]
 * @property {readonly PlaywrightSuite[]} [suites]
 */

/**
 * A Playwright JSON list, as far as the check reads it.
 *
 * @typedef {object} PlaywrightList
 * @property {readonly PlaywrightSuite[]} suites
 */

/**
 * A string a disposition row quotes: the row's identifier, the text, the
 * row, and whether the words before it name it as a test.
 *
 * @typedef {object} Citation
 * @property {string} id
 * @property {string} title
 * @property {string} row
 * @property {boolean} named
 */

/**
 * The rows of a table in a record: each first cell, with every second cell
 * written beside it.
 *
 * @typedef {ReadonlyMap<string, readonly string[]>} Table
 */

/** Where `pnpm test` writes the report this reads. */
const VITEST_REPORT = join(
  REPO_ROOT,
  'node_modules',
  '.cache',
  'audiogubbins',
  'vitest-report.json',
);

/**
 * The heading of a table in a record listing, for each title a disposition
 * quotes that no test has now, the title its test has: a test renamed after
 * the row was written, or a title quoted from its start. Kept in the record,
 * beside the rows it answers for, because the record is append-only and the
 * quote stays in its row after a correction names the title.
 */
const QUOTED_AS_NO_LONGER = /^#{2,4} Titles a disposition quotes that no test has now\b/u;

/**
 * The heading of a table in a record listing quoted text that names no test:
 * a sentence a lens read, a defect put back, a phrase the row answers, code.
 * Its second cell names the rows the text is quoted in, and it is passed in
 * those rows alone.
 */
const QUOTED_AS_PROSE = /^#{2,4} Quoted text that names no test$/u;

/**
 * The heading of a table in a record listing quoted text that names no test
 * though a title starts or ends with it, as a phrase a row says can be the end
 * of a title that says it too. Rows as in the table above.
 */
const QUOTED_AS_PROSE_IN_A_TITLE =
  /^#{2,4} Quoted text that names no test, though a title contains it$/u;

/** A disposition's identifier, as the second cell of the prose table names one. */
const ROW_ID = /\bF-\d+\b/gu;

/** A row of either table: its first cell, and its second. */
const TABLE_ROW = /^\| (.+?) \| (.+?) \|$/u;

/**
 * A first cell written as one code span, which stands for the text inside it.
 * Code is listed so, since a renderer reads a tag written bare as markup and
 * shows nothing of it.
 */
const CODE_SPAN = /^`([^`]+)`$/u;

/** A disposition row: an identifier, then a cell opening with its verdict in bold. */
const DISPOSITION_ROW = /^\| (F-\d+) \| \*\*/u;

/** A quoted title after the words a row names a test with, and the titles chained after it. */
const QUOTED_CITATION =
  /\b(fails?|held by|read by|asserted by|under|titled|test|names|by)\s+"([^"]+)"((?:(?:,|,?\s+and|,?\s+or)\s+"[^"]+")*)/gu;

/**
 * A quoted title written before the word a Proof says it failed with. Not
 * one followed by another quote: there the first is the defect put back and
 * the second the title, as in `the guard put back as "..." fails "..."`.
 */
const QUOTED_BEFORE_FAILS = /"([^"]+)"\s+fails?\b(?!\s+")/gu;

/** One quoted title in a chain. */
const CHAINED = /"([^"]+)"/gu;

/** A correction naming the titles tests have now, one or a list of them. */
const NAMED_NOW = /\b(?:[Tt]he tests? (?:is|are)|They are)\s+((?:`[^`]+`(?:,\s*|,?\s+and\s+)?)+)/gu;

/** One title in backticks, in such a list. */
const IN_BACKTICKS = /`([^`]+)`/gu;

/** A placeholder a table-driven title is written with. */
const PLACEHOLDER = /\$\{[^}]*\}|%[sdifjo]/gu;

/** Any string in a row in double quotes, or in backticks. */
const QUOTED = /"([^"]+)"|`([^`]+)`/gu;

/**
 * Every title each disposition row of a record names, with the row it is in,
 * and every other string of three words or more in double quotes or in
 * backticks, which is a title in a form the words above do not introduce, or
 * prose the record lists as such.
 *
 * The other strings are read because the forms a row names a test in are not a
 * closed list: a rule that read only the forms someone thought of would pass a
 * title written in any other.
 *
 * @param {string} record
 * @returns {Citation[]}
 */
function citationsIn(record) {
  /** @type {Citation[]} */
  const citations = [];
  for (const line of record.split(/\r?\n/u)) {
    const row = DISPOSITION_ROW.exec(line);
    if (row === null) continue;
    const [, id = ''] = row;
    /** @type {Set<string>} */
    const named = new Set();
    /** @param {string} title */
    const cite = (title) => {
      named.add(title);
      citations.push({ id, title, row: line, named: true });
    };
    for (const [, introducer, first = '', chain = ''] of line.matchAll(QUOTED_CITATION)) {
      if (introducer !== 'by' || first.split(/\s+/u).length >= 3) cite(first);
      for (const [, title = ''] of chain.matchAll(CHAINED)) cite(title);
    }
    for (const [, title = ''] of line.matchAll(QUOTED_BEFORE_FAILS)) cite(title);
    for (const [, list = ''] of line.matchAll(NAMED_NOW)) {
      for (const [, title = ''] of list.matchAll(IN_BACKTICKS)) cite(title);
    }
    for (const [, inQuotes, inBackticks = ''] of line.matchAll(QUOTED)) {
      const quoted = inQuotes ?? inBackticks;
      if (named.has(quoted) || quoted.trim().split(/\s+/u).length < 3) continue;
      citations.push({ id, title: quoted, row: line, named: false });
    }
  }
  return citations;
}

/**
 * The rows of every table under a heading a pattern matches: each first cell,
 * with every second cell written beside it in any of the tables.
 *
 * @param {string} record
 * @param {RegExp} heading
 * @returns {Table}
 */
function tableUnder(record, heading) {
  /** @type {Map<string, readonly string[]>} */
  const rows = new Map();
  let inside = false;
  for (const line of record.split(/\r?\n/u)) {
    if (/^#{1,6} /u.test(line)) inside = heading.test(line);
    if (!inside) continue;
    const row = TABLE_ROW.exec(line);
    if (row === null) continue;
    const [, first = '', second = ''] = row;
    if (/^-+$/u.test(first) || /^Quoted\b/u.test(first)) continue;
    const quoted = CODE_SPAN.exec(first)?.[1] ?? first;
    rows.set(quoted, [...(rows.get(quoted) ?? []), second]);
  }
  return rows;
}

/**
 * The identifiers of every disposition row in a record.
 *
 * @param {string} record
 * @returns {Set<string>}
 */
function dispositionIds(record) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const line of record.split(/\r?\n/u)) {
    const id = DISPOSITION_ROW.exec(line)?.[1];
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/**
 * Whether a citation is a reported title, or a template a reported title fits.
 *
 * @param {string} citation
 * @param {ReadonlySet<string>} titles
 * @returns {boolean}
 */
function resolves(citation, titles) {
  if (titles.has(citation)) return true;
  if (citation.search(PLACEHOLDER) === -1) return false;
  const pattern = new RegExp(
    `^${citation
      .split(PLACEHOLDER)
      .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
      .join('.+')}$`,
    'u',
  );
  for (const title of titles) if (pattern.test(title)) return true;
  return false;
}

/**
 * Every title a Vitest JSON report holds, each as the run expanded it.
 *
 * @param {VitestReport} report
 * @returns {string[]}
 */
function vitestTitles(report) {
  return report.testResults.flatMap((file) => file.assertionResults.map((test) => test.title));
}

/**
 * Every title a Playwright JSON list holds, from each suite and every suite
 * inside it.
 *
 * @param {PlaywrightList} list
 * @returns {string[]}
 */
function playwrightTitles(list) {
  /** @type {string[]} */
  const titles = [];
  /** @param {PlaywrightSuite} suite */
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) titles.push(spec.title);
    for (const inner of suite.suites ?? []) visit(inner);
  };
  for (const suite of list.suites) visit(suite);
  return titles;
}

/**
 * The titles the tests a retired title named have now, and each title it
 * was listed for that is no title and was not listed in turn.
 *
 * A title listed for one that a later correction replaced is followed to
 * what replaced it, as often as it was replaced, and a loop ends it.
 *
 * @param {string} title
 * @param {Table} noLonger
 * @param {ReadonlySet<string>} titles
 * @param {Set<string>} [seen]
 * @returns {{ live: string[]; lost: string[] }}
 */
function titlesNow(title, noLonger, titles, seen = new Set([title])) {
  /** @type {string[]} */
  const live = [];
  /** @type {string[]} */
  const lost = [];
  for (const one of noLonger.get(title) ?? []) {
    if (resolves(one, titles)) {
      live.push(one);
    } else if (noLonger.has(one) && !seen.has(one)) {
      seen.add(one);
      const later = titlesNow(one, noLonger, titles, seen);
      live.push(...later.live);
      lost.push(...later.lost);
    } else {
      lost.push(one);
    }
  }
  return { live, lost };
}

/**
 * What is wrong with a record's citations, given the titles that exist, the
 * titles the record lists as quoted as no test has them now, the quoted text
 * it lists as prose with the rows it is listed for, and the rows it has.
 *
 * @param {readonly Citation[]} citations
 * @param {ReadonlySet<string>} titles
 * @param {Table} noLonger
 * @param {Table} prose
 * @param {Table} proseInATitle
 * @param {ReadonlySet<string>} ids
 * @returns {string[]}
 */
function problemsWith(citations, titles, noLonger, prose, proseInATitle, ids) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, ReadonlySet<string>>} */
  const listedIn = new Map();
  const everyProse = new Map(prose);
  for (const [quoted, cells] of proseInATitle) {
    everyProse.set(quoted, [...(everyProse.get(quoted) ?? []), ...cells]);
  }
  for (const [quoted, cells] of everyProse) {
    if (noLonger.has(quoted)) continue;
    if (resolves(quoted, titles)) {
      problems.push(`"${quoted}" is listed as prose, and is a test's title`);
    } else if (
      !proseInATitle.has(quoted) &&
      [...titles].some((title) => title.startsWith(quoted) || title.endsWith(quoted))
    ) {
      problems.push(`"${quoted}" is listed as prose, and is a test's title's start or end`);
    }
    const rows = new Set(cells.flatMap((cell) => cell.match(ROW_ID) ?? []));
    for (const id of rows) {
      if (!ids.has(id)) problems.push(`"${quoted}" is listed as prose in ${id}, which is no row`);
    }
    listedIn.set(quoted, rows);
  }
  /** @type {Map<string, ReadonlySet<string>>} */
  const quotedIn = new Map();
  for (const { id, title, row, named } of citations) {
    if (!named) quotedIn.set(title, new Set([...(quotedIn.get(title) ?? []), id]));
    if (resolves(title, titles)) continue;
    const now = noLonger.get(title);
    if (now === undefined && !named && listedIn.get(title)?.has(id) === true) continue;
    if (now === undefined && !named && listedIn.has(title)) {
      problems.push(`${id} quotes "${title}", which is listed as prose for other rows alone`);
    } else if (now === undefined && !named) {
      problems.push(`${id} quotes "${title}", which is no test's title and is not listed as prose`);
    } else if (now === undefined) {
      problems.push(`${id} names "${title}", which is no test's title`);
    } else {
      const { live, lost } = titlesNow(title, noLonger, titles);
      for (const one of lost) {
        problems.push(`${id} names "${title}", retired for "${one}", which is no title either`);
      }
      for (const one of live) {
        if (!row.includes(one)) {
          problems.push(`${id} names "${title}" and not "${one}", the title it has now`);
        }
      }
    }
  }
  for (const [quoted, rows] of listedIn) {
    for (const id of rows) {
      if (ids.has(id) && quotedIn.get(quoted)?.has(id) !== true) {
        problems.push(`"${quoted}" is listed as prose in ${id}, which does not quote it`);
      }
    }
  }
  return problems;
}

/**
 * What is wrong with one record's citations, given every title a run reports,
 * and how many titles it cites.
 *
 * @param {string} text
 * @param {ReadonlySet<string>} titles
 * @returns {{ readonly problems: readonly string[]; readonly cited: number }}
 */
export function problemsInRecord(text, titles) {
  const citations = citationsIn(text);
  const problems = problemsWith(
    citations,
    titles,
    tableUnder(text, QUOTED_AS_NO_LONGER),
    tableUnder(text, QUOTED_AS_PROSE),
    tableUnder(text, QUOTED_AS_PROSE_IN_A_TITLE),
    dispositionIds(text),
  );
  return { problems, cited: citations.length };
}

/**
 * Every title a Vitest JSON report and a Playwright JSON list hold.
 *
 * @param {VitestReport} report
 * @param {PlaywrightList} list
 * @returns {ReadonlySet<string>}
 */
export function reportedTitles(report, list) {
  return new Set([...vitestTitles(report), ...playwrightTitles(list)]);
}

/**
 * A JSON file, read with any byte-order mark a Windows tool wrote left off.
 *
 * @param {string} path
 * @returns {unknown}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
}

/**
 * The newest modification time of any test file under a directory.
 *
 * @param {string} directory
 * @returns {number}
 */
function newestTest(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestTest(path));
    else if (/\.(?:test|spec)\.tsx?$/u.test(entry.name)) {
      newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

/**
 * Playwright's list of every test in every project, asked for rather than run.
 *
 * @returns {PlaywrightList}
 */
function listPlaywright() {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const run = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`playwright test --list failed:\n${run.stderr}`);
  return /** @type {PlaywrightList} */ (JSON.parse(run.stdout));
}

/**
 * The value after a flag, if the flag was given.
 *
 * @param {readonly string[]} argv
 * @param {string} flag
 * @returns {string | undefined}
 */
function option(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

/**
 * The check over the records and reports the arguments name, or those it
 * finds where none are named, and the status the process exits with.
 *
 * @param {readonly string[]} argv
 * @returns {number}
 */
function main(argv) {
  const reviews = join(REPO_ROOT, 'docs', 'spec', 'reviews');
  const record = option(argv, '--record');
  const recordPaths =
    record === undefined
      ? readdirSync(reviews)
          .filter((name) => name.endsWith('-review.md'))
          .map((name) => join(reviews, name))
      : [record];

  const reportPath = option(argv, '--vitest') ?? VITEST_REPORT;
  const tests = option(argv, '--tests');
  const testFolders =
    tests === undefined
      ? ['apps', 'packages', 'tests'].map((folder) => join(REPO_ROOT, folder))
      : [tests];
  const newest = Math.max(...testFolders.map((folder) => newestTest(folder)));
  if (statSync(reportPath).mtimeMs < newest) {
    console.error(`${reportPath} is older than a test file. Run pnpm test first.`);
    return 1;
  }

  const listPath = option(argv, '--playwright');
  const titles = reportedTitles(
    /** @type {VitestReport} */ (readJson(reportPath)),
    listPath === undefined ? listPlaywright() : /** @type {PlaywrightList} */ (readJson(listPath)),
  );

  let problems = 0;
  let cited = 0;
  for (const path of recordPaths) {
    const found = problemsInRecord(readFileSync(path, 'utf8'), titles);
    cited += found.cited;
    for (const problem of found.problems) {
      problems += 1;
      console.error(problem);
    }
  }
  if (problems > 0) {
    console.error(`${String(problems)} problems with ${String(cited)} cited titles.`);
    return 1;
  }
  console.log(
    `Every one of ${String(cited)} cited titles is a test's title, a title listed with the one its test has now, or quoted text listed as prose.`,
  );
  return 0;
}

// Compared as real paths: Node runs the file a link leads to but keeps the path
// it was given, so compared as written, a check reached through a junction or a
// symbolic link would read nothing and exit zero.
if (
  process.argv[1] !== undefined &&
  realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url))
) {
  process.exitCode = main(process.argv.slice(2));
}
