import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPOSITORY_ROOT, forwardSlashes, inRepository } from '../repository.js';
import { browserCompilerOptions, read, sourcesMatching } from './source-reading.js';

/**
 * What every package offers, held to the record written beside this rule.
 *
 * The evidence lists the public contracts each change made, and a list written
 * by reading the diff misses a member added to an exported type, or says a
 * required member was added where none was. So the contract is read here, with
 * the compiler, from each entry point a manifest publishes: every exported
 * name, a function's signature, a constant's type, every member of an exported
 * interface or class, with whether it is optional or read-only, and the type
 * parameters of each, with what they are held to and what they default to. A
 * type of this repository that a published contract names and no entry point
 * publishes is recorded the same way, in a section of its own: what a caller
 * must supply is its business too. A change to any of them fails this rule
 * until the record is written again, and the record's diff is what the
 * evidence's line for the change is written from.
 *
 * To write the record again after a change meant to be made, run
 * `pnpm run contracts:update`.
 */

/** The record of what every package offers. */
const RECORD = 'tests/architecture/public-contracts.txt';

/** One published entry point: the specifier a consumer imports and the file it names. */
interface EntryPoint {
  readonly specifier: string;
  readonly file: string;
}

/** What a manifest's `exports` map says of one subpath. */
type ExportTarget = string | { readonly types?: string };

/**
 * Two names in the order of their code units. A locale's order differs from
 * one machine to the next, and the record has to read the same on each.
 */
function inCodeOrder(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

/** The specifier a consumer writes for one subpath of a manifest's `exports` map. */
function specifierOf(name: string, subpath: string): string {
  return subpath === '.' ? name : `${name}/${subpath.slice(2)}`;
}

/** Every package's manifest, with where it lives. */
const MANIFESTS = sourcesMatching('packages/*/package.json').map((path) => ({
  directory: dirname(path),
  manifest: JSON.parse(read(path)) as {
    readonly name: string;
    readonly exports: Readonly<Record<string, ExportTarget>>;
  },
}));

/** Each subpath a manifest publishes, TypeScript or not, as a consumer writes it. */
const PUBLISHED_PATHS: readonly string[] = MANIFESTS.flatMap(({ manifest }) =>
  Object.keys(manifest.exports).map((subpath) => specifierOf(manifest.name, subpath)),
).toSorted();

/** Each entry point whose types a consumer compiles against. */
const ENTRY_POINTS: readonly EntryPoint[] = MANIFESTS.flatMap(({ directory, manifest }) =>
  Object.entries(manifest.exports).flatMap(([subpath, target]) => {
    const types = typeof target === 'string' ? target : target.types;
    if (types === undefined || !/\.tsx?$/.test(types)) return [];
    return [
      {
        specifier: specifierOf(manifest.name, subpath),
        file: forwardSlashes(join(directory, types)),
      },
    ];
  }),
).toSorted((one, other) => inCodeOrder(one.specifier, other.specifier));

/** Every entry point, compiled once for the rules below. */
const PROGRAM = ts.createProgram(
  ENTRY_POINTS.map((entry) => inRepository(entry.file)),
  browserCompilerOptions(),
);

/** How a type is written in the record: whole, and never cut short. */
const WRITTEN = ts.TypeFormatFlags.NoTruncation;

/** The kinds of declaration a type is written by name for, and recorded under. */
const NAMED =
  ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Enum;

/** Whether a declaration is a dependency's, rather than this repository's. */
function fromADependency(declaration: ts.Declaration): boolean {
  return declaration.getSourceFile().fileName.includes('/node_modules/');
}

/**
 * The members a package declares itself. A member an interface inherits from a
 * dependency, such as each of the hundreds a button's props take from React, is
 * that dependency's contract, and its line would change with the dependency's
 * version; the `extends` line names where it comes from.
 */
function declaredHere(member: ts.Symbol): boolean {
  return (member.declarations ?? []).some((declaration) => !fromADependency(declaration));
}

/** Whether a type the record names is one this repository declares. */
function firstParty(symbol: ts.Symbol): boolean {
  const declarations = symbol.declarations ?? [];
  return declarations.length > 0 && !declarations.some(fromADependency);
}

/** A type as the record wrote it, and where it was written from. */
interface Written {
  readonly text: string;
  readonly at: ts.Node;
}

/**
 * A type's text with the members of every union in it in the order of their
 * code units, each member's own unions first.
 *
 * The compiler writes a union in the order its members were created, which is
 * wherever in the program each was first met: a literal met first in another
 * package, an import reordered or a rule run on its own changes the order of
 * published lines in other packages while no contract has changed. The order of
 * a union's members is no part of what it offers, so the record writes it in an
 * order the contracts alone decide.
 */
function inOrderOfMembers(text: string): string {
  const prefix = 'type Written = ';
  const file = ts.createSourceFile('written.ts', `${prefix}${text};`, ts.ScriptTarget.Latest);
  const [statement] = file.statements;
  if (statement === undefined || !ts.isTypeAliasDeclaration(statement)) {
    throw new Error(`The compiler wrote a type the record cannot read: ${text}`);
  }

  const write = (node: ts.Node): string => {
    if (ts.isUnionTypeNode(node)) return node.types.map(write).toSorted(inCodeOrder).join(' | ');
    let written = '';
    let from = node.getStart(file);
    ts.forEachChild(node, (child) => {
      written += file.text.slice(from, child.getStart(file)) + write(child);
      from = child.getEnd();
    });
    return written + file.text.slice(from, node.getEnd());
  };
  return write(statement.type);
}

/** Writes types for the record, and keeps each, so the names it wrote can be read. */
class Recorder {
  readonly checker: ts.TypeChecker;
  readonly #written: Written[] = [];

  constructor(checker: ts.TypeChecker) {
    this.checker = checker;
  }

  /** Every type written so far, in the order it was written. */
  get written(): readonly Written[] {
    return this.#written;
  }

  /** A type as the record writes it, as the right side of a type alias where `inAlias` says so. */
  text(type: ts.Type, at: ts.Node, inAlias = false): string {
    const flags = inAlias ? WRITTEN | ts.TypeFormatFlags.InTypeAlias : WRITTEN;
    const text = inOrderOfMembers(this.checker.typeToString(type, at, flags));
    this.#written.push({ text, at });
    return text;
  }
}

/** A type the compiler writes as an import of a file, and the name it takes from it. */
const IMPORTED = /import\("([^"]+)"\)\.([\w$]+)/gu;

