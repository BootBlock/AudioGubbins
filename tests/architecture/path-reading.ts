/**
 * What a file does with paths, read from its syntax rather than its spelling.
 *
 * The one-place rule asks three things of every file under `tests/`: whether
 * it turns a glob into paths, whether it finds the repository's root for
 * itself, and whether it turns a path's backslashes into forward slashes. A
 * pattern over the text would pass the forms nobody wrote it for, such as a
 * regular expression with a quantifier, one built with `RegExp`, and `resolve`
 * given a relative path, imported under another name or taken from `require`,
 * and would have to leave the rule's own file out by name, because that file
 * writes every form to test it. Here the compiler reads the file. Its checker
 * says which declaration a name refers to, so an alias is followed to the
 * module it came from and a promise's own `resolve` is told from the path
 * module's; a constant is followed to the value it holds; a regular expression
 * is compiled and asked whether it matches a backslash; and a form written as
 * test data is text, not a call.
 *
 * What turns a glob into paths: `glob` or `globSync` of Node's file-system
 * module, the only glob this repository has.
 *
 * What reaches the root: `import.meta`, CommonJS's `__dirname` and
 * `__filename`, the process's `cwd`, the working directory npm and the shell
 * leave in its environment (`INIT_CWD` and `PWD`), and the path module's
 * `resolve` given nothing, or only relative paths whose text is known before
 * the code runs.
 *
 * What rewrites: `replace` or `replaceAll` of something that matches a
 * backslash by a forward slash, a split on one joined with a forward slash, and
 * a split on one spread into the POSIX `join`. A backslash is text holding one,
 * a regular expression that matches one, or the separator of the path module or
 * its Windows half; a forward slash is the text `/` or the POSIX separator.
 *
 * Each module is reached by an import of any kind, `require`, `import()`, a
 * member of the module or of one of its halves, and a name taken apart from
 * it, under any name; the process is a global as well, reached by its name
 * or as a member of `globalThis`, and its environment is one of its halves.
 * A member is read written as a name or as a string in brackets. Not read: a
 * value computed as the code runs, which no reading of the text can know; a
 * replacement written as a function; and a relative path handed to a
 * file-system call, which Node resolves against the working directory
 * without naming it.
 */

import { posix, win32 } from 'node:path';
import ts from 'typescript';

/** How far a name is followed to what it was declared as, which ends a cycle. */
const DEEPEST = 8;

/**
 * A Node module these rules read, and for the path module, which half. The
 * process's environment is read as a module of its own, a half of the
 * process, so a variable is a member of it.
 */
interface NodeModule {
  readonly module: 'path' | 'fs' | 'process' | 'environment';

  /** Whether it is the POSIX half of the path module, whose separator is a forward slash. */
  readonly posix: boolean;
}

/** The names the modules are imported by. */
const NODE_MODULES: ReadonlyMap<string, NodeModule> = new Map([
  ['process', { module: 'process', posix: false }],
  ['node:process', { module: 'process', posix: false }],
  ['path', { module: 'path', posix: false }],
  ['node:path', { module: 'path', posix: false }],
  ['path/win32', { module: 'path', posix: false }],
  ['node:path/win32', { module: 'path', posix: false }],
  ['path/posix', { module: 'path', posix: true }],
  ['node:path/posix', { module: 'path', posix: true }],
  ['fs', { module: 'fs', posix: false }],
  ['node:fs', { module: 'fs', posix: false }],
  ['fs/promises', { module: 'fs', posix: false }],
  ['node:fs/promises', { module: 'fs', posix: false }],
]);

/** The modules a global name is, where nothing in the file declares it. */
const GLOBAL_MODULES: ReadonlyMap<string, NodeModule> = new Map([
  ['process', { module: 'process', posix: false }],
]);

/** The variables npm and the shell leave the working directory in. */
const WORKING_DIRECTORY_VARIABLES: ReadonlySet<string> = new Set(['INIT_CWD', 'PWD']);

/** CommonJS's names for the module's own place, globals where nothing declares them. */
const COMMONJS_PLACES: ReadonlySet<string> = new Set(['__dirname', '__filename']);

/** What an expression is in one of the modules: the module itself, or one of its members. */
interface ModuleReference extends NodeModule {
  /** The member named, or `undefined` for the module. */
  readonly member: string | undefined;
}

/** A file and the checker that says what its names refer to. */
interface Compiled {
  readonly file: ts.SourceFile;
  readonly checker: ts.TypeChecker;
}

/**
 * `code` compiled on its own, with nothing it imports read: the checker needs
 * only the file's own declarations to follow a name to its import.
 */
