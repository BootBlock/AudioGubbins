/**
 * Where code uses what the compiler's library declares above the browser
 * floor, read with the compiler.
 *
 * The ES2023 library the build compiles with is wider than the floor it
 * targets (see `apps/web/vite.config.ts`). It declares the segmenter, which
 * Firefox shipped in 125, and the later members of `Intl.NumberFormat`, which
 * it shipped in 116, and the compiler accepts a use of either anywhere. A use
 * is read by the declaration it resolves to rather than by its spelling:
 * `Intl['Segmenter']`, a segmenter taken apart from `Intl`, and an option
 * named in the object a number format is given are all read, and the date
 * format's own `formatRange`, which is inside the floor, is not. A member the
 * later library declares again beside an earlier declaration, such as
 * `format`, is inside the floor by the earlier one.
 *
 * Not read: a member named by text computed as the code runs; a string value
 * the later number format adds to an option it already had, such as
 * `useGrouping: 'min2'`, which resolves to no declaration; symbols as weak
 * keys, which the later library allows in a type and no use spells; and the
 * DOM library, which declares every interface whatever a browser's version.
 */

import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** The library file that declares the later number format members. */
const LATER_NUMBER_FORMAT = 'lib.es2023.intl.d.ts';

/** The library file that declares the segmenter. */
const SEGMENTER_LIBRARY = 'lib.es2022.intl.d.ts';

/** What a use above the floor is a use of. */
export const AboveTheFloor = {
  Segmenter: 'the segmenter',
  LaterNumberFormat: 'a later number format member',
} as const;
export type AboveTheFloor = (typeof AboveTheFloor)[keyof typeof AboveTheFloor];

/** One use of what the library declares above the floor. */
export interface FloorUse {
  readonly path: string;
  readonly line: number;
  readonly of: AboveTheFloor;

  /** Whether it is a type, which the compiler erases and no browser runs. */
  readonly inAType: boolean;

  /**
   * Whether it runs only where the browser has it: as what `typeof` asks of,
   * or after a statement that returns when `typeof Intl.Segmenter` is not a
   * function.
   */
  readonly guarded: boolean;
}

/** The file name of a declaration's file, without its directory. */
function libraryOf(declaration: ts.Declaration): string {
  const file = declaration.getSourceFile().fileName;
  return file.slice(file.lastIndexOf('/') + 1);
}

/**
 * Every name the later library declares, read from the library itself, so a
 * name is looked up with the compiler only where it could be one of them.
 */