/** A string literal type, whose words name nothing. */
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"/gu;

/** A name a type is written with: not a member after a dot, and not a key before its colon. */
const TYPE_NAME = /(?<![\w$.])[A-Za-z_$][\w$]*(?![\w$])(?!\??:)/gu;

/**
 * The named types of this repository that the written types name. A name is
 * looked up in the file its text was written from, as the compiler wrote it
 * there, and a name the compiler wrote as an import of a file is looked up in
 * that file's exports. Read from the text rather than from the types: a union
 * the compiler builds from an intersection keeps the name it was written with
 * only in how it is written.
 */
function namedIn(checker: ts.TypeChecker, written: readonly Written[]): ReadonlySet<ts.Symbol> {
  const named = new Set<ts.Symbol>();
  const scopes = new Map<ts.SourceFile, ReadonlyMap<string, ts.Symbol>>();
  const keep = (symbol: ts.Symbol | undefined): void => {
    // A declaration its file exports is in scope there as a local that
    // stands for the export.
    const target =
      symbol === undefined ? undefined : resolved(checker, checker.getExportSymbolOfSymbol(symbol));
    if (target !== undefined && (target.flags & NAMED) !== 0 && firstParty(target)) {
      named.add(target);
    }
  };

  for (const { text, at } of written) {
    for (const [, path, name] of text.matchAll(IMPORTED)) {
      const file = path === undefined ? undefined : PROGRAM.getSourceFile(path);
      const module = file === undefined ? undefined : checker.getSymbolAtLocation(file);
      const exports = module === undefined ? [] : checker.getExportsOfModule(module);
      keep(exports.find((one) => one.name === name));
    }

    const file = at.getSourceFile();
    const scope =
      scopes.get(file) ??
      new Map(
        checker
          .getSymbolsInScope(file, ts.SymbolFlags.Type | ts.SymbolFlags.Alias)
          .map((one) => [one.name, one]),
      );
    scopes.set(file, scope);
    const bare = text.replaceAll(IMPORTED, '').replaceAll(STRING_LITERAL, '""');
    for (const [name] of bare.matchAll(TYPE_NAME)) keep(scope.get(name));
  }
  return named;
}