function compiled(code: string, name: string): Compiled {
  const fileName = name.endsWith('.tsx') ? 'module.tsx' : 'module.ts';
  const file = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const host: ts.CompilerHost = {
    getSourceFile: (asked) => (asked === fileName ? file : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getCanonicalFileName: (asked) => asked,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (asked) => asked === fileName,
    readFile: () => undefined,
  };
  const program = ts.createProgram({
    rootNames: [fileName],
    options: { noLib: true, noResolve: true, types: [] },
    host,
  });
  return { file, checker: program.getTypeChecker() };
}

/** Whether any node of the file answers yes. */
function anyNode(file: ts.SourceFile, answer: (node: ts.Node) => boolean): boolean {
  const visit = (node: ts.Node): boolean => answer(node) || (ts.forEachChild(node, visit) ?? false);
  return visit(file);
}

/** The expression inside brackets, a type assertion, `!` and `await`. */
function unwrapped(node: ts.Expression): ts.Expression {
  let inner = node;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isNonNullExpression(inner) ||
    ts.isAwaitExpression(inner)
  ) {
    inner = inner.expression;
  }
  return inner;
}

/** Whether `node` is `owner.name`, written out. */
function isNamed(node: ts.Expression, owner: string, name: string): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === owner &&
    node.name.text === name
  );
}

/** The text a member is named by, where it is written as a name or as a string. */
function memberName(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined;
}

/** The member an access reads and what it reads it of, where it is a member access. */
function memberAccess(
  node: ts.Node,
): { readonly owner: ts.Expression; readonly member: string } | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return { owner: node.expression, member: node.name.text };
  }
  if (ts.isElementAccessExpression(node)) {
    const member = memberName(node.argumentExpression);
    return member === undefined ? undefined : { owner: node.expression, member };
  }
  return undefined;
}

/**
 * A member of a module. The halves of each are modules themselves: the path
 * module's POSIX and Windows halves, the file-system module's promises, and
 * the process's environment.
 */
function memberOf(owner: NodeModule, member: string): ModuleReference {
  if (owner.module === 'process' && member === 'env') {
    return { module: 'environment', posix: false, member: undefined };
  }
  if (owner.module === 'path' && (member === 'posix' || member === 'win32')) {
    return { module: 'path', posix: member === 'posix', member: undefined };
  }
  if (owner.module === 'fs' && member === 'promises') {
    return { ...owner, member: undefined };
  }
  return { ...owner, member };
}

/** The module a module specifier names, where it is one of these. */
function moduleNamed(specifier: ts.Node | undefined): ModuleReference | undefined {
  if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return undefined;
  const named = NODE_MODULES.get(specifier.text);
  return named === undefined ? undefined : { ...named, member: undefined };
}

/** Reads what a file's expressions refer to and hold. */
class Reader {
  private readonly checker: ts.TypeChecker;

  constructor(checker: ts.TypeChecker) {
    this.checker = checker;
  }

  /** What a name refers to where it is written, or `undefined` for a name nothing declares. */
  private declarationOf(name: ts.Identifier): ts.Declaration | undefined {
    return this.checker.getSymbolAtLocation(name)?.declarations?.[0];
  }

  /** The value a name was declared with, where it was declared as a variable with one. */
  private declaredValue(name: ts.Identifier): ts.Expression | undefined {
    const declaration = this.declarationOf(name);
    return declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      ts.isIdentifier(declaration.name)
      ? declaration.initializer
      : undefined;
  }

  /** Whether nothing in the file declares a name, so it is a global. */
  isGlobal(name: ts.Identifier): boolean {
    return this.declarationOf(name) === undefined;
  }

  /** What `node` is in one of the modules, or `undefined` where it is nothing of one. */
  moduleReference(node: ts.Expression, depth = 0): ModuleReference | undefined {
    if (depth > DEEPEST) return undefined;
    const expression = unwrapped(node);

    if (ts.isIdentifier(expression)) return this.importedAs(expression, depth);
    if (ts.isCallExpression(expression)) {
      const isRequire =
        ts.isIdentifier(expression.expression) && expression.expression.text === 'require';
      const isImport = expression.expression.kind === ts.SyntaxKind.ImportKeyword;
      return isRequire || isImport ? moduleNamed(expression.arguments[0]) : undefined;
    }
    const access = memberAccess(expression);
    if (access === undefined) return undefined;
    const global = unwrapped(access.owner);
    if (ts.isIdentifier(global) && global.text === 'globalThis' && this.isGlobal(global)) {
      const named = GLOBAL_MODULES.get(access.member);
      return named === undefined ? undefined : { ...named, member: undefined };
    }
    const owner = this.moduleReference(access.owner, depth + 1);
    return owner !== undefined && owner.member === undefined
      ? memberOf(owner, access.member)
      : undefined;
  }