function namesDeclaredIn(library: string): ReadonlySet<string> {
  const file = ts.createSourceFile(
    library,
    readFileSync(`${ts.getDefaultLibFilePath({}).replace(/[^/\\]+$/u, '')}${library}`, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const name = ts.isParameter(node) ? undefined : ts.getNameOfDeclaration(node as ts.Declaration);
    if (name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
      names.add(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** The names a use above the floor can be written with. */
const WATCHED: ReadonlySet<string> = new Set([
  ...namesDeclaredIn(LATER_NUMBER_FORMAT),
  'Segmenter',
]);

/** What a symbol is above the floor, or `undefined` where some declaration of it is inside it. */
function aboveTheFloor(symbol: ts.Symbol | undefined): AboveTheFloor | undefined {
  const declarations = symbol?.declarations ?? [];
  if (declarations.length === 0) return undefined;
  if (declarations.every((one) => libraryOf(one) === LATER_NUMBER_FORMAT)) {
    return AboveTheFloor.LaterNumberFormat;
  }
  if (
    symbol?.name === 'Segmenter' &&
    declarations.every((one) => libraryOf(one) === SEGMENTER_LIBRARY)
  ) {
    return AboveTheFloor.Segmenter;
  }
  return undefined;
}

/** The property a name in an object literal or a binding pattern stands for, from the type it is read against. */
function propertyNamed(
  checker: ts.TypeChecker,
  name: ts.Identifier | ts.StringLiteral,
): ts.Symbol | undefined {
  const holder = name.parent;
  if (
    (ts.isPropertyAssignment(holder) || ts.isShorthandPropertyAssignment(holder)) &&
    holder.name === name &&
    ts.isObjectLiteralExpression(holder.parent)
  ) {
    const type = checker.getContextualType(holder.parent);
    return type === undefined ? undefined : checker.getPropertyOfType(type, name.text);
  }
  if (
    ts.isBindingElement(holder) &&
    (holder.propertyName ?? holder.name) === name &&
    ts.isObjectBindingPattern(holder.parent)
  ) {
    return checker.getPropertyOfType(checker.getTypeAtLocation(holder.parent), name.text);
  }
  return undefined;
}

/** Whether a node is part of a type, which the compiler erases. */
function inAType(node: ts.Node): boolean {
  for (let at = node.parent; !ts.isSourceFile(at); at = at.parent) {
    if (ts.isTypeNode(at) && !ts.isExpressionWithTypeArguments(at)) return true;
    if (ts.isStatement(at)) return false;
  }
  return false;
}

/** Whether `node` is `typeof Intl.Segmenter !== 'function'`. */
function asksForTheSegmenter(node: ts.Expression): boolean {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    ts.isTypeOfExpression(node.left) &&
    ts.isPropertyAccessExpression(node.left.expression) &&
    ts.isIdentifier(node.left.expression.expression) &&
    node.left.expression.expression.text === 'Intl' &&
    node.left.expression.name.text === 'Segmenter' &&
    ts.isStringLiteral(node.right) &&
    node.right.text === 'function'
  );
}

/** Whether a statement always returns: a return, or a block whose last statement is one. */
function returns(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  const last = ts.isBlock(statement) ? statement.statements.at(-1) : undefined;
  return last !== undefined && returns(last);
}

/**
 * Whether a use runs only where the browser has the segmenter: it is what
 * `typeof` asks of, or an earlier statement of a block it is in returns when
 * the segmenter is not a function.
 */
function guarded(node: ts.Node): boolean {
  if (ts.isTypeOfExpression(node.parent) || ts.isTypeOfExpression(node.parent.parent)) {
    return true;
  }
  for (let at: ts.Node = node; !ts.isSourceFile(at); at = at.parent) {
    const block = at.parent;
    if (!ts.isBlock(block) || !ts.isStatement(at)) continue;
    const before = block.statements.slice(0, block.statements.indexOf(at));
    if (
      before.some(
        (one) =>
          ts.isIfStatement(one) &&
          asksForTheSegmenter(one.expression) &&
          returns(one.thenStatement),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** The uses above the floor in the files named, read with the program's checker. */
export function usesAboveTheFloor(
  program: ts.Program,
  files: readonly { readonly path: string; readonly source: ts.SourceFile }[],
): readonly FloorUse[] {
  const checker = program.getTypeChecker();
  const uses: FloorUse[] = [];

  for (const { path, source } of files) {
    if (![...WATCHED].some((name) => source.text.includes(name))) continue;
    const visit = (node: ts.Node): void => {
      if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && WATCHED.has(node.text)) {
        const of = aboveTheFloor(propertyNamed(checker, node) ?? checker.getSymbolAtLocation(node));
        if (of !== undefined) {
          uses.push({
            path,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            of,
            inAType: inAType(node),
            guarded: guarded(node),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return uses;
}

/**
 * The uses the floor refuses: every use of a later number format member, and
 * every segmenter no check guards, where each runs rather than being a type.
 */
export function refusedUses(uses: readonly FloorUse[]): readonly FloorUse[] {
  return uses.filter(
    (one) => !one.inAType && (one.of === AboveTheFloor.LaterNumberFormat || !one.guarded),
  );
}

/** The options a snippet is compiled with: the ES2023 library, and nothing else. */
const SNIPPET_OPTIONS: ts.CompilerOptions = {
  lib: ['lib.es2023.d.ts'],
  target: ts.ScriptTarget.ES2022,
  types: [],
  noEmit: true,
};

/** The host a snippet's library is read from. */
const SNIPPET_HOST = ts.createCompilerHost(SNIPPET_OPTIONS);

/**
 * The library files a snippet is compiled against, each parsed by the first
 * snippet that reads it and kept for the rest: the library does not change,
 * and parsing its fifty files again is most of the time a snippet takes.
 */
const LIBRARY_FILES = new Map<string, ts.SourceFile | undefined>();

/** The uses above the floor in `code`, compiled on its own with the ES2023 library. */
export function usesAboveTheFloorIn(code: string): readonly FloorUse[] {
  const fileName = 'module.ts';
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const program = ts.createProgram({
    rootNames: [fileName],
    options: SNIPPET_OPTIONS,
    host: {
      ...SNIPPET_HOST,
      getSourceFile: (asked, version) => {
        if (asked === fileName) return source;
        if (!LIBRARY_FILES.has(asked)) {
          LIBRARY_FILES.set(asked, SNIPPET_HOST.getSourceFile(asked, version));
        }
        return LIBRARY_FILES.get(asked);
      },
      fileExists: (asked) => asked === fileName || SNIPPET_HOST.fileExists(asked),
    },
  });
  return usesAboveTheFloor(program, [{ path: fileName, source }]);
}
