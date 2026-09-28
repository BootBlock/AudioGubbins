/**
 * Reading the repository's source as the export rules read it: each file
 * parsed, the production files listed, and the part of a declaration a
 * consumer has to know.
 *
 * Shared by the rule over each package's entry point and the rule over every
 * module's exports, which have to agree on what production code is and on
 * what an export's contract names.
 */

import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { REPOSITORY_ROOT, forwardSlashes, inRepository } from '../repository.js';
import { isBuildOutput, isTestCode, onlyForTests } from './source-kinds.js';

/** A file's text. */
export function read(path: string): string {
  return readFileSync(join(REPOSITORY_ROOT, path), 'utf8');
}

/**
 * Every file a glob names, written with forward slashes, without what a build
 * wrote.
 *
 * The one place a rule turns a glob into paths, so the three lines each rule
 * would otherwise write, and the repository root with them, cannot drift apart.
 */
export function sourcesMatching(pattern: string): readonly string[] {
  return globSync(pattern, { cwd: REPOSITORY_ROOT })
    .map((path) => forwardSlashes(path))
    .filter((path) => !isBuildOutput(path));
}

/**
 * Every production source file a glob names: no test, no benchmark and no test
 * support under `src/testing/`.
 *
 * Wider than {@link PRODUCTION_FILES} by the fixtures package, and the
 * difference is deliberate. The size and cohesion rules measure the fixtures
 * because a developer maintains them; the export rules read them as test code
 * because no user receives anything they export.
 */
export function productionSources(pattern: string): readonly string[] {
  return sourcesMatching(pattern).filter((path) => !isTestCode(path));
}

/**
 * The compiler options a rule reads the source under: the base's, with the
 * DOM and JSX the widest package compiles with, and nothing written.
 */
export function browserCompilerOptions(): ts.CompilerOptions {
  const base = ts.readConfigFile(inRepository('tsconfig.base.json'), (path) =>
    ts.sys.readFile(path),
  );
  const { options, errors } = ts.convertCompilerOptionsFromJson(
    {
      ...(base.config as { compilerOptions: object }).compilerOptions,
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      jsx: 'react-jsx',
      noEmit: true,
      composite: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      types: [],
    },
    REPOSITORY_ROOT,
  );
  if (errors.length > 0) {
    throw new Error(ts.formatDiagnostics(errors, ts.createCompilerHost(options)));
  }
  return options;
}

/**
 * Every file parsed so far. A file does not change while the rules run, and
 * the rules of one test file read the same files again and again: the export
 * rules read every production file once for each package.
 */
const PARSED = new Map<string, ts.SourceFile>();

/** A file, parsed once for every rule that reads it. */
export function parse(path: string): ts.SourceFile {
  let file = PARSED.get(path);
  if (file === undefined) {
    file = ts.createSourceFile(
      path,
      read(path),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    PARSED.set(path, file);
  }
  return file;
}

/** Every production source file, written with forward slashes. */
export const PRODUCTION_FILES: readonly string[] = sourcesMatching(
  '{apps,packages}/*/src/**/*.{ts,tsx}',
).filter((path) => !onlyForTests(path));

/**
 * Every file only a test runs: a test, a benchmark, the test support under
 * `src/testing/`, the fixtures package, and everything under `tests/`.
 *
 * Read by the module-export rule beside the production files, so that an export
 * a test support module offers and no test takes is found, such as a function
 * in `tests/e2e/platform.ts` that only its own file calls.
 */
export const TEST_CODE_FILES: readonly string[] = [
  ...sourcesMatching('{apps,packages}/*/src/**/*.{ts,tsx}').filter((path) => onlyForTests(path)),
  ...sourcesMatching('tests/**/*.{ts,tsx}'),
];

/**
 * Every file the rules about how this tree is written read: the applications'
 * and packages' source and stylesheets, everything under `tests/` and
 * `tools/`, the four configuration files at the repository root, and the web
 * application's build configuration beside them.
 *
 * Not everything anyone writes: the Rust crate, the two launchers, the workflow
 * files and the documentation are outside every glob below, and each has rules
 * of its own or none.
 *
 * For a rule that counts where something is written rather than what a module
 * imports. Such a rule has to read a `.tsx` under `tests/`, anything under
 * `tools/` and every root configuration file, all of which
 * `{apps,packages}/*\u002fsrc/**` and `tests/**\u002f*.ts` leave out.
 *
 * The root line is written `{.,}*` and names `.js`, because `globSync` matches
 * no leading dot, and without both the cruiser's own rules and the linter's
 * would be left out. A package's own configuration is a line of its own, since
 * the web application's build configuration is under no `src/` and is not at
 * the root either.
 */
export const EVERY_WRITTEN_FILE: readonly string[] = [
  ...sourcesMatching('{apps,packages}/*/src/**/*.{ts,tsx,css}'),
  ...sourcesMatching('tests/**/*.{ts,tsx}'),
  ...sourcesMatching('tools/**/*.{mjs,mts,js,ts}'),
  ...sourcesMatching('{.,}*.{ts,tsx,mjs,cjs,js}'),
  ...sourcesMatching('{apps,packages}/*/*.{ts,tsx,mjs,cjs,js}'),
];

/** The source a specifier written as `./x.js` names, as a `.ts` or a `.tsx` file, where one exists. */
export function sourceOf(module: string): string | undefined {
  return [module.replace(/\.js$/, '.ts'), module.replace(/\.js$/, '.tsx')].find((candidate) =>
    existsSync(join(REPOSITORY_ROOT, candidate)),
  );
}

/** Prints a declaration without its comments, which name what the code does not. */
const PRINTER = ts.createPrinter({ removeComments: true });

/**
 * The part of a declaration a consumer of it has to know: the whole of a type
 * or an interface, the signature of a function, the annotation of a constant,
 * and what a class extends and each member's signature, never a body or a
 * comment. Read as text, a word in a comment or a method body would reach an
 * export of that name.
 */
export function contractOf(file: ts.SourceFile, name: string): string {
  const printed = (node: ts.Node) => PRINTER.printNode(ts.EmitHint.Unspecified, node, file);
  // A parameter's type alone: its name and its default value are not what a
  // caller writes against, and a default naming an export would reach it.
  const typesOf = (parameters: ts.NodeArray<ts.ParameterDeclaration>) =>
    parameters.map((parameter) => (parameter.type === undefined ? '' : printed(parameter.type)));
  for (const statement of file.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name.text === name
    ) {
      return printed(statement);
    }
    if (ts.isClassDeclaration(statement) && statement.name?.text === name) {
      return [
        ...(statement.heritageClauses ?? []).map(printed),
        ...statement.members.map((member) =>
          ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)
            ? [
                ...typesOf(member.parameters),
                member.type === undefined ? '' : printed(member.type),
              ].join(' ')
            : printed(member),
        ),
      ].join(' ');
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return [
        ...(statement.typeParameters ?? []).map(printed),
        ...typesOf(statement.parameters),
        statement.type === undefined ? '' : printed(statement.type),
      ].join(' ');
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.name.getText(file) === name) {
          return declaration.type === undefined ? '' : printed(declaration.type);
        }
      }
    }
  }
  return '';
}

/** The names a statement declares with `export` written on it. */
export function declaredExports(statement: ts.Statement): readonly string[] {
  const exported =
    ts.canHaveModifiers(statement) &&
    ts.getModifiers(statement)?.some((one) => one.kind === ts.SyntaxKind.ExportKeyword);
  if (exported !== true) return [];
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((one) => one.name.getText());
  }
  return (ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)) &&
    statement.name !== undefined
    ? [statement.name.text]
    : [];
}
