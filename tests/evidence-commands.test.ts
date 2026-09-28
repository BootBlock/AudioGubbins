import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { inRepository } from './repository.js';

/**
 * The evidence's list of the commands it verified with, held to the scripts the
 * manifest declares.
 *
 * The evidence names each command a reader runs to verify the phase, and says
 * beside it what the command runs. A script changed without that line says what
 * the script ran before, and nothing else reads the line, so it stays untrue
 * with every suite green.
 *
 * Every line of the list is read. A line that runs a script is `pnpm run`, the
 * script's name, and after a `#` the script's steps in order, separated by a
 * comma, with or without "then". Each step is written in full, as the manifest
 * writes it, a step that runs another script as `pnpm run` and that script's
 * name. A part of the line that is no step is one of the phrases of prose named
 * below, and is read as nothing. Any other line is one of the commands outside
 * the manifest named below. So a step left out, one cut short or with an option
 * the script does not give, one said that the script does not run there, a part
 * that is neither a step nor a phrase named here, and a line of neither kind
 * all fail.
 */

/** The evidence, whose list of commands is read. */
const EVIDENCE = 'docs/spec/reviews/phase-01-evidence.md';

/** The heading the list is under. */
const HEADING = '## Commands used for verification';

/** A line of the list that runs a script, and what it says the script runs. */
const SCRIPT_LINE = /^pnpm run (\S+)\s+# (.+)$/u;

/** What separates the parts of what a line says a script runs. */
const PART_SEPARATOR = /, (?:then )?/u;

/**
 * The lines of the list that run no script of the manifest, each read whole:
 * the Rust tests, the specification's own check and its checksums.
 */
const OUTSIDE_THE_MANIFEST: ReadonlySet<string> = new Set([
  'cargo test --workspace',
  'python docs/spec/tools/verify_hardening.py',
  'sha256sum -c docs/spec/CHECKSUMS.sha256',
]);

/**
 * The parts of a line that say something of the steps rather than name one,
 * each read whole, as `PROSE_AFTER_THE` is in `correction-counts.ts`. Each is
 * used by some line of the list, which a test below holds.
 */
const PROSE: ReadonlySet<string> = new Set([
  'every test a disposition names',
  'against the run',
  'every project',
]);

/** The scripts the root manifest declares. */
const SCRIPTS: ReadonlyMap<string, string> = new Map(
  Object.entries(
    (
      JSON.parse(readFileSync(inRepository('package.json'), 'utf8')) as {
        readonly scripts: Readonly<Record<string, string>>;
      }
    ).scripts,
  ),
);

/** The steps a script runs, in order. */
function stepsOf(command: string): readonly string[] {
  return command.split('&&').map((step) => step.trim());
}

/** The lines of the fenced block under the list's heading. */
function listedCommands(evidence: string): readonly string[] {
  const lines = evidence.split(/\r?\n/u);
  const start = lines.indexOf(HEADING);
  const open = lines.findIndex((line, index) => index > start && line.startsWith('```'));
  const close = lines.findIndex((line, index) => index > open && line.startsWith('```'));
  return start === -1 || open === -1 || close === -1 ? [] : lines.slice(open + 1, close);
}

/** The parts of what a line says a script runs, in order, prose among them. */
function partsOf(said: string): readonly string[] {
  return said.split(PART_SEPARATOR);
}

/**
 * Each way a line of the list is untrue of the manifest: a line of neither
 * kind, a script the manifest does not declare, or a part said that is not the
 * step the script runs there, in full.
 */
function untrueOf(lines: readonly string[]): readonly string[] {
  return lines.flatMap((line) => {
    const [, script = '', said = ''] = SCRIPT_LINE.exec(line) ?? [];
    if (script === '') {
      return OUTSIDE_THE_MANIFEST.has(line)
        ? []
        : [`"${line}": is neither a script and its steps nor a command outside the manifest`];
    }
    const command = SCRIPTS.get(script);
    if (command === undefined) return [`${script}: the manifest declares no such script`];

    const steps = stepsOf(command);
    const claimed = partsOf(said).filter((part) => !PROSE.has(part));
    const wrong = Array.from({ length: Math.max(steps.length, claimed.length) }, (_, index) => {
      const step = steps[index];
      const claim = claimed[index];
      if (step !== undefined && claim === step) return [];
      return [`${script}: says "${claim ?? '(nothing)'}" where it runs "${step ?? '(nothing)'}"`];
    });
    return wrong.flat();
  });
}

