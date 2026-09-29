/**
 * The rules that hold each module to the global scope it runs in.
 *
 * The engine and the packages under it run in an AudioWorklet, a worker and a
 * test alike (ADR-0030), and the processor and the render worker each in a
 * scope of their own. A project compiled with the DOM's definitions, or with
 * Node's, which load unasked wherever `types` is not set, would let such a
 * module call what its scope lacks, `setTimeout` or `performance` on the audio
 * thread, and fail only when it ran there. So each is compiled again, by a
 * project under the package's `scopes/`, with its scope's definitions alone,
 * and these rules hold those projects to that: what they compile, what they
 * compile it with, and that the build runs them.
 */

import { basename } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { forwardSlashes, inRepository } from '../repository.js';
import { productionSources, read, sourcesMatching } from './source-reading.js';

/** The packages that run in any scope: the engine, and what it is built on. */
const PORTABLE = ['packages/domain', 'packages/audio-graph', 'packages/audio-engine'];

/** The library each thread entry's scope is compiled with, by entry. */
const THREAD_SCOPES: Readonly<Record<string, { readonly scope: string; readonly lib: string[] }>> =
  {
    'packages/audio-runtime/src/threads/engine-processor.ts': {
      scope: 'audio-worklet',
      lib: ['lib.es2023.d.ts'],
    },
    'packages/audio-runtime/src/threads/feeder-worker.ts': {
      scope: 'dedicated-worker',
      lib: ['lib.es2023.d.ts', 'lib.webworker.d.ts'],
    },
    'packages/audio-runtime/src/threads/render-worker.ts': {
      scope: 'dedicated-worker',
      lib: ['lib.es2023.d.ts', 'lib.webworker.d.ts'],
    },
  };

/** A project as the compiler reads it: its options, and its files from the repository's root. */
function project(directory: string): {
  readonly options: ts.CompilerOptions;
  readonly files: readonly string[];
} {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    inRepository(directory, 'tsconfig.json'),
    undefined,
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (parsed === undefined) throw new Error(`${directory} has no project.`);
  expect(parsed.errors).toEqual([]);
  const prefix = `${forwardSlashes(inRepository())}/`;
  return {
    options: parsed.options,
    files: parsed.fileNames.map((path) => forwardSlashes(path).replace(prefix, '')).sort(),
  };
}

/** The projects the build's solution file runs, by directory. */
function solutionProjects(): readonly string[] {
  const solution = JSON.parse(read('tsconfig.build.json')) as {
    readonly references: readonly { readonly path: string }[];
  };
  return solution.references.map(({ path }) => path.replace(/^\.\//u, ''));
}

/** The library files a project's options name, by file name alone. */
function librariesOf(options: ts.CompilerOptions): readonly string[] {
  return (options.lib ?? []).map((library) => basename(library));
}

/**
 * The codes of the errors that compiling `code` in a project gives, with the
 * declarations the project adds to its scope.
 */
function compileErrors(
  { options, files }: ReturnType<typeof project>,
  code: string,
): readonly number[] {
  const name = inRepository('scope-probe.ts');
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, language, ...rest) =>
    forwardSlashes(file) === forwardSlashes(name)
      ? ts.createSourceFile(file, code, language)
      : getSourceFile(file, language, ...rest);
  const declarations = files
    .filter((file) => file.endsWith('.d.ts'))
    .map((file) => inRepository(file));
  const program = ts.createProgram({
    rootNames: [name, ...declarations],
    options: { ...options, noEmit: true },
    host,
  });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => diagnostic.code);
}

describe('the scope each module runs in', () => {
  it.each(PORTABLE)('compiles every production module of %s with no host’s globals', (dir) => {
    const scope = project(`${dir}/scopes/any`);

    expect(scope.options.types).toEqual([]);
    expect(librariesOf(scope.options)).toEqual(['lib.es2023.d.ts']);
    expect(scope.files).toEqual([...productionSources(`${dir}/src/**/*.ts`)].sort());
    expect(solutionProjects()).toContain(`${dir}/scopes/any`);
  });

  it.each(Object.entries(THREAD_SCOPES))(
    'compiles %s with its own scope’s definitions alone',
    (entry, { scope, lib }) => {
      const directory = entry.replace(/\/src\/threads\/.*$/u, `/scopes/${scope}`);
      const compiled = project(directory);

      expect(compiled.options.types).toEqual([]);
      expect(librariesOf(compiled.options)).toEqual(lib);
      expect(compiled.files).toContain(entry);
      expect(solutionProjects()).toContain(directory);
    },
  );

  it('holds every thread entry to a scope', () => {
    const entries = sourcesMatching('packages/*/src/threads/*.ts').filter(
      (path) => !path.endsWith('.test.ts'),
    );

    expect(entries.sort()).toEqual(Object.keys(THREAD_SCOPES).sort());
  });

  it('refuses, in a portable package’s scope, the globals no audio thread has', () => {
    const scope = project('packages/audio-engine/scopes/any');

    // TS2304 and its variants that suggest a library: the name is not there.
    const missing = [2304, 2580, 2584, 2591];
    for (const name of [
      'setTimeout',
      'AbortSignal',
      'performance',
      'fetch',
      'process',
      'console',
    ]) {
      expect(compileErrors(scope, `export const probe = ${name};\n`), name).toEqual([
        expect.toBeOneOf(missing),
      ]);
    }
    expect(compileErrors(scope, 'export const probe = Math.fround(0.1);\n')).toEqual([]);
  });

  it('refuses, in the audio worklet’s scope, what the scope lacks', () => {
    const scope = project('packages/audio-runtime/scopes/audio-worklet');

    for (const name of ['setTimeout', 'TextDecoder', 'performance', 'self']) {
      expect(compileErrors(scope, `export const probe = ${name};\n`), name).not.toEqual([]);
    }
    // What the scope does have, as its declarations give it.
    const compiling =
      'export const probe = (bytes: ArrayBuffer) => new WebAssembly.Module(bytes);\n';
    expect(compileErrors(scope, compiling)).toEqual([]);
  });
});
