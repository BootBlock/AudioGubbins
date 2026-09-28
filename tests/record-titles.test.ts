import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type PlaywrightList,
  type VitestReport,
  problemsInRecord,
  reportedTitles,
} from '../tools/check-record-titles.mjs';
import { inRepository } from './repository.js';

/**
 * The check that holds a review record's dispositions to the tests they name.
 *
 * A Proof names the test a mutation failed by its title, so a reader can find
 * it and put the defect back, and a title renamed, quoted from memory or
 * quoted in part sends them nowhere. The record, the Vitest report and the
 * Playwright list are written here, so each case says what it asserts and runs
 * without a suite behind it. How a record is read is asked of the check in
 * this process. What only the process shows, its exit, what it prints and its
 * refusal of a report older than a test, is asked of it run as the build runs
 * it: against a test file of its own, and against the repository's tests only
 * where the case is that it reads them when it is given none.
 */

const CHECKER = inRepository('tools', 'check-record-titles.mjs');

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'audiogubbins-record-'));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** A disposition row whose cell says what it says. */
function disposition(id: string, cell: string): string {
  return `| ${id} | **Fixed.** ${cell} |`;
}

/**
 * Quoted text listed as naming no test: the text, and the rows it is listed
 * for, which are `F-1` where only the text is given.
 */
type Prose = string | readonly [string, string];

/**
 * What a record lists beside its rows: titles quoted as no test has them now,
 * prose, and prose a title starts or ends with.
 */
interface Listed {
  readonly noLonger?: readonly (readonly [string, string])[];
  readonly prose?: readonly Prose[];
  readonly proseInATitle?: readonly Prose[];
}

/** The titles a run and a list report. */
interface Reported {
  readonly vitest?: readonly string[];
  readonly playwright?: readonly string[];
}

/** The rows of a prose table. */
function proseRows(listed: readonly Prose[]): readonly string[] {
  return listed.map((one) =>
    typeof one === 'string' ? `| ${one} | F-1 |` : `| ${one[0]} | ${one[1]} |`,
  );
}

/** A record of the rows given, with what it lists beside them. */
function recordOf(
  rows: readonly string[],
  { noLonger = [], prose = [], proseInATitle = [] }: Listed,
): string {
  return [
    '| Id | Disposition |',
    '| --- | --- |',
    ...rows,
    '',
    '### Titles a disposition quotes that no test has now',
    '',
    '| Quoted | The title its test has now |',
    '| --- | --- |',
    ...noLonger.map(([quoted, now]) => `| ${quoted} | ${now} |`),
    '',
    '### Quoted text that names no test',
    '',
    '| Quoted | In |',
    '| --- | --- |',
    ...proseRows(prose),
    '',
    '### Quoted text that names no test, though a title contains it',
    '',
    '| Quoted | In |',
    '| --- | --- |',
    ...proseRows(proseInATitle),
    '',
  ].join('\n');
}

/** A Vitest report holding the titles given. */
function vitestReport(titles: readonly string[]): VitestReport {
  return { testResults: [{ assertionResults: titles.map((title) => ({ title })) }] };
}

/** A Playwright list holding the titles given, in a suite inside a file's suite. */
function playwrightList(titles: readonly string[]): PlaywrightList {
  return { suites: [{ specs: [], suites: [{ specs: titles.map((title) => ({ title })) }] }] };
}

/** What the check finds wrong with a record, against the titles a run and a list report. */
function check(
  rows: readonly string[],
  { vitest = [], playwright = [], ...listed }: Listed & Reported = {},
): { readonly problems: readonly string[]; readonly output: string } {
  const { problems } = problemsInRecord(
    recordOf(rows, listed),
    reportedTitles(vitestReport(vitest), playwrightList(playwright)),
  );
  return { problems, output: problems.join('\n') };
}

/** An hour, in milliseconds. */
const HOUR = 60 * 60 * 1000;

/** A time a number of milliseconds ago, in the seconds `utimesSync` takes. */
function ago(milliseconds: number): number {
  return (Date.now() - milliseconds) / 1000;
}

/** How the check is run as a process. */
interface Run {
  /** How long ago the report was written, or from now where it is negative. */
  readonly reportAge: number;