/** What an interface or a class extends, as its line in the record. */
function extendsLine(recorder: Recorder, type: ts.Type, at: ts.Node): string {
  const bases = (type.isClassOrInterface() ? recorder.checker.getBaseTypes(type) : []).map((one) =>
    recorder.text(one, at),
  );
  return bases.length > 0 ? ` extends ${bases.join(', ')}` : '';
}

/**
 * Type parameters as the record writes them: each name, what it is held to,
 * and what it defaults to, since a constraint or a default added to one
 * changes what a caller may give it.
 */
function typeParameterList(
  recorder: Recorder,
  parameters: readonly ts.TypeParameter[],
  at: ts.Node,
): string {
  const written = parameters.map((one) => {
    const constraint = one.getConstraint();
    const fallback = recorder.checker.getDefaultFromTypeParameter(one);
    return [
      recorder.text(one, at),
      constraint === undefined ? '' : ` extends ${recorder.text(constraint, at)}`,
      fallback === undefined ? '' : ` = ${recorder.text(fallback, at)}`,
    ].join('');
  });
  return written.length > 0 ? `<${written.join(', ')}>` : '';
}

/** The type parameters a type alias is declared with. */
function aliasParameters(checker: ts.TypeChecker, declaration: ts.Declaration): ts.TypeParameter[] {
  return ts.isTypeAliasDeclaration(declaration)
    ? (declaration.typeParameters ?? [])
        .map((one) => checker.getTypeAtLocation(one))
        .filter((one) => one.isTypeParameter())
    : [];
}

/**
 * A type the compiler writes as an import of a file, written from the
 * repository's root. The compiler writes where the file is on this machine,
 * which no record can hold.
 */
function fromTheRoot(text: string): string {
  return text.replace(/import\("([^"]+)"\)/g, (_, path: string) => {
    const inside = forwardSlashes(relative(REPOSITORY_ROOT, path));
    const dependency =
      /(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(inside);
    return `import("${dependency?.[1] ?? inside}")`;
  });
}

/**
 * A signature as the record writes it: its type parameters, each parameter's
 * name, whether it may be left out, and its type, and what it returns. A
 * parameter written as a pattern is `props`, since which names a function
 * takes out of it is its body's business, not its caller's.
 */
function signatureText(recorder: Recorder, signature: ts.Signature, at: ts.Node): string {
  const { checker } = recorder;
  const generic = typeParameterList(recorder, signature.getTypeParameters() ?? [], at);
  const parameters = signature.getParameters().map((parameter) => {
    const [declaration] = parameter.declarations ?? [];
    const written =
      declaration !== undefined && ts.isParameter(declaration) ? declaration : undefined;
    const name = written !== undefined && !ts.isIdentifier(written.name) ? 'props' : parameter.name;
    const rest = written?.dotDotDotToken !== undefined ? '...' : '';
    const optional =
      written !== undefined && rest === '' && checker.isOptionalParameter(written) ? '?' : '';
    const type = recorder.text(checker.getTypeOfSymbolAtLocation(parameter, at), at);
    return `${rest}${name}${optional}: ${type}`;
  });
  const returned = recorder.text(checker.getReturnTypeOfSignature(signature), at);
  return `${generic}(${parameters.join(', ')}): ${returned}`;
}