  /**
   * What a name is in one of the modules, from the declaration it refers to,
   * or as a global where nothing declares it.
   */
  private importedAs(name: ts.Identifier, depth: number): ModuleReference | undefined {
    const declaration = this.declarationOf(name);
    if (declaration === undefined) {
      const global = GLOBAL_MODULES.get(name.text);
      return global === undefined ? undefined : { ...global, member: undefined };
    }

    if (ts.isImportSpecifier(declaration)) {
      const module = moduleNamed(declaration.parent.parent.parent.moduleSpecifier);
      return module === undefined
        ? undefined
        : memberOf(module, (declaration.propertyName ?? declaration.name).text);
    }
    if (ts.isNamespaceImport(declaration)) {
      return moduleNamed(declaration.parent.parent.moduleSpecifier);
    }
    if (ts.isImportClause(declaration)) return moduleNamed(declaration.parent.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(declaration)) {
      return ts.isExternalModuleReference(declaration.moduleReference)
        ? moduleNamed(declaration.moduleReference.expression)
        : undefined;
    }
    if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
      return declaration.initializer === undefined
        ? undefined
        : this.moduleReference(declaration.initializer, depth + 1);
    }
    if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
      const holder = declaration.parent.parent;
      const taken = memberName(declaration.propertyName ?? declaration.name);
      if (!ts.isVariableDeclaration(holder) || holder.initializer === undefined) return undefined;
      const module = this.moduleReference(holder.initializer, depth + 1);
      return module !== undefined && module.member === undefined && taken !== undefined
        ? memberOf(module, taken)
        : undefined;
    }
    return undefined;
  }

  /** Whether `node` is `member` of the module named. */
  isMember(node: ts.Expression, module: NodeModule['module'], member: string): boolean {
    const reference = this.moduleReference(node);
    return reference?.module === module && reference.member === member;
  }

  /** The text `node` holds, where it is known before the code runs. */
  textOf(node: ts.Expression, depth = 0): string | undefined {
    if (depth > DEEPEST) return undefined;
    const expression = unwrapped(node);

    if (ts.isStringLiteralLike(expression)) return expression.text;
    if (
      ts.isTaggedTemplateExpression(expression) &&
      isNamed(expression.tag, 'String', 'raw') &&
      ts.isNoSubstitutionTemplateLiteral(expression.template)
    ) {
      return expression.template.rawText;
    }
    if (
      ts.isCallExpression(expression) &&
      (isNamed(expression.expression, 'String', 'fromCharCode') ||
        isNamed(expression.expression, 'String', 'fromCodePoint'))
    ) {
      const codes = expression.arguments.map((one) =>
        ts.isNumericLiteral(one) ? Number(one.text) : undefined,
      );
      return codes.every((one) => one !== undefined) ? String.fromCodePoint(...codes) : undefined;
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = this.textOf(expression.left, depth + 1);
      const right = this.textOf(expression.right, depth + 1);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    if (ts.isIdentifier(expression)) {
      const value = this.declaredValue(expression);
      return value === undefined ? undefined : this.textOf(value, depth + 1);
    }
    return undefined;
  }

  /** The regular expression `node` is, where it is known before the code runs. */
  private patternOf(node: ts.Expression, depth = 0): RegExp | undefined {
    if (depth > DEEPEST) return undefined;
    const expression = unwrapped(node);

    if (ts.isRegularExpressionLiteral(expression)) {
      const end = expression.text.lastIndexOf('/');
      return compiledPattern(expression.text.slice(1, end), expression.text.slice(end + 1));
    }
    if (
      (ts.isNewExpression(expression) || ts.isCallExpression(expression)) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'RegExp'
    ) {
      const [source, flags] = expression.arguments ?? [];
      const sourceText = source === undefined ? undefined : this.textOf(source, depth + 1);
      const flagsText = flags === undefined ? '' : this.textOf(flags, depth + 1);
      return sourceText === undefined || flagsText === undefined
        ? undefined
        : compiledPattern(sourceText, flagsText);
    }
    if (ts.isIdentifier(expression)) {
      const value = this.declaredValue(expression);
      return value === undefined ? undefined : this.patternOf(value, depth + 1);
    }
    return undefined;
  }

  /** Whether `node` is the path module's separator, the POSIX one or the other. */
  private isSeparator(node: ts.Expression, posixSeparator: boolean): boolean {
    const reference = this.moduleReference(node);
    return (
      reference?.module === 'path' &&
      reference.member === 'sep' &&
      reference.posix === posixSeparator
    );
  }

  /** Whether `node` finds a backslash, as text, as a pattern or as a separator. */
  matchesBackslash(node: ts.Expression): boolean {
    return (
      this.textOf(node)?.includes('\\') === true ||
      this.patternOf(node)?.test('\\') === true ||
      this.isSeparator(node, false)
    );
  }

  /** Whether `node` is a forward slash, as text or as the POSIX separator. */
  isForwardSlash(node: ts.Expression): boolean {
    return this.textOf(node) === '/' || this.isSeparator(node, true);
  }

  /** Whether `node` splits something on a backslash. */
  isSplitOnBackslash(node: ts.Expression): boolean {
    const expression = unwrapped(node);
    return (
      ts.isCallExpression(expression) &&
      memberAccess(expression.expression)?.member === 'split' &&
      expression.arguments[0] !== undefined &&
      this.matchesBackslash(expression.arguments[0])
    );
  }
}