  /**
   * How long ago the one test file of a folder of its own was written. Left
   * out, the check is given no folder, and reads the repository's own tests.
   */
  readonly testAge?: number;

  /** The path the check is run by. */
  readonly checker?: string;

  /** The titles the Playwright list it is given holds, which are none where left out. */
  readonly playwright?: readonly string[];
}

/**
 * Runs the check as a process over a record, against a report and a test file
 * written when `Run` says, in a folder of their own.
 */
function run(
  rows: readonly string[],
  vitest: readonly string[],
  { reportAge, testAge, checker = CHECKER, playwright = [] }: Run,
): { readonly status: number; readonly output: string } {
  const record = join(folder, 'phase-99-review.md');
  writeFileSync(record, recordOf(rows, {}));

  const report = join(folder, 'vitest.json');
  writeFileSync(report, JSON.stringify(vitestReport(vitest)));
  utimesSync(report, ago(reportAge), ago(reportAge));

  const list = join(folder, 'playwright.json');
  writeFileSync(list, JSON.stringify(playwrightList(playwright)));

  const options = ['--record', record, '--vitest', report, '--playwright', list];
  if (testAge !== undefined) {
    const tests = join(folder, 'tests');
    mkdirSync(tests);
    const test = join(tests, 'a.test.ts');
    writeFileSync(test, '');
    utimesSync(test, ago(testAge), ago(testAge));
    options.push('--tests', tests);
  }

  const ran = spawnSync(process.execPath, [checker, ...options], { encoding: 'utf8' });
  return { status: ran.status ?? -1, output: `${ran.stdout}${ran.stderr}` };
}