/** Whether a member is declared read-only. */
function readOnly(member: ts.Symbol): boolean {
  return (member.declarations ?? []).some(
    (declaration) => (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0,
  );
}

/** A member of an interface, a class or an object type, as the record writes it. */
function memberLine(recorder: Recorder, owner: string, member: ts.Symbol, at: ts.Node): string {
  const optional = (member.flags & ts.SymbolFlags.Optional) !== 0 ? '?' : '';
  const type = recorder.text(recorder.checker.getTypeOfSymbolAtLocation(member, at), at);
  return `  ${readOnly(member) ? 'readonly ' : ''}${owner}.${member.name}${optional}: ${type}`;
}

/** The symbol an exported name stands for. */
function resolved(checker: ts.TypeChecker, exported: ts.Symbol): ts.Symbol {
  return (exported.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(exported)
    : exported;
}

/** Every line one declared name contributes: what it is, then each of its members. */
function linesOf(recorder: Recorder, name: string, symbol: ts.Symbol): readonly string[] {
  const { checker } = recorder;
  const [declaration] = symbol.declarations ?? [];
  if (declaration === undefined) return [`  ${name}: (no declaration)`];
  const lines: string[] = [];

  if ((symbol.flags & ts.SymbolFlags.Function) !== 0) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    for (const signature of type.getCallSignatures()) {
      lines.push(`  function ${name}${signatureText(recorder, signature, declaration)}`);
    }
  }
  if ((symbol.flags & ts.SymbolFlags.Variable) !== 0) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    lines.push(`  const ${name}: ${recorder.text(type, declaration)}`);
  }
  if ((symbol.flags & ts.SymbolFlags.Class) !== 0) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const instance = checker.getDeclaredTypeOfSymbol(symbol);
    const parameters = (instance as ts.InterfaceType).typeParameters ?? [];
    lines.push(
      `  class ${name}${typeParameterList(recorder, parameters, declaration)}${extendsLine(recorder, instance, declaration)}`,
    );
    for (const signature of type.getConstructSignatures()) {
      lines.push(`  new ${name}${signatureText(recorder, signature, declaration)}`);
    }
    for (const member of checker.getPropertiesOfType(instance).filter(declaredHere)) {
      lines.push(memberLine(recorder, name, member, declaration));
    }
  }
  if ((symbol.flags & ts.SymbolFlags.Interface) !== 0) {
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    const parameters = (type as ts.InterfaceType).typeParameters ?? [];
    lines.push(
      `  interface ${name}${typeParameterList(recorder, parameters, declaration)}${extendsLine(recorder, type, declaration)}`,
    );
    for (const signature of type.getCallSignatures()) {
      lines.push(`  ${name}${signatureText(recorder, signature, declaration)}`);
    }
    for (const index of checker.getIndexInfosOfType(type)) {
      const key = recorder.text(index.keyType, declaration);
      const value = recorder.text(index.type, declaration);
      lines.push(`  ${index.isReadonly ? 'readonly ' : ''}${name}[key: ${key}]: ${value}`);
    }
    for (const member of checker.getPropertiesOfType(type).filter(declaredHere)) {
      lines.push(memberLine(recorder, name, member, declaration));
    }
  }
  if ((symbol.flags & ts.SymbolFlags.TypeAlias) !== 0) {
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    const parameters = typeParameterList(
      recorder,
      aliasParameters(checker, declaration),
      declaration,
    );
    lines.push(`  type ${name}${parameters} = ${recorder.text(type, declaration, true)}`);
  }
  if ((symbol.flags & ts.SymbolFlags.Enum) !== 0) {
    lines.push(`  enum ${name}`);
    for (const member of checker.getExportsOfModule(symbol)) {
      const [memberDeclaration] = member.declarations ?? [];
      const value =
        memberDeclaration !== undefined && ts.isEnumMember(memberDeclaration)
          ? checker.getConstantValue(memberDeclaration)
          : undefined;
      lines.push(`  ${name}.${member.name} = ${JSON.stringify(value)}`);
    }
  }
  return lines.length > 0 ? lines : [`  ${name}: (not read)`];
}