describe('the evidence says what each command it verified with runs', () => {
  it('says each script it lists as the manifest declares it', () => {
    const lines = listedCommands(readFileSync(inRepository(EVIDENCE), 'utf8'));
    // Named, so that a list moved or renamed would not pass in silence.
    expect(lines.filter((line) => SCRIPT_LINE.test(line)).length).toBeGreaterThan(5);

    expect(untrueOf(lines)).toEqual([]);
  });

  it('names no phrase of prose and no command outside the manifest that the list does not use', () => {
    // A name nothing uses would let a later line pass on a phrase or a
    // command the list has never held.
    const lines = listedCommands(readFileSync(inRepository(EVIDENCE), 'utf8'));
    const parts = new Set(lines.flatMap((line) => partsOf(SCRIPT_LINE.exec(line)?.[2] ?? '')));

    expect([...PROSE].filter((phrase) => !parts.has(phrase))).toEqual([]);
    expect([...OUTSIDE_THE_MANIFEST].filter((command) => !lines.includes(command))).toEqual([]);
  });

  it('refuses a step left out, cut short, given another option or not run, a part it cannot read, and a line of neither kind', () => {
    // Over lines written here, against the manifest as it is, so the reading is
    // shown to fail on each way a line can be untrue.
    const testStep = SCRIPTS.get('test') ?? '';
    expect(stepsOf(SCRIPTS.get('lint') ?? '')).toContain('eslint .');
    expect(stepsOf(SCRIPTS.get('typecheck:full') ?? '')).toContain(
      'tsc --build --force tsconfig.build.json',
    );

    expect(
      untrueOf([
        'pnpm run lint             # pnpm run version:check, pnpm run graph:check, eslint ., prettier --check .',
        'pnpm run typecheck:full   # tsc --build --force tsconfig.build.json, then tsc -p tsconfig.json',
        `pnpm run test             # ${testStep}`,
        'pnpm run test:e2e         # playwright test, every project',
        'cargo test --workspace',
      ]),
    ).toEqual([]);

    expect(
      untrueOf(['pnpm run lint # pnpm run version:check, eslint ., prettier --check .']),
    ).toEqual([
      'lint: says "eslint ." where it runs "pnpm run graph:check"',
      'lint: says "prettier --check ." where it runs "eslint ."',
      'lint: says "(nothing)" where it runs "prettier --check ."',
    ]);
    expect(
      untrueOf([
        'pnpm run lint # pnpm run version:check, pnpm run graph:check, tsc, eslint ., prettier --check .',
      ]).length,
    ).toBeGreaterThan(0);
    expect(
      untrueOf([
        'pnpm run lint # pnpm run version:check, pnpm run graph:check, eslint . --fix, prettier --check .',
      ]),
    ).toEqual(['lint: says "eslint . --fix" where it runs "eslint ."']);
    expect(
      untrueOf([
        'pnpm run lint # version:check, pnpm run graph:check, eslint ., prettier --check .',
      ]),
    ).toEqual(['lint: says "version:check" where it runs "pnpm run version:check"']);
    expect(untrueOf(['pnpm run typecheck:full # tsc --build, then tsc -p tsconfig.json'])).toEqual([
      'typecheck:full: says "tsc --build" where it runs "tsc --build --force tsconfig.build.json"',
    ]);
    expect(untrueOf([`pnpm run test # ${testStep}, jest`])).toEqual([
      'test: says "jest" where it runs "(nothing)"',
    ]);
    expect(untrueOf(['pnpm run no-such-script # eslint .'])).toEqual([
      'no-such-script: the manifest declares no such script',
    ]);
    expect(untrueOf(['pnpm run test:e2e', 'pnpm test', 'echo done'])).toEqual([
      '"pnpm run test:e2e": is neither a script and its steps nor a command outside the manifest',
      '"pnpm test": is neither a script and its steps nor a command outside the manifest',
      '"echo done": is neither a script and its steps nor a command outside the manifest',
    ]);
  });
});