describe('the check that holds a record to the tests it names', () => {
  it('passes a record whose every named test is one a run reports', () => {
    const result = run(
      [
        disposition(
          'F-1',
          'Proof: the guard removed fails "keeps the bound, whatever it is given".',
        ),
      ],
      ['keeps the bound, whatever it is given'],
      { reportAge: 0, testAge: HOUR },
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain('Every one of 1 cited titles');
  });

  it('refuses a Proof naming a test no run reports', () => {
    const result = run(
      [disposition('F-1', 'Proof: the guard removed fails "keeps the bound, whatever it holds".')],
      ['keeps the bound, whatever it is given'],
      { reportAge: 0, testAge: HOUR },
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain('F-1 names "keeps the bound, whatever it holds"');
  });

  it('reads a browser test by the title Playwright lists', () => {
    const result = check(
      [disposition('F-1', 'Proof: the attribute removed fails "says what it recorded, aloud".')],
      { playwright: ['says what it recorded, aloud'] },
    );

    expect(result.problems).toEqual([]);
  });

  it('reads each title chained after the first, and refuses one that is no test', () => {
    const result = check(
      [
        disposition(
          'F-1',
          'Proof: it fails "cuts at a word", "cuts at a character" and "cuts at a sentence".',
        ),
      ],
      { vitest: ['cuts at a word', 'cuts at a character'] },
    );

    expect(result.problems).not.toEqual([]);
    expect(result.output).toContain('F-1 names "cuts at a sentence"');
  });

  it('reads a title written before the word it failed with, and not a defect written before a title', () => {
    // The other way a Proof is written.
    const before = check([disposition('F-1', 'Proof: "keeps the bound" fails without it.')], {
      vitest: ['keeps the bound, whatever it is given'],
    });
    // Here the first quote is the defect put back, and the second the title.
    const defect = check(
      [
        disposition(
          'F-1',
          'Proof: the guard put back as "unless it is open" fails "keeps the bound".',
        ),
      ],
      { vitest: ['keeps the bound'], prose: ['unless it is open'] },
    );

    expect(before.problems).not.toEqual([]);
    expect(before.output).toContain('F-1 names "keeps the bound"');
    expect(defect.problems).toEqual([]);
  });

  it('reads every title a correction lists as the ones its tests have now', () => {
    const result = check(
      [disposition('F-1', 'The tests are `cuts at a word` and `cuts at a sentence`.')],
      { vitest: ['cuts at a word'] },
    );

    expect(result.problems).not.toEqual([]);
    expect(result.output).toContain('F-1 names "cuts at a sentence"');
  });

  it('reads the title a correction says a test has now', () => {
    const result = check(
      [disposition('F-1', 'The test is `nudges a panel, and clamps it to each edge`.')],
      { vitest: ['nudges a panel, says which way, and stops it against each edge'] },
    );

    expect(result.problems).not.toEqual([]);
    expect(result.output).toContain('F-1 names "nudges a panel, and clamps it to each edge"');
  });

  it('resolves a template where a title the run expanded fits it, and only there', () => {
    const titled = check(
      [disposition('F-1', 'Proof: it fails "binds nothing the browser takes on ${convention}".')],
      { vitest: ['binds nothing the browser takes on Apple'] },
    );
    const untitled = check(
      [disposition('F-1', 'Proof: it fails "binds nothing the browser takes on ${convention}".')],
      { vitest: ['binds nothing the system takes on Apple'] },
    );

    expect(titled.problems).toEqual([]);
    expect(untitled.problems).not.toEqual([]);
  });

  it('reads a title after a bare by, and leaves a word or two quoted after one as prose', () => {
    const prose = check([disposition('F-1', 'Two names joined by "and" were left standing.')]);
    const cited = check([disposition('F-1', 'The colours are read by "draws a state in colour".')]);

    expect(prose.problems).toEqual([]);
    expect(cited.problems).not.toEqual([]);
    expect(cited.output).toContain('F-1 names "draws a state in colour"');
  });

  it('passes a retired title only in a row that also names the title its test has now', () => {
    const now = 'takes focus back to Change after Cancel, rather than to the top of the settings';
    const corrected = check(
      [
        disposition(
          'F-1',
          `Proof: it fails "after Cancel". **Corrected later.** The test is \`${now}\`.`,
        ),
      ],
      { vitest: [now], noLonger: [['after Cancel', now]] },
    );
    const uncorrected = check([disposition('F-1', 'Proof: it fails "after Cancel".')], {
      vitest: [now],
      noLonger: [['after Cancel', now]],
    });

    expect(corrected.problems).toEqual([]);
    expect(uncorrected.problems).not.toEqual([]);
    expect(uncorrected.output).toContain(`and not "${now}"`);
  });

  it('reads a quoted title in any form, and refuses one quoted from its start', () => {
    // The forms a row names a test in are not a closed list, so every quote
    // is read, whatever words come before it.
    const result = check(
      [
        disposition(
          'F-1',
          'The evidence cites "keeps the bound" and, in a browser, "draws the ring".',
        ),
      ],
      { vitest: ['keeps the bound, whatever it is given'], playwright: ['draws the ring'] },
    );

    expect(result.problems).not.toEqual([]);
    expect(result.output).toContain('F-1 quotes "keeps the bound"');
    expect(result.output).not.toContain('"draws the ring"');
  });

  it('passes quoted text the record lists as prose, and refuses prose that is a title', () => {
    const row = disposition('F-1', 'The comment said "no user meets it" and was wrong.');
    const listed = check([row], { prose: ['no user meets it'] });
    const unlisted = check([row]);
    const hidden = check([row], {
      vitest: ['no user meets it, on any engine'],
      prose: ['no user meets it'],
    });
    const whole = check([row], { vitest: ['no user meets it'], prose: ['no user meets it'] });
    // A whole title is refused where it is listed as text a title contains
    // as well, which excuses a title's start or end and nothing more.
    const wholeInATitle = check([row], {
      vitest: ['no user meets it'],
      proseInATitle: ['no user meets it'],
    });

    expect(listed.problems).toEqual([]);
    expect(unlisted.problems).not.toEqual([]);
    expect(unlisted.output).toContain('is not listed as prose');
    expect(hidden.problems).not.toEqual([]);
    expect(hidden.output).toContain('"no user meets it" is listed as prose');
    expect(whole.problems).not.toEqual([]);
    expect(whole.output).toMatch(
      /^"no user meets it" is listed as prose, and is a test's title$/mu,
    );
    expect(wholeInATitle.problems).not.toEqual([]);
    expect(wholeInATitle.output).toMatch(
      /^"no user meets it" is listed as prose, and is a test's title$/mu,
    );
  });

  it('refuses prose a title ends with, unless it is listed as text a title contains', () => {
    // Three titles end "written after an ellipsis", and a row named all three
    // by that end, listed as prose.
    const row = disposition('F-1', 'Each fails its "written after an ellipsis" test.');
    const titles = ['removes a web address written after an ellipsis'];
    const asProse = check([row], { vitest: titles, prose: ['written after an ellipsis'] });
    const inATitle = check([row], {
      vitest: titles,
      proseInATitle: ['written after an ellipsis'],
    });

    expect(asProse.problems).not.toEqual([]);
    expect(asProse.output).toContain("is a test's title's start or end");
    expect(inATitle.problems).toEqual([]);
  });

  it('reads listed prose written as one code span as the text inside it', () => {
    // Code is listed as a code span, since a tag written bare is markup to a
    // renderer, which shows nothing of it.
    const row = disposition('F-1', 'The page carries `<meta name="referrer" content="x">` now.');
    const spanned = check([row], { prose: ['`<meta name="referrer" content="x">`'] });
    const bare = check([row], { prose: ['<meta name="referrer" content="x">'] });
    const twoSpans = check([row], { prose: ['`<meta name="referrer"` `content="x">`'] });

    expect(spanned.problems).toEqual([]);
    expect(bare.problems).toEqual([]);
    expect(twoSpans.problems).not.toEqual([]);
    expect(twoSpans.output).toContain('is not listed as prose');
  });

  it('passes listed prose only in the rows it is listed for, each of which quotes it', () => {
    const rows = [
      disposition('F-1', 'The comment said "no user meets it".'),
      disposition('F-2', 'The note said "no user meets it" as well.'),
      disposition('F-3', 'Nothing is quoted here.'),
    ];
    const both = check(rows, { prose: [['no user meets it', 'F-1, F-2']] });
    const one = check(rows, { prose: [['no user meets it', 'F-1']] });
    const quotedNowhere = check(rows, { prose: [['no user meets it', 'F-1, F-2, F-3']] });
    const noSuchRow = check(rows, { prose: [['no user meets it', 'F-1, F-2, F-9']] });

    expect(both.problems).toEqual([]);
    expect(one.problems).not.toEqual([]);
    expect(one.output).toContain(
      'F-2 quotes "no user meets it", which is listed as prose for other rows alone',
    );
    expect(quotedNowhere.problems).not.toEqual([]);
    expect(quotedNowhere.output).toContain('listed as prose in F-3, which does not quote it');
    expect(noSuchRow.problems).not.toEqual([]);
    expect(noSuchRow.output).toContain('listed as prose in F-9, which is no row');
  });

  it('reads a title in backticks in any form, as it reads one in double quotes', () => {
    // A correction wrote "and is" before a title in backticks, a form the
    // lead-ins it reads titles after do not include.
    const title = 'leaves Command+Numpad1 to the page, which neither engine keeps from it';
    const named = check([disposition('F-1', `The test holds the opposite, and is \`${title}\`.`)], {
      vitest: [title],
    });
    const mistyped = check(
      [
        disposition(
          'F-1',
          'The test holds the opposite, and is `leaves Command+Numpad1 to the page`.',
        ),
      ],
      { vitest: [title] },
    );
    const code = check([disposition('F-1', 'It runs `playwright test --list` first.')]);
    const listed = check([disposition('F-1', 'It runs `playwright test --list` first.')], {
      prose: ['playwright test --list'],
    });

    expect(named.problems).toEqual([]);
    expect(mistyped.problems).not.toEqual([]);
    expect(mistyped.output).toContain('F-1 quotes "leaves Command+Numpad1 to the page"');
    expect(code.problems).not.toEqual([]);
    expect(listed.problems).toEqual([]);
  });

  it('reads every title a correction lists after They are', () => {
    const result = check(
      [disposition('F-1', 'They are `cuts at a word` and `cuts at a sentence`.')],
      { vitest: ['cuts at a word'], prose: ['cuts at a sentence'] },
    );

    // Named, so listing it as prose does not excuse it.
    expect(result.problems).not.toEqual([]);
    expect(result.output).toContain('F-1 names "cuts at a sentence"');
  });

  it('reads a quote retired for several titles as all of them, wherever else it is listed', () => {
    const titles = [
      'removes a web address written after an ellipsis',
      'removes a share address written after an ellipsis',
    ];
    const noLonger: readonly (readonly [string, string])[] = titles.map((title) => [
      'written after an ellipsis',
      title,
    ]);
    const quote = 'Each fails its "written after an ellipsis" test.';
    const both = check(
      [
        disposition(
          'F-1',
          `${quote} The tests are \`${titles[0] ?? ''}\` and \`${titles[1] ?? ''}\`.`,
        ),
      ],
      { vitest: titles, noLonger, prose: ['written after an ellipsis'] },
    );
    const one = check([disposition('F-1', `${quote} The test is \`${titles[0] ?? ''}\`.`)], {
      vitest: titles,
      noLonger,
      prose: ['written after an ellipsis'],
    });

    expect(both.problems).toEqual([]);
    expect(one.problems).not.toEqual([]);
    expect(one.output).toContain(`and not "${titles[1] ?? ''}"`);
  });

  it('follows a title retired again by a later correction to the title its test has now', () => {
    // The record is append-only, so a title listed for one that a later
    // correction renamed stays listed as it was.
    const title = 'refuses Ctrl+L on Windows, which a reader relies on the browser for';
    const noLonger: readonly (readonly [string, string])[] = [
      ['leaves Ctrl+L to the page', 'refuses Ctrl+L, which a reader relies on the browser for'],
      ['refuses Ctrl+L, which a reader relies on the browser for', title],
    ];
    const quote = 'The row names "leaves Ctrl+L to the page".';
    const followed = check([disposition('F-1', `${quote} The test is \`${title}\`.`)], {
      vitest: [title],
      noLonger,
    });
    const stopped = check([disposition('F-1', quote)], { vitest: [title], noLonger });

    expect(followed.problems).toEqual([]);
    expect(stopped.problems).not.toEqual([]);
    expect(stopped.output).toContain(`and not "${title}"`);
  });

  it('reads the dispositions alone, where a finding quotes what a lens read at the time', () => {
    const result = check([
      '| F-1 | LOW | The Proof says the guard removed fails "a title since renamed" |',
    ]);

    expect(result.problems).toEqual([]);
  });

  it('reads a browser title from the list it is given', () => {
    // The title is in the Playwright list alone, so a check that read no list,
    // or asked Playwright for one of its own, would refuse the row.
    const result = run(
      [disposition('F-1', 'Proof: the attribute removed fails "says what it recorded, aloud".')],
      ['keeps the bound, whatever it is given'],
      { reportAge: 0, testAge: HOUR, playwright: ['says what it recorded, aloud'] },
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain('Every one of 1 cited titles');
  });

  it('refuses a report older than a test file, which describes tests no longer there', () => {
    // The test is written an hour after the report, so no file of the
    // repository's own can be the one the refusal reads.
    const result = run([], [], { reportAge: 0, testAge: -HOUR });

    expect(result.status).toBe(1);
    expect(result.output).toContain('is older than a test file');
  });

  it("reads the repository's own tests where it is given no folder, and refuses a report older than them", () => {
    // Written in 2000, before any test of the repository's, so the refusal
    // can only be missed by a check that read no test at all.
    const result = run([], [], { reportAge: Date.now() - Date.UTC(2000, 0, 1) });

    expect(result.status).toBe(1);
    expect(result.output).toContain('is older than a test file');
  });

  it('checks a record when it is run through a link to the folder it is in', () => {
    // A junction on Windows, and a symbolic link elsewhere; removing the
    // folder removes the link and leaves the tools it leads to.
    const tools = join(folder, 'tools');
    symlinkSync(inRepository('tools'), tools, 'junction');

    const result = run(
      [disposition('F-1', 'Proof: the guard removed fails "keeps the bound, whatever it holds".')],
      ['keeps the bound, whatever it is given'],
      { reportAge: 0, testAge: HOUR, checker: join(tools, 'check-record-titles.mjs') },
    );

    expect(result.status).toBe(1);
    expect(result.output).toContain('F-1 names "keeps the bound, whatever it holds"');
  });
});