/** The file a symbol is declared in, from the repository's root. */
function declaredIn(symbol: ts.Symbol): string {
  const [declaration] = symbol.declarations ?? [];
  return declaration === undefined
    ? '(no declaration)'
    : forwardSlashes(relative(REPOSITORY_ROOT, declaration.getSourceFile().fileName));
}

/**
 * The types of this repository a published contract names and no entry point
 * publishes, each with its lines, under the file that declares it. Each is
 * read for the types it names in turn, until nothing new is named.
 */
function unpublishedSection(recorder: Recorder, published: ReadonlySet<ts.Symbol>): string {
  const recorded = new Map<ts.Symbol, readonly string[]>();
  for (let from = 0; from < recorder.written.length;) {
    const to = recorder.written.length;
    const waiting = [...namedIn(recorder.checker, recorder.written.slice(from, to))].filter(
      (one) => !published.has(one) && !recorded.has(one),
    );
    from = to;
    for (const symbol of waiting) recorded.set(symbol, linesOf(recorder, symbol.name, symbol));
  }

  const byFile = new Map<string, { name: string; lines: readonly string[] }[]>();
  for (const [symbol, lines] of recorded) {
    const file = declaredIn(symbol);
    byFile.set(file, [...(byFile.get(file) ?? []), { name: symbol.name, lines }]);
  }
  return [...byFile.keys()]
    .toSorted(inCodeOrder)
    .map((file) =>
      [
        file,
        ...(byFile.get(file) ?? [])
          .toSorted((one, other) => inCodeOrder(one.name, other.name))
          .flatMap((one) => one.lines),
      ].join('\n'),
    )
    .join('\n\n');
}

/** The record as it would be written from the tree as it stands. */
function recordOfTheTree(): string {
  const checker = PROGRAM.getTypeChecker();
  const recorder = new Recorder(checker);
  const published = new Set<ts.Symbol>();
  const sections = ENTRY_POINTS.map((entry) => {
    const source = PROGRAM.getSourceFile(inRepository(entry.file));
    const module = source === undefined ? undefined : checker.getSymbolAtLocation(source);
    if (module === undefined) return `${entry.specifier}\n  (no module)`;
    const exports = checker
      .getExportsOfModule(module)
      .toSorted((one, other) => inCodeOrder(one.name, other.name));
    for (const one of exports) published.add(resolved(checker, one));
    return [
      entry.specifier,
      ...exports.flatMap((one) => linesOf(recorder, one.name, resolved(checker, one))),
    ].join('\n');
  });
  return `${[
    'Published paths',
    ...PUBLISHED_PATHS.map((path) => `  ${path}`),
    '',
    sections.join('\n\n'),
    '',
    'Named by a published contract, and published by no entry point',
    '',
    unpublishedSection(recorder, published),
  ]
    .join('\n')
    .replace(/[^\n]+/g, fromTheRoot)}\n`;
}

describe('public contracts', () => {
  it('finds an entry point in every package, and the record written', () => {
    expect(ENTRY_POINTS.length).toBeGreaterThanOrEqual(MANIFESTS.length);
    expect(existsSync(inRepository(RECORD)), `${RECORD} is missing`).toBe(true);
  });

  it('compiles every entry point without an error, so no type in the record is read as any', () => {
    // A type the compiler cannot resolve is written as `any`, and the record
    // would then hold `any` where the contract has a type.
    const diagnostics = ts.getPreEmitDiagnostics(PROGRAM);
    expect(
      ts.formatDiagnostics(diagnostics, ts.createCompilerHost(PROGRAM.getCompilerOptions())),
    ).toBe('');
  });

  it('offers exactly what the record of every package says', async () => {
    const record = recordOfTheTree();
    expect(record, 'a type the record names is written where it is on this machine').not.toMatch(
      /[A-Za-z]:[\\/]|\/(?:home|Users)\//,
    );
    await expect(record).toMatchFileSnapshot(inRepository(RECORD));
  });
});
