import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { forwardSlashes, inRepository } from '../repository.js';
import {
  EVERY_WRITTEN_FILE,
  browserCompilerOptions,
  read,
  solutionProjects,
} from './source-reading.js';

/**
 * Every TSDoc link names what a reader can reach from where it is written.
 *
 * A link is read by the editor's language service, which resolves its name
 * from the scope of the declaration the comment documents, and offers the
 * declaration it finds on hover and on a click. A link that resolves to
 * nothing is a name the reader has to go looking for, and one that resolves
 * only to a global of the standard library, `length` or `name` written inside
 * an interface whose member it means, sends the reader to `window`. Neither
 * fails the compiler, so nothing else finds them. Each file is read under the
 * project that compiles it, as the language service reads it.
 */

/** Why a link reaches nothing a reader of its comment means. */
type Breakage =
  /** The language service resolves the name to nothing. */
  | 'unresolved'
  /** A bare name that resolves only to a value of the standard library. */
  | 'library-global'
  /** A `#` member, which a link cannot name. */
  | 'private-member'
  /** Broken over two lines, which leaves the comment's `*` inside the name. */
  | 'split'
  /** In a comment the parser documents nothing with, such as a union member's. */
  | 'unattached';

/** The kinds of node a link in a comment is parsed as. */
const LINK_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.JSDocLink,
  ts.SyntaxKind.JSDocLinkCode,
  ts.SyntaxKind.JSDocLinkPlain,
]);

/** A link's opening, in the text of a comment. */
const LINK_OPENING = /\{@link(?:code|plain)?\s/gu;

/** A link whose name is an address, which names no declaration. */
const ADDRESS = /^\{@link(?:code|plain)?\s+[a-z][a-z+.-]*:\/\//iu;

/** A name that a link cannot resolve: a `#` member, bare or of a class. */
const PRIVATE_NAME = /^\{@link(?:code|plain)?\s+(?:[\w$.]*\.)?#/u;

/** A symbol the standard library declares as a type, which a link may name. */
const LIBRARY_TYPE = ts.SymbolFlags.Type | ts.SymbolFlags.Namespace;

/**
 * Why a link parsed in a comment reaches nothing its reader means, or nothing
 * if it resolves.
 */
function breakageOf(
  program: ts.Program,
  file: ts.SourceFile,
  link: ts.JSDocLink | ts.JSDocLinkCode | ts.JSDocLinkPlain,
): Breakage | undefined {
  const written = file.text.slice(link.getStart(file), link.end);
  if (written.includes('\n')) return 'split';
  if (ADDRESS.test(written)) return undefined;
  if (PRIVATE_NAME.test(written)) return 'private-member';
  if (link.name === undefined) return 'unresolved';

  const checker = program.getTypeChecker();
  let symbol = checker.getSymbolAtLocation(link.name);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  // An import of a name its module lacks resolves to the checker's unknown
  // symbol, which nothing declares.
  const declarations = symbol?.declarations ?? [];
  if (symbol === undefined || declarations.length === 0) return 'unresolved';

  const onlyInTheLibrary = declarations.every((declaration) =>
    program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
  );
  return onlyInTheLibrary && ts.isIdentifier(link.name) && (symbol.flags & LIBRARY_TYPE) === 0
    ? 'library-global'
    : undefined;
}

/**
 * Every block comment in a file, by where it starts, read by the parser: a
 * `/**` in a string, a template or a regular expression is not one.
 */
function blockComments(file: ts.SourceFile): ReadonlyMap<number, number> {
  const found = new Map<number, number>();
  const take = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (range.kind === ts.SyntaxKind.MultiLineCommentTrivia) found.set(range.pos, range.end);
    }
  };
  const visit = (node: ts.Node): void => {
    take(ts.getLeadingCommentRanges(file.text, node.getFullStart()));
    take(ts.getTrailingCommentRanges(file.text, node.getEnd()));
    node.getChildren(file).forEach(visit);
  };
  visit(file);
  return found;
}

/**
 * Every link in `file` that reaches nothing its reader means, as
 * `<path>:<line> <breakage> <link>`, read with the checker of `program`, which
 * compiles it.
 */
function brokenLinksIn(program: ts.Program, file: ts.SourceFile, path: string): string[] {
  const broken: string[] = [];
  const report = (at: number, breakage: Breakage, written: string): void => {
    const line = file.getLineAndCharacterOfPosition(at).line + 1;
    broken.push(`${path}:${String(line)} ${breakage} ${written.replace(/\s+/gu, ' ')}`);
  };

  const documenting = new Set<number>();
  const visitComment = (node: ts.Node): void => {
    if (LINK_KINDS.has(node.kind)) {
      const link = node as ts.JSDocLink;
      const breakage = breakageOf(program, file, link);
      if (breakage !== undefined) {
        report(link.getStart(file), breakage, file.text.slice(link.getStart(file), link.end));
      }
      return;
    }
    ts.forEachChild(node, visitComment);
  };
  // Every comment the parser hangs on a node, which is every one before it and
  // not only the last that `getJSDocCommentsAndTags` returns: a file's opening
  // comment is parsed with its first declaration's, and its links resolve.
  const visit = (node: ts.Node): void => {
    for (const child of node.getChildren(file)) {
      if (ts.isJSDoc(child)) {
        documenting.add(child.pos);
        visitComment(child);
      } else {
        visit(child);
      }
    }
  };
  visit(file);

  // The language service resolves no link in a comment that documents nothing.
  for (const [start, end] of blockComments(file)) {
    const text = file.text.slice(start, end);
    if (!text.startsWith('/**') || documenting.has(start)) continue;
    for (const match of text.matchAll(LINK_OPENING)) {
      const close = text.indexOf('}', match.index);
      report(start + match.index, 'unattached', text.slice(match.index, close + 1));
    }
  }
  return broken;
}

/**
 * Source files, each parsed once for every project that reads it. The projects
 * overlap, every package compiling the source of those it imports, and the
 * standard library is read by all of them, so a parse kept per program would
 * read most of the tree again for each project.
 */
const PARSED = new Map<string, ts.SourceFile | undefined>();

/** A compiler host for `options` that shares {@link PARSED} with every other. */
function sharingHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const parse = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, version, ...rest) => {
    const key = `${fileName}|${JSON.stringify(version)}`;
    if (!PARSED.has(key)) PARSED.set(key, parse(fileName, version, ...rest));
    return PARSED.get(key);
  };
  return host;
}

