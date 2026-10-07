import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RUNTIME_WEBASSEMBLY_FILES,
  checkDirectory,
  packProblems,
} from '../tools/check-build-output.mjs';
import { rootsOf } from '../tools/local-traces.mjs';
import {
  loadPackDefinitions,
  type PackDefinition,
} from '../tools/model-packs/pack-definitions.mjs';
import { publishPack, writeCatalogue } from '../tools/model-packs/pack-output.mjs';
import { REPOSITORY_ROOT, forwardSlashes, inRepository } from './repository.js';

/**
 * The gate over deployable build output (REQ-PRIV-161).
 *
 * `apps/web/dist/` is uploaded verbatim by a static host, and an absolute path
 * in it names the account that produced the build, as a source map a generator
 * writes through a temporary directory does. No other check reads the build
 * output for a path, so without this gate lint, typecheck, the unit suite and
 * the architecture rules would all be green while such a path was in the tree.
 *
 * The directories are built here rather than taken from a real build, so the
 * test says what it is asserting and runs without one. What the gate finds is
 * asked of it in this process, against the roots of an invented machine, so an
 * account named like a word in an artefact, `react` or `src`, cannot change
 * the answer. What only the process shows is asked of it run as the build runs
 * it, because failing the build is the behaviour that matters: a checker that
 * finds a leak and exits zero is no gate.
 */

const CHECKER = inRepository('tools', 'check-build-output.mjs');

