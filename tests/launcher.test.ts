import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { inRepository } from './repository.js';

/**
 * The Windows launchers, `Run.bat` and `Run.ps1`.
 *
 * Neither is exercised by any other test, and each depends on facts that live
 * elsewhere in the repository. When one of those facts changes, the launcher
 * keeps starting a server and simply stops opening the browser, which nobody
 * would trace back to a renamed title or a moved port.
 */

/** Reads a file at the repository root, as bytes decoded one-for-one. */
function read(name: string): string {
  return readFileSync(inRepository(name), 'latin1');
}

/** The value a PowerShell assignment gives a variable in `Run.ps1`. */
function launcherSetting(name: string): string {
  const match = new RegExp(`^\\$${name} = '?([^'\\r\\n]*)'?\\r?$`, 'm').exec(read('Run.ps1'));
  if (match?.[1] === undefined) throw new Error(`Run.ps1 no longer assigns $${name}.`);
  return match[1];
}

describe('the launchers', () => {
  it('are ASCII, so Windows PowerShell and cmd.exe read them as written', () => {
    // Windows PowerShell 5.1, which Run.bat starts, reads a script without a
    // byte order mark in the ANSI code page, and cmd.exe reads a batch file in
    // the console's. A UTF-8 dash or quote in a string reaches the screen as
    // mojibake, and in a batch file it can break the line it is on.
    for (const name of ['Run.ps1', 'Run.bat']) {
      expect(read(name), name).toMatch(/^[\t\r\n\x20-\x7e]*$/);
    }
  });

  it('check batch files out with CRLF line endings', () => {
    expect(read('.gitattributes')).toMatch(/^\*\.bat\s+text\s+eol=crlf$/m);
  });

  it('recognise the page by the title the application actually has', () => {
    // The launcher reuses a running server, and opens the browser on a new
    // one, only once the page it serves carries this title.
    const title = /<title>[^<]*<\/title>/.exec(read('apps/web/index.html'))?.[0];
    expect(launcherSetting('AppTitle')).toBe(title);
  });

  it('serve a preview on a port the browser suite does not use', () => {
    // The suite serves its own builds on fixed ports and refuses to start when
    // one is taken, so a preview left running there would fail every run of it.
    const suitePorts = [...read('playwright.config.ts').matchAll(/--port (\d+)/g)].map(
      (match) => match[1],
    );
    expect(suitePorts).not.toHaveLength(0);
    expect(suitePorts).not.toContain(launcherSetting('PreviewDefaultPort'));
  });
});

/** One question for a function of `Run.ps1`: the function, and each call asked of it. */
interface Question {
  readonly function: string;
  readonly calls: readonly string[];
}

/** A string as a PowerShell literal, which doubles a quote and nothing else. */
function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** The bases the path the server serves is asked for. */
const BASES = ['', '/', '/AudioGubbins/', '/AudioGubbins', 'AudioGubbins/', './'];

/** The addresses the host a browser opens is asked for. */
const ADDRESSES = ['127.0.0.1', '0.0.0.0', '::1', '::', 'localhost'];

/**
 * An invented checkout, and command lines in the shape Windows reports them
 * under it, each with whether it is a development server of the checkout.
 */
const CHECKOUT = 'D:\\Projects\\AudioGubbins\\';
const VITE = `${CHECKOUT}apps\\web\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js`;
const COMMAND_LINES: readonly (readonly [string, string])[] = [
  // The launcher gives Vite a port and a host.
  [`node "${VITE}" "--port" "5173" "--strictPort" "--host" "127.0.0.1"`, 'True'],
  // Started outside the launcher, so Vite has no arguments and the command
  // line ends at the name.
  [`node "${VITE}"`, 'True'],
  [`node "${VITE}" preview "--port" "4180"`, 'False'],
  // A worktree whose directory name merely begins with this one's.
  [
    `node "${CHECKOUT.slice(0, -1)}-phase-01\\apps\\web\\node_modules\\vite\\bin\\vite.js"`,
    'False',
  ],
  [`node "${CHECKOUT}tools\\sync-version.mjs"`, 'False'],
];

/** Node ranges and versions, each with whether the version meets the range. */
const ENGINES: readonly (readonly [string, string, string])[] = [
  ['^22.12.0 || ^24 || >=26', '22.11.9', 'False'],
  ['^22.12.0 || ^24 || >=26', '22.12.0', 'True'],
  ['^22.12.0 || ^24 || >=26', '23.5.0', 'False'],
  ['^22.12.0 || ^24 || >=26', '24.9.9', 'True'],
  ['^22.12.0 || ^24 || >=26', '25.9.9', 'False'],
  ['^22.12.0 || ^24 || >=26', '26.0.0', 'True'],
  ['~1.2.3', '1.3.0', 'False'],
  ['>=18 <20', '19.1.0', 'True'],
  // A range written in a form the launcher cannot read answers neither way,
  // so an unreadable range never reports a working Node as unsupported.
  ['22.x', '22.1.0', ''],
];

/** The Node range package.json states. */
const STATED_RANGE = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines
  .node;