/**
 * A regular expression compiled without the flags that make it remember where
 * it stopped, so asking it once answers as asking it again does; or
 * `undefined` where this engine cannot compile it.
 */
function compiledPattern(source: string, flags: string): RegExp | undefined {
  try {
    return new RegExp(source, flags.replaceAll(/[gy]/gu, ''));
  } catch {
    return undefined;
  }
}

/** Whether a path, known before the code runs, is absolute on either platform. */
function isAbsolute(path: string): boolean {
  return posix.isAbsolute(path) || win32.isAbsolute(path);
}

/**
 * Whether a name is read for what it holds where it is written, rather than
 * naming a declaration, an import or a member. A name taken apart from a
 * value is read: taking it apart reads that member.
 */
function isReadAsAValue(name: ts.Identifier): boolean {
  const parent = name.parent;
  if (ts.isBindingElement(parent)) return parent.name === name;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent)
  ) {
    return false;
  }
  return (parent as { readonly name?: ts.Node }).name !== name;
}

/** What a file does with paths, as the one-place rule asks it. */
export interface PathUses {
  /** Whether it turns a glob into paths. */
  readonly expandsAGlob: boolean;

  /** Whether it reaches the repository's root for itself. */
  readonly readsTheRoot: boolean;

  /** Whether it turns a path's backslashes into forward slashes. */
  readonly rewritesBackslashes: boolean;
}

/**
 * What a file does with paths, by the ways this module's doc lists: the file
 * compiled once, and its checker asked the three questions.
 */
export function pathUses(code: string, name = 'module.ts'): PathUses {
  const { file, checker } = compiled(code, name);
  const reader = new Reader(checker);

  return {
    expandsAGlob: anyNode(file, (node) => expandsAGlobAt(node, reader)),
    readsTheRoot: anyNode(file, (node) => readsTheRootAt(node, reader)),
    rewritesBackslashes: anyNode(file, (node) => rewritesBackslashesAt(node, reader)),
  };
}

/** Whether `node` turns a glob into paths. */
function expandsAGlobAt(node: ts.Node, reader: Reader): boolean {
  return (
    ts.isCallExpression(node) &&
    (reader.isMember(node.expression, 'fs', 'globSync') ||
      reader.isMember(node.expression, 'fs', 'glob'))
  );
}

/** Whether `node` reaches the repository's root. */
function readsTheRootAt(node: ts.Node, reader: Reader): boolean {
  if (ts.isMetaProperty(node)) return node.keywordToken === ts.SyntaxKind.ImportKeyword;

  if (ts.isIdentifier(node)) {
    if (!isReadAsAValue(node)) return false;
    if (COMMONJS_PLACES.has(node.text) && reader.isGlobal(node)) return true;
  }
  if (
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    const reference = reader.moduleReference(node);
    if (reference?.module === 'process' && reference.member === 'cwd') return true;
    if (
      reference?.module === 'environment' &&
      reference.member !== undefined &&
      WORKING_DIRECTORY_VARIABLES.has(reference.member)
    ) {
      return true;
    }
  }

  if (!ts.isCallExpression(node) || !reader.isMember(node.expression, 'path', 'resolve')) {
    return false;
  }
  // Resolved against the working directory unless a path it is given is
  // absolute; a path known only as the code runs is taken to be one.
  return node.arguments.every((one) => {
    const path = ts.isSpreadElement(one) ? undefined : reader.textOf(one);
    return path !== undefined && !isAbsolute(path);
  });
}

/** Whether `node` turns a path's backslashes into forward slashes. */
function rewritesBackslashesAt(node: ts.Node, reader: Reader): boolean {
  if (!ts.isCallExpression(node)) return false;
  const [first, second] = node.arguments;

  const called = memberAccess(node.expression);
  if (called !== undefined) {
    if ((called.member === 'replace' || called.member === 'replaceAll') && first && second) {
      return reader.matchesBackslash(first) && reader.isForwardSlash(second);
    }
    if (called.member === 'join' && first && reader.isSplitOnBackslash(called.owner)) {
      return reader.isForwardSlash(first);
    }
  }

  const joined = reader.moduleReference(node.expression);
  return (
    joined?.module === 'path' &&
    joined.member === 'join' &&
    joined.posix &&
    node.arguments.some(
      (one) => ts.isSpreadElement(one) && reader.isSplitOnBackslash(one.expression),
    )
  );
}