/** A project's options and files, as the compiler reads them. */
function parsedProject(configPath: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (parsed === undefined) throw new Error(`${configPath} could not be read.`);
  return parsed;
}

/**
 * A program over `rootNames`, reading each package it imports from source.
 *
 * Without the project references, which would read a referenced package's
 * built declarations, so the rule runs on a checkout nothing has built, and
 * resolves a link to the declaration a reader opens.
 */
function programOver(rootNames: readonly string[], options: ts.CompilerOptions): ts.Program {
  const unwritten = { ...options, noEmit: true };
  return ts.createProgram({ rootNames, options: unwritten, host: sharingHost(unwritten) });
}

/**
 * Every broken link in the files a rule about how this tree is written reads.
 *
 * Each file is read under the first project the build lists that compiles it,
 * then the root's, so a package's module is read with its package's library
 * rather than a narrower scope's. A program is built only for a project that
 * compiles a file holding a link no earlier project read, and a file that no
 * project compiles is read under the widest package's options, as the editor
 * reads a file outside every project.
 */
function brokenLinksInTheTree(): string[] {
  const unread = new Map(
    EVERY_WRITTEN_FILE.filter((path) => /\.[cm]?[jt]sx?$/u.test(path))
      .filter((path) => read(path).includes('{@link'))
      .map((path) => [forwardSlashes(inRepository(path)).toLowerCase(), path] as const),
  );
  const broken: string[] = [];
  const readUnder = (program: ts.Program, owned: readonly string[]): void => {
    for (const key of owned) {
      const path = unread.get(key);
      const file = path === undefined ? undefined : program.getSourceFile(inRepository(path));
      if (path === undefined || file === undefined) continue;
      unread.delete(key);
      broken.push(...brokenLinksIn(program, file, path));
    }
  };

  const projects = solutionProjects().map((directory) => join(directory, 'tsconfig.json'));
  for (const config of [...projects, 'tsconfig.json']) {
    const project = parsedProject(inRepository(config));
    const owned = project.fileNames
      .map((name) => forwardSlashes(name).toLowerCase())
      .filter((key) => unread.has(key));
    if (owned.length > 0) readUnder(programOver(project.fileNames, project.options), owned);
  }
  const outside = [...unread.values()].map((path) => inRepository(path));
  if (outside.length > 0) {
    readUnder(programOver(outside, browserCompilerOptions()), [...unread.keys()]);
  }
  expect([...unread.values()], 'files no program read').toEqual([]);
  return broken;
}

/** Where the fixtures are: one file per breakage, and one that breaks none. */
const FIXTURES = inRepository('tests', 'architecture', 'fixtures', 'tsdoc-links');

/**
 * The broken links in a fixture, compiled on its own as a module with the
 * widest package's options, the DOM's library among them.
 *
 * A fixture is written as text, not as a module, so that the type checker, the
 * linter and this rule's reading of the tree never read the links it breaks on
 * purpose.
 */
function brokenLinksInFixture(name: string): string[] {
  const fileName = forwardSlashes(join(FIXTURES, name.replace(/\.txt$/u, '')));
  const options = browserCompilerOptions();
  const host = sharingHost(options);
  const source = ts.createSourceFile(
    fileName,
    readFileSync(join(FIXTURES, name), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (asked) => asked === fileName || fileExists(asked);
  host.getSourceFile = (asked, ...rest) =>
    asked === fileName ? source : getSourceFile(asked, ...rest);
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  return brokenLinksIn(program, source, name.replace(/\.txt$/u, ''));
}

describe('every TSDoc link names what its reader can reach', () => {
  it.each([
    ['unresolved.ts.txt', ['unresolved.ts:1 unresolved {@link nothingNamedThis}']],
    ['library-global.ts.txt', ['library-global.ts:3 library-global {@link length}']],
    [
      'private-member.ts.txt',
      [
        'private-member.ts:2 private-member {@link #position}',
        'private-member.ts:5 private-member {@link Kernel.#position}',
      ],
    ],
    ['split-across-lines.ts.txt', ['split-across-lines.ts:3 split {@link * Kernel.advance}']],
    ['unattached-comment.ts.txt', ['unattached-comment.ts:7 unattached {@link sourceOf}']],
    ['well-formed.ts.txt', []],
  ])('reads %s', (name, expected) => {
    expect(brokenLinksInFixture(name)).toEqual(expected);
  });

  it('finds none in the tree', { timeout: 60_000 }, () => {
    expect(brokenLinksInTheTree()).toEqual([]);
  });
});