/** Every question the tests below ask of `Run.ps1`, by the name each test reads it by. */
const QUESTIONS = {
  basePath: {
    function: 'Get-BasePath',
    calls: BASES.map((base) => `Get-BasePath ${literal(base)}`),
  },
  urlHost: {
    function: 'Get-UrlHost',
    calls: ADDRESSES.map((address) => `Get-UrlHost ${literal(address)}`),
  },
  devServer: {
    function: 'Test-DevServerCommandLine',
    calls: COMMAND_LINES.map(
      ([commandLine]) => `Test-DevServerCommandLine ${literal(commandLine)} ${literal(CHECKOUT)}`,
    ),
  },
  engines: {
    function: 'Test-NodeEngine',
    calls: ENGINES.map(
      ([range, version]) => `Test-NodeEngine ${literal(range)} ([version]${literal(version)})`,
    ),
  },
  statedRange: {
    function: 'Test-NodeEngine',
    calls: [`Test-NodeEngine ${literal(STATED_RANGE)} ([version]'24.0.0')`],
  },
} as const satisfies Readonly<Record<string, Question>>;

/**
 * Asks every question of the functions of `Run.ps1` in one PowerShell, and
 * returns the answers to each, or why it has none.
 *
 * Each function is taken from the file's syntax tree and defined on its own,
 * so the launcher's body neither starts a server nor installs anything here.
 * Each function tested this way decides where the browser is sent, which
 * server is reused, or what the user is told, and each encodes a rule that
 * lives elsewhere: Vite's handling of a base path, the command line a running
 * server has, and the version range in package.json.
 *
 * One PowerShell for them all, because starting one and parsing the file is
 * most of the time any question takes. A function the file no longer defines,
 * and a call that throws, fail the question they are asked for and no other.
 */
function askLauncher(
  questions: Readonly<Record<string, Question>>,
): ReadonlyMap<string, readonly string[] | Error> {
  const functions = [...new Set(Object.values(questions).map((one) => one.function))];
  const asked = Object.entries(questions).map(([name, question]) => {
    const defined = `if (-not (Get-Command ${literal(question.function)} -CommandType Function -ErrorAction SilentlyContinue)) { throw ${literal(`Run.ps1 no longer defines ${question.function}.`)} }`;
    const calls = question.calls.map((call) => `"|${name}|$(${call})"`).join('; ');
    return `try { ${defined}; ${calls} } catch { "!${name}|$($_.Exception.Message)" }`;
  });
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$ast = [Management.Automation.Language.Parser]::ParseFile(${literal(inRepository('Run.ps1'))}, [ref]$null, [ref]$null)`,
    ...functions.map(
      (name) =>
        `$function = $ast.FindAll({ $args[0] -is [Management.Automation.Language.FunctionDefinitionAst] -and $args[0].Name -eq ${literal(name)} }, $true)[0]; if ($function) { Invoke-Expression $function.Extent.Text }`,
    ),
    ...asked,
  ].join('\n');
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8' },
  );

  // Each answer is marked with its question, because an answer can be empty:
  // a question the function declines to answer prints nothing, and an
  // unmarked empty line at the end of the output would be lost rather than
  // compared.
  const answers = new Map<string, string[] | Error>(
    Object.keys(questions).map((name) => [name, []]),
  );
  for (const line of output.split(/\r?\n/u)) {
    const marked = /^([|!])([^|]+)\|(.*)$/u.exec(line);
    if (marked === null) continue;
    const [, mark, name = '', text = ''] = marked;
    const answered = answers.get(name);
    if (mark === '!') answers.set(name, new Error(text));
    else if (Array.isArray(answered)) answered.push(text);
  }
  return answers;
}

/** The answers {@link askLauncher} gave, asked for once by the first test that reads one. */
let answered: ReadonlyMap<string, readonly string[] | Error> | undefined;

/** What `Run.ps1` answered to one question. */
function answersTo(question: keyof typeof QUESTIONS): readonly string[] {
  answered ??= askLauncher(QUESTIONS);
  const answers = answered.get(question);
  if (answers === undefined) throw new Error(`No question is named ${question}.`);
  if (answers instanceof Error) throw answers;
  return answers;
}

describe.runIf(process.platform === 'win32')('Run.ps1 answers about', () => {
  it('the path the server serves, for every base the build accepts', () => {
    // Checked against the development server itself: a base with no leading
    // slash is given one, a relative base is served at the root, and a base
    // with no trailing slash gets one. Opening any other path loads the page
    // without the assets it asks for.
    expect(answersTo('basePath')).toEqual([
      '/',
      '/',
      '/AudioGubbins/',
      '/AudioGubbins/',
      '/AudioGubbins/',
      '/',
    ]);
  });

  it('the host a browser opens for an address a server is bound to', () => {
    // A wildcard address is not one a browser can open, and an IPv6 address is
    // bracketed. The launcher opens the address a reused server is bound to,
    // which for a server started by `pnpm dev` is the IPv6 loopback.
    expect(answersTo('urlHost')).toEqual(['127.0.0.1', '127.0.0.1', '[::1]', '[::1]', 'localhost']);
  });

  it('which running process is a development server of this checkout', () => {
    expect(answersTo('devServer')).toEqual(COMMAND_LINES.map(([, answer]) => answer));
  });

  it('whether a Node version meets a range, for each comparator a range uses', () => {
    expect(answersTo('engines')).toEqual(ENGINES.map(([, , answer]) => answer));
  });

  it('that the range package.json states is one it can read', () => {
    // The warning about an unsupported Node is only given when this answers,
    // and it answers with one of the two.
    expect(answersTo('statedRange')).toEqual([expect.stringMatching(/^(?:True|False)$/u)]);
  });
});