/** Runs the gate over a directory and reports what a build would see. */
function check(
  directory: string,
  checker = CHECKER,
): { readonly status: number; readonly output: string } {
  const run = spawnSync(process.execPath, [checker, directory], { encoding: 'utf8' });
  return { status: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

/** An invented machine: its checkout, its home, its temporary directory and its account. */
const MACHINE = rootsOf(
  [
    'C:\\Users\\maker\\audiogubbins',
    'C:\\Users\\builder',
    'C:\\Users\\maker\\AppData\\Local\\Temp',
  ],
  'maker',
);

/** What the gate finds in the directory under test, on the invented machine. */
function problems(): ReturnType<typeof checkDirectory> {
  return checkDirectory(output, MACHINE);
}

let output: string;

/**
 * The rule of the built stylesheet that keeps text at its size on Safari on a
 * phone, as the transformer writes it with the floor the build declares.
 */
const TEXT_SIZE =
  'html{-webkit-text-size-adjust:100%;-moz-text-size-adjust:100%;text-size-adjust:100%}';

/** Where a build serves the inference runtime's WebAssembly. */
const RUNTIME_FOLDER = 'inference/onnxruntime-web-1.30.0';

/** Stand-ins for each runtime build's WebAssembly, by file name. */
const RUNTIME_BYTES: ReadonlyMap<string, Uint8Array> = new Map(
  RUNTIME_WEBASSEMBLY_FILES.map((name, index) => [name, new Uint8Array([0, 97, 115, 109, index])]),
);

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Serves the runtime's files in `root`, with a script stating each one's digest, as a build does. */
function servedRuntime(root: string): void {
  mkdirSync(join(root, RUNTIME_FOLDER), { recursive: true });
  for (const [name, bytes] of RUNTIME_BYTES) writeFileSync(join(root, RUNTIME_FOLDER, name), bytes);
  const digests = [...RUNTIME_BYTES.values()].map(sha256Of);
  writeFileSync(
    join(root, 'assets', 'runtime-abc.js'),
    `const e={cpu:"${digests[0] ?? ''}",webgpu:"${digests[1] ?? ''}"};export{e as R};`,
    'utf8',
  );
}

/**
 * The committed definitions, each with its files made small stand-ins whose
 * lengths and digests it records, so a pack can be built here byte for byte.
 */
const STAND_IN_PACKS: readonly (readonly [PackDefinition, ReadonlyMap<string, Uint8Array>])[] =
  loadPackDefinitions().map((definition, pack) => {
    const bytes = new Map(
      definition.files.map((file, index) => [file.path, new Uint8Array([pack, index, 7, 3])]),
    );
    const files = definition.files.map((file) => {
      const made = bytes.get(file.path) ?? new Uint8Array();
      return { ...file, bytes: made.length, sha256: sha256Of(made) };
    });
    return [{ ...definition, files }, bytes] as const;
  });

const STAND_IN_DEFINITIONS = STAND_IN_PACKS.map(([definition]) => definition);

/** Ships the packs at `indices` of the stand-ins under `packs/`, as a build copies the built ones. */
async function shippedPacks(indices: readonly number[]): Promise<void> {
  const out = join(output, 'packs');
  const shipped = indices.map((index) => {
    const pack = STAND_IN_PACKS[index];
    if (pack === undefined) throw new Error(`No pack is defined at ${String(index)}.`);
    return pack;
  });
  for (const [definition, bytes] of shipped) {
    await publishPack(out, definition, (folder) => {
      for (const [path, made] of bytes) {
        mkdirSync(join(folder, path, '..'), { recursive: true });
        writeFileSync(join(folder, path), made);
      }
      return Promise.resolve();
    });
  }
  await writeCatalogue(
    out,
    shipped.map(([definition]) => definition),
  );
}

beforeEach(() => {
  output = mkdtempSync(join(tmpdir(), 'audiogubbins-build-'));

  // Every deployable build carries both, because GitHub Pages runs Jekyll
  // without the first, and Safari on a phone enlarges text without the rule in
  // the second; the tests that remove them are below.
  writeFileSync(join(output, '.nojekyll'), '', 'utf8');
  mkdirSync(join(output, 'assets'));
  writeFileSync(join(output, 'assets', 'index-abc.css'), `:root{--a:1}${TEXT_SIZE}`, 'utf8');
  // And every one serves the inference runtime, as its scripts state it.
  servedRuntime(output);
});

afterEach(() => {
  rmSync(output, { recursive: true, force: true });
});

/** Writes one artefact into the directory under test. */
function artefact(name: string, contents: string): void {
  const path = join(output, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

describe("the build-output gate's hold on the inference runtime (ADR-0062)", () => {
  it('passes a runtime served whole, each file the bytes a script states the digest of', () => {
    expect(problems()).toEqual([]);
  });

  it('fails a runtime file whose bytes are not the ones the build states', () => {
    const [name] = RUNTIME_WEBASSEMBLY_FILES;
    writeFileSync(join(output, RUNTIME_FOLDER, name ?? ''), new Uint8Array([9, 9, 9]));

    expect(problems()).toEqual([
      expect.objectContaining({
        file: `${RUNTIME_FOLDER}/${name ?? ''}`,
        reason: expect.stringMatching(/no script names its SHA-256/),
      }),
    ]);
  });

  it('fails a runtime missing a build, or none at all, and fails the build that made it', () => {
    const [, second] = RUNTIME_WEBASSEMBLY_FILES;
    rmSync(join(output, RUNTIME_FOLDER, second ?? ''));
    expect(problems()).toEqual([expect.objectContaining({ reason: 'is missing' })]);

    rmSync(join(output, 'inference'), { recursive: true });
    expect(problems()).toEqual([
      expect.objectContaining({ reason: 'holds no inference runtime, so no model can run' }),
    ]);
    expect(check(output).status).toBe(1);
  });

  it('passes the packs the definitions record, all of them or some, with their catalogue', async () => {
    await shippedPacks([0, 2]);
    expect(await packProblems(output, STAND_IN_DEFINITIONS)).toEqual([]);

    rmSync(join(output, 'packs'), { recursive: true });
    await shippedPacks(STAND_IN_PACKS.map((_, index) => index));
    expect(await packProblems(output, STAND_IN_DEFINITIONS)).toEqual([]);
  });

  it('fails a file beside the packs, which would be served unchecked', async () => {
    await shippedPacks([0]);
    artefact('packs/extra/1.0.0/model.onnx', 'not a pack');
    artefact('packs/notes.txt', 'not a pack');

    expect(await packProblems(output, STAND_IN_DEFINITIONS)).toEqual([
      expect.objectContaining({
        reason: 'extra/1.0.0/model.onnx is no file of a pack the definitions record',
      }),
      expect.objectContaining({ reason: 'notes.txt is no file of a pack the definitions record' }),
    ]);
  });

  it('checks no pack where a build ships none, and fails packs that are not their definitions', async () => {
    expect(await packProblems(output)).toEqual([]);
    artefact('packs/catalogue.json', '{"packs":[]}');
    expect(await packProblems(output)).toEqual([
      expect.objectContaining({
        reason: 'catalogue.json is not the catalogue of the packs the output holds',
      }),
    ]);
  });
});

describe('the build-output gate', () => {
  it('passes a build with no local path in it', () => {
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact(
      'assets/index-abc.js.map',
      JSON.stringify({ version: 3, file: 'index-abc.js', sources: ['../../src/app.tsx'] }),
    );

    expect(problems()).toEqual([]);
  });

  it('says a build it passes is free of local paths, and lets the build go on', () => {
    // A page alone, whose text names no word after a separator that any
    // account on the machine running this could be called.
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');

    const result = check(output);

    expect(result.status).toBe(0);
    expect(result.output).toContain('free of local paths and analytics hosts: 6 files');
  });

  it('fails a source map whose source is a path on the building machine', () => {
    // This is the shape the service worker's map had: the generator writes the
    // worker through a temporary directory, so the map's only source was an
    // absolute path under the building account.
    artefact(
      'sw.js.map',
      JSON.stringify({
        version: 3,
        file: 'sw.js',
        sources: ['C:/Users/someone/AppData/Local/Temp/ff17234509/sw.js'],
      }),
    );

    expect(problems()).toContainEqual({
      file: 'sw.js.map',
      field: 'sources[0]',
      path: 'C:/Users/someone/AppData/Local/Temp/ff17234509/sw.js',
    });
  });

  it('fails a POSIX home directory in a source map root', () => {
    artefact(
      'assets/index-abc.js.map',
      JSON.stringify({ version: 3, sourceRoot: '/home/builder/audiogubbins', sources: ['a.ts'] }),
    );

    expect(problems()).toContainEqual({
      file: 'assets/index-abc.js.map',
      field: 'sourceRoot',
      path: '/home/builder/audiogubbins',
    });
  });

  it('fails this machine appearing anywhere in an artefact, including inlined sources', () => {
    // How the second half of the real leak arrived: the generator inlined the
    // absolute store paths of the modules it read into `sourcesContent`, which
    // is text rather than a path field.
    artefact(
      'assets/index-abc.js.map',
      JSON.stringify({
        version: 3,
        sources: ['a.ts'],
        sourcesContent: ["import x from 'C:/Users/maker/audiogubbins/node_modules/y';"],
      }),
    );

    expect(problems()).toContainEqual({
      file: 'assets/index-abc.js.map',
      field: 'contents',
      path: 'C:/Users/maker/audiogubbins',
    });
  });

  it('reports where a leak is without reprinting the path', () => {
    artefact('found.js', `const here = '${forwardSlashes(REPOSITORY_ROOT)}';`);

    const result = check(output);

    expect(result.status).toBe(1);
    expect(result.output).toContain('found.js');
    expect(result.output).not.toContain(forwardSlashes(REPOSITORY_ROOT));
  });

  it('fails an analytics host anywhere in an artefact', () => {
    // The service worker generator depends on an analytics module whose code
    // reports to this host. It never reached a build, and this is what says so
    // on every build rather than on the word of whoever last looked.
    artefact(
      'workbox-abc.js',
      'const u="https://www.google-analytics.com/collect";self.addEventListener("fetch",f);',
    );

    expect(problems()).toContainEqual({
      file: 'workbox-abc.js',
      field: 'contents',
      host: 'www.google-analytics.com',
    });
  });

  it('does not mistake an ordinary word for an analytics host', () => {
    artefact('assets/index-abc.js', 'const segmentation="segment";const sentry=1;');

    expect(problems()).toEqual([]);
  });

  it('reports nothing in minified third-party code', () => {
    // The control that decided the design. A rule that matched path *shapes*
    // over every artefact read `https://react.dev/` as a drive path, because
    // `s:/` is one, and an escaped `\\u00C0` in a regular expression as a
    // share name. Twenty such lines against one real leak is a gate nobody
    // reads.
    artefact(
      'assets/vendor-abc.js',
      String.raw`e.createElementNS("http://www.w3.org/2000/svg",a);const r=/[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6]/g;const w="https://bit.ly/wb-precache";`,
    );
    artefact(
      'assets/vendor-abc.js.map',
      JSON.stringify({ version: 3, sources: ['webpack://react/index.js'] }),
    );

    expect(problems()).toEqual([]);
  });

  it('says so when there is no build to check', () => {
    const result = check(join(output, 'never-built'));

    expect(result.status).toBe(1);
    expect(result.output).toContain('Run the build first');
  });

  it('checks a build when it is run through a link to the folder it is in', () => {
    // A junction on Windows, and a symbolic link elsewhere; removing the
    // directory removes the link and leaves the tools it leads to.
    const tools = join(output, 'tools');
    symlinkSync(inRepository('tools'), tools, 'junction');

    const result = check(join(output, 'never-built'), join(tools, 'check-build-output.mjs'));

    expect(result.status).toBe(1);
    expect(result.output).toContain('Run the build first');
  });

  it('prints why it refuses an artefact, and the host an artefact reports to', () => {
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact('sw.js', 'self.addEventListener("fetch", () => {});');
    artefact('workbox-abc.js', 'const u="https://www.google-analytics.com/collect";');

    const result = check(output);

    expect(result.status).toBe(1);
    expect(result.output).toContain('  sw.js (name): this build ships no service worker\n');
    expect(result.output).toContain(
      '  workbox-abc.js (contents): reports to www.google-analytics.com\n',
    );
  });

  it('refuses a service worker, which this build does not ship', () => {
    // Checked where every build is checked: `pnpm build` runs this checker, and
    // a browser test in the heavy tier runs far less often than a build.
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact('sw.js', 'self.addEventListener("fetch", () => {});');

    expect(problems()).toContainEqual({
      file: 'sw.js',
      field: 'name',
      reason: 'this build ships no service worker',
    });
  });

  it('refuses a script that registers a service worker, whatever the worker is called', () => {
    // The rule read file names, so a worker called anything else, or a
    // registration inlined into the application's own bundle, passed it.
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact(
      'assets/index-abc.js',
      'navigator.serviceWorker.register("/service-worker.js", { scope: "/" });',
    );

    expect(problems()).toContainEqual({
      file: 'assets/index-abc.js',
      field: 'contents',
      reason: 'registers a service worker, which this build does not ship',
    });
  });

  it.each([
    ['optional chaining', 'navigator.serviceWorker?.register("/sw2.js");'],
    ['a quoted member', 'navigator.serviceWorker["register"](u);'],
    ['a name given the container first', 'const c=navigator.serviceWorker;c.register(u);'],
    ['a name taken apart from the navigator', 'const{serviceWorker:$w}=navigator;$w.register(u);'],
    ['Reflect.get', 'const c=Reflect.get(navigator,"serviceWorker");c.register("/sw.js");'],
    ['a quoted container', 'navigator["serviceWorker"].register(u);'],
    ['call', 'navigator.serviceWorker.register.call(navigator.serviceWorker,u);'],
    ['register taken apart', 'const{register:r}=navigator.serviceWorker;r(u);'],
  ])('refuses a registration spelt through %s', (_form, script) => {
    // The rule matched the dotted call alone, and a minifier writes the others.
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact('assets/index-abc.js', script);

    expect(problems()).toContainEqual({
      file: 'assets/index-abc.js',
      field: 'contents',
      reason: 'registers a service worker, which this build does not ship',
    });
  });

  it('passes a script that registers other things beside the probe', () => {
    // The application's own bundle registers every command, and the probe
    // reads the container, so a rule that paired the two words would refuse
    // every build.
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact(
      'assets/index-abc.js',
      'const has = "serviceWorker" in navigator; const w = navigator.serviceWorker; registry.register(command);',
    );
    artefact(
      'assets/probe-def.js',
      // A minifier gives a one-letter name to one thing and then to another:
      // here the container, and later the registry the commands go in.
      `let e=Reflect.get(navigator,\`serviceWorker\`);${'x'.repeat(500)};e=registry;e.register(command);`,
    );

    expect(problems()).toEqual([]);
  });

  it('passes a script that only asks whether service workers exist', () => {
    // The capability probe reads `navigator.serviceWorker`, and must not be
    // taken for a registration.
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact('assets/index-abc.js', 'const has = "serviceWorker" in navigator;');

    expect(problems()).toEqual([]);
  });

  it('refuses a build with no .nojekyll, which GitHub Pages would run Jekyll over', () => {
    // Jekyll drops any file or directory whose name begins with an underscore,
    // and Rollup names a shared helper chunk that way. The preview server the
    // browser suite uses serves every file whatever it is called, so the suite
    // structurally cannot see this.
    rmSync(join(output, '.nojekyll'));
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');

    expect(problems()).toContainEqual({
      file: '.nojekyll',
      field: 'name',
      reason: 'is missing, so GitHub Pages would run Jekyll over this build',
    });
  });

  it('refuses a file Jekyll would drop', () => {
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact('assets/_shared-abc.js', 'export const shared = 1;');

    expect(problems()).toContainEqual({
      file: 'assets/_shared-abc.js',
      field: 'name',
      reason: 'a name beginning with an underscore is dropped by GitHub Pages',
    });
  });

  it('refuses a stylesheet without the text-size rule Safari on a phone reads', () => {
    // What the transformer writes from a floor that names Safari on a Mac
    // alone: the prefixed form dropped, and the one Firefox reads added.
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact(
      'assets/index-abc.css',
      ':root{--a:1}html{-moz-text-size-adjust:100%;text-size-adjust:100%}',
    );

    expect(problems()).toEqual([
      {
        file: '*.css',
        field: 'contents',
        reason:
          'none declares -webkit-text-size-adjust: 100% on html, the only text-size rule Safari on a phone reads',
      },
    ]);
  });

  it.each([
    ['as the transformer writes it', TEXT_SIZE],
    ['as a person writes it', 'html {\n  -webkit-text-size-adjust: 100%;\n}'],
    ['among other selectors', ':root,html{-webkit-text-size-adjust:100%}'],
    ['inside a media query', '@media screen{html{-webkit-text-size-adjust:100%}}'],
    ['inside a media query for every medium', '@media all{html{-webkit-text-size-adjust:100%}}'],
    ['inside a cascade layer', '@layer base{html{-webkit-text-size-adjust:100%}}'],
    ['marked important', 'html{-webkit-text-size-adjust:100%!important}'],
    ['after a layer statement', '@layer a,b;html{-webkit-text-size-adjust:100%}'],
    ['after a character set', '@charset "UTF-8";html{-webkit-text-size-adjust:100%}'],
    ['after a comment kept for its licence', '/*! a licence */html{-webkit-text-size-adjust:100%}'],
  ])('reads the text-size rule %s', (_form, stylesheet) => {
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact('assets/index-abc.css', stylesheet);

    expect(problems()).toEqual([]);
  });

  it.each([
    ['on another element', 'body{-webkit-text-size-adjust:100%}'],
    ['at another size', 'html{-webkit-text-size-adjust:none}'],
    ['unprefixed alone', 'html{text-size-adjust:100%}'],
    ['in a rule nested in one for html', 'html{&.wide{-webkit-text-size-adjust:100%}}'],
    ['inside a media query for print', '@media print{html{-webkit-text-size-adjust:100%}}'],
    [
      'inside a media query of the width',
      '@media (max-width: 600px){html{-webkit-text-size-adjust:100%}}',
    ],
    [
      'inside a media query for screens of a width',
      '@media screen and (min-width: 600px){html{-webkit-text-size-adjust:100%}}',
    ],
    [
      'inside a feature query',
      '@supports not (display: grid){html{-webkit-text-size-adjust:100%}}',
    ],
    [
      'inside a container query',
      '@container (min-width: 1px){html{-webkit-text-size-adjust:100%}}',
    ],
  ])('refuses the text-size rule %s', (_form, stylesheet) => {
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact('assets/index-abc.css', stylesheet);

    expect(problems()).toContainEqual(expect.objectContaining({ file: '*.css' }));
  });

  it('passes a build whose only script is the application', () => {
    // The negative control: a name that merely contains the letters is not a
    // worker, and the rule must not refuse it.
    artefact('index.html', '<!doctype html><html lang="en-GB"><body></body></html>');
    artefact('assets/sw-theme-abc.js', 'export const theme = 1;');

    expect(problems()).toEqual([]);
  });
});
