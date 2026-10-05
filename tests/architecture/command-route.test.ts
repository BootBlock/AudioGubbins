import { existsSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPOSITORY_ROOT, forwardSlashes, inRepository } from '../repository.js';
import { isTestCode } from './source-kinds.js';

/**
 * The interface changes authoritative state only through a command
 * (REQ-EDIT-073, REQ-EXEC-184).
 *
 * The command set and the bus are well tested, which proves the commands work
 * and not that the interface uses them: a dock that wrote an arrangement
 * straight into the workspace store, or a theme change wired directly into a
 * settings control, would pass `pnpm run verify:commit` without this rule. This
 * rule is the other half.
 *
 * It reads types rather than text. A regular expression over the source would
 * miss a store reached through a prop, a destructured member or an alias, and
 * would trip over a command identifier such as `workspace.reset` that only
 * looks like a member access. The compiler answers what each expression really
 * is.
 */

/**
 * What the interface may do with each authoritative store.
 *
 * An allowed list rather than a forbidden one: a store that gains an operation
 * is forbidden to the interface until someone decides otherwise, which is the
 * safe direction for a rule whose whole purpose is to catch what nobody
 * remembered to think about.
 */
const READ_ONLY_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  // The stores of the application. `get` and `subscribe` are how React reads an
  // observable; the rest are questions a menu or a command's availability asks.
  PreferencesStore: ['get', 'subscribe'],
  WorkspaceStore: ['get', 'subscribe', 'switchProblem', 'openingProblem', 'nextLayoutId'],
  ShortcutStore: ['get', 'subscribe'],
  VerbosityStore: ['get', 'subscribe'],

  // The storage every store writes through. The interface reads which parts
  // are not being kept, and writes nothing: a shell file that saved directly
  // would persist a format with no command and no validation behind it.
  StateStorage: ['get', 'subscribe'],

  // The interaction store holds what is on screen rather than what is saved,
  // and opening or closing a surface is an action ADR-0013 makes a command.
  // Announcing, reporting a half-typed chord and saying that the settings ask
  // for a Command press are not actions the user takes: they are how the
  // command layer and the settings answer the keyboard, and the shell's own
  // wiring for them is the approved route.
  InteractionStore: ['get', 'subscribe', 'announce', 'setPendingChord', 'askForCommandPress'],

  // What a reader chose to see in a log panel. Filtering a view the user is
  // reading changes nothing about the application, so choosing is view state
  // rather than an action ADR-0013 makes a command; the level the log records
  // is set in the settings, by command (REQ-PRIV-165). Forgetting a closed
  // panel is the composition root's, and the root is not interface code.
  LogViewStore: ['get', 'subscribe', 'viewOf', 'choose'],

  // What the keyboard layout types is learned from each key the user presses,
  // wherever it is pressed, as the approved route for it; it is not an action
  // the user takes. Taking a layout map whole is the composition root's.
  KeyboardLayoutStore: ['get', 'subscribe', 'learn'],

  // The diagnostic services. Writing a log record is not a state change a user
  // makes, so `loggerFor` is a read here; starting diagnostic mode, clearing
  // the log and setting the verbosity are changes, and are commands.
  LogStore: ['snapshot', 'performanceSnapshot', 'usage'],
  DiagnosticCentre: ['loggerFor', 'isDiagnosticModeActive', 'diagnosticModeEndsAt'],

  // The audio engine's view, and playback itself. Playing, pausing, stopping,
  // rendering and choosing a profile are commands; the Transport panel only
  // reads what they did, and the playhead reads the position as it moves.
  AudioViewStore: ['get', 'subscribe'],
  PlaybackSession: ['status', 'subscribe', 'position', 'audiblePosition'],

  // The editor's session: the assets it opens, whose markers and regions are
  // the project's, selections and playheads, and each view's presentation.
  // Every change is a command; a view's surface reports the width it is laid
  // out at, which is a measurement of the page and not an action the person
  // takes.
  AssetCatalogue: ['get', 'subscribe', 'find'],
  SelectionStore: ['get', 'subscribe', 'of'],
  CueStore: ['get', 'subscribe', 'of'],
  EditorViewStore: ['get', 'subscribe', 'entry', 'measured'],

  // What each view's renderer draws with is the renderer's report of the
  // browser, written as it arrives; a chosen file is handed over to the
  // command that opens it, which a command's arguments cannot carry.
  RendererReports: ['get', 'subscribe', 'report', 'forget'],
  ChosenFiles: ['offer'],

  // The reference picture: opening, binding and calibrating it are commands.
  // The Picture panel shows its element and keeps it on the transport's clock
  // each display frame, which follows the audio rather than acting on it.
  ReferencePicture: ['get', 'subscribe', 'element', 'filmstrip', 'presented', 'follow'],
};

/**
 * Where each guarded type is declared.
 *
 * Checked as well as the name, so a type of the same name from somewhere else
 * neither triggers the rule nor escapes it.
 */
const DECLARED_IN: Readonly<Record<string, string>> = {
  PreferencesStore: 'apps/web/src/state/preferences-store.ts',
  WorkspaceStore: 'apps/web/src/state/workspace-store.ts',
  ShortcutStore: 'apps/web/src/state/shortcut-store.ts',
  VerbosityStore: 'apps/web/src/state/verbosity-store.ts',
  InteractionStore: 'apps/web/src/state/interaction-store.ts',
  LogViewStore: 'apps/web/src/state/log-view-store.ts',
  StateStorage: 'apps/web/src/state/state-storage.ts',
  KeyboardLayoutStore: 'apps/web/src/state/keyboard-layout-store.ts',
  LogStore: 'packages/diagnostics/src/log-store.ts',
  DiagnosticCentre: 'packages/diagnostics/src/logger.ts',
  AudioViewStore: 'apps/web/src/state/audio-view-store.ts',
  PlaybackSession: 'packages/audio-runtime/src/playback/playback-session.ts',
  AssetCatalogue: 'apps/web/src/state/asset-catalogue.ts',
  SelectionStore: 'apps/web/src/state/selection-store.ts',
  CueStore: 'apps/web/src/state/cue-store.ts',
  EditorViewStore: 'apps/web/src/state/editor-view-store.ts',
  RendererReports: 'apps/web/src/state/renderer-reports.ts',
  ChosenFiles: 'apps/web/src/state/chosen-files.ts',
  ReferencePicture: 'apps/web/src/picture/reference-picture.ts',
};

/**
 * The interface: everything the user sees, and the hook that turns a key press
 * into a command.
 *
 * The composition root (`application.ts`) is not interface code. It builds the
 * stores, so it necessarily holds them; it renders nothing. The commands are
 * the approved route itself, and the stores are what the route acts on.
 */
const NOT_INTERFACE: readonly string[] = [
  // The approved route itself, what it acts on, and the root that builds them.
  // Only the command set and its support are among the commands: wiring that
  // runs a command from a gesture sits beside the root, inside this rule.
  'apps/web/src/commands/',
  'apps/web/src/state/',
  'apps/web/src/application.ts',
  // The root's editor part, which builds the editor's stores and wires the one
  // to the workspace that makes the editor in use the one commands act on.
  'apps/web/src/editor-part.ts',
  // What the audio commands drive: the playback and render controls the root
  // builds, which act on the runtime and render nothing.
  'apps/web/src/audio/',
  // What the picture commands drive: the reference picture and the decoding of
  // its sound, which adds the asset it makes to the catalogue; they render
  // nothing.
  'apps/web/src/picture/',
];

function isInterfaceFile(path: string): boolean {
  const relative = forwardSlashes(path.slice(REPOSITORY_ROOT.length + 1));
  if (!relative.startsWith('apps/web/src/')) return false;
  // Test code, test support among it, by the definition every rule shares.
  if (isTestCode(relative)) return false;

  // Everything the application draws with, except the named few. Listing the
  // interface instead would leave a directory added later outside the rule by
  // default, which is the wrong direction for a rule that exists to catch what
  // nobody remembered to think about.
  return !NOT_INTERFACE.some((exception) => relative.startsWith(exception));
}

/** Where the control file is placed, so its relative imports resolve as the shell's do. */
const CONTROL_PATH = forwardSlashes(inRepository('apps/web/src/command-route-control.ts'));

/**
 * A file that changes a store every way the detector claims to see.
 *
 * Held here as text and added to the program the rule reads, rather than
 * written to the tree, so no build, lint or suite ever reads it as the
 * application, and the rule over the interface leaves it out. The control over
 * the commands reaches only a property access: nothing there writes a store
 * through an element access, a template literal or a parameter destructured in
 * place, so without this two of the detector's branches would have no control
 * at all.
 */
const CONTROL_SOURCE = `
import type { WorkspaceLayout } from '@audiogubbins/workspace';
import type { WorkspaceStore } from './state/workspace-store.js';

export function byElementAccess(store: WorkspaceStore, layout: WorkspaceLayout): void {
  store['rearranged'](layout);
}

export function byTemplateLiteral(store: WorkspaceStore, layout: WorkspaceLayout): void {
  store[\`saveAs\`](layout.displayName);
}

export function byDestructuredParameter({ remove }: WorkspaceStore, id: string): void {
  remove(id);
}
`;

/** Whether a file is the control, which is no file of the application. */
function isControl(fileName: string): boolean {
  return forwardSlashes(fileName) === CONTROL_PATH;
}

/**
 * The application's program, with every type resolved, and the control file
 * added.
 *
 * One program for both, because a second program over the same files checks
 * the whole application again for the sake of one file. Nothing imports the
 * control and it declares nothing global, so what the checker says of every
 * other file is what it would say without it.
 */
function buildProgram(): ts.Program {
  const configPath = inRepository('apps/web/tsconfig.json');
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
    },
  };

  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);

  if (parsed === undefined) throw new Error('The application tsconfig could not be read.');

  const compilerHost = ts.createCompilerHost(parsed.options);
  const getSourceFile = compilerHost.getSourceFile.bind(compilerHost);
  const fileExists = compilerHost.fileExists.bind(compilerHost);
  const readFile = compilerHost.readFile.bind(compilerHost);
  compilerHost.getSourceFile = (fileName, language, ...rest) =>
    isControl(fileName)
      ? ts.createSourceFile(fileName, CONTROL_SOURCE, language)
      : getSourceFile(fileName, language, ...rest);
  compilerHost.fileExists = (fileName) => isControl(fileName) || fileExists(fileName);
  compilerHost.readFile = (fileName) => (isControl(fileName) ? CONTROL_SOURCE : readFile(fileName));

  // Without the project references the compiler reads each package's source
  // rather than a built declaration file, so the rule runs on a clean checkout.
  return ts.createProgram({
    rootNames: [...parsed.fileNames, CONTROL_PATH],
    options: parsed.options,
    host: compilerHost,
  });
}

/**
 * The guarded type an expression has, or nothing.
 *
 * Follows what the checker says the expression is, so a store reached as
 * `context.workspace`, as a prop, or through a destructured alias all answer
 * the same.
 */
function guardedTypeOf(checker: ts.TypeChecker, node: ts.Node): string | undefined {
  const symbol = checker.getTypeAtLocation(node).getSymbol();
  const name = symbol?.getName();
  if (name === undefined) return undefined;

  const expected = DECLARED_IN[name];
  if (expected === undefined) return undefined;

  const declaredIn = symbol?.declarations?.[0]?.getSourceFile().fileName;
  return forwardSlashes(declaredIn ?? '').endsWith(expected) ? name : undefined;
}

/**
 * Every use of a guarded store in a file that the allowed list does not permit.
 *
 * A property access, a destructuring wherever it appears, and an element access
 * with a literal name: a store destructured in a parameter list and
 * `store['rearranged']` would both escape a detector that read only the first.
 */
function storeWritesIn(program: ts.Program, files: readonly ts.SourceFile[]): string[] {
  const checker = program.getTypeChecker();
  const offenders: string[] = [];

  const report = (file: ts.SourceFile, node: ts.Node, type: string, member: string): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    const relative = forwardSlashes(file.fileName).slice(REPOSITORY_ROOT.length + 1);
    offenders.push(`${relative}:${String(line + 1)} ${type}.${member}`);
  };

  const allows = (type: string, member: string): boolean =>
    READ_ONLY_MEMBERS[type]?.includes(member) === true;

  for (const file of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const type = guardedTypeOf(checker, node.expression);
        if (type !== undefined && !allows(type, node.name.text)) {
          report(file, node, type, node.name.text);
        }
      }

      // `store['rearranged']` reaches the operation without writing its name
      // after a dot at all, and so does the same name in a template literal.
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
        const type = guardedTypeOf(checker, node.expression);
        const member = node.argumentExpression.text;
        if (type !== undefined && !allows(type, member)) report(file, node, type, member);
      }

      // `const { rearranged } = context.workspace`, and the same written in a
      // function's parameter list, reach it without writing its name either.
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const pattern = node.parent;
        const source =
          ts.isVariableDeclaration(pattern.parent) && pattern.parent.initializer !== undefined
            ? pattern.parent.initializer
            : pattern;

        const type = guardedTypeOf(checker, source);
        if (type !== undefined) {
          const member = (node.propertyName ?? node.name).getText();
          if (!allows(type, member)) report(file, node, type, member);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(file);
  }

  return offenders;
}

describe('the interface acts through the command registry (REQ-EDIT-073)', () => {
  const program = buildProgram();
  const sources = program
    .getSourceFiles()
    .filter((file) => !file.isDeclarationFile && !isControl(file.fileName));
  const control = program.getSourceFiles().filter((file) => isControl(file.fileName));

  const interfaceFiles = sources.filter((file) => isInterfaceFile(file.fileName));

  it('reads the interface it is meant to check', () => {
    // A program that resolved nothing would make the rule below pass having
    // read no interface code at all.
    expect(sources.length).toBeGreaterThan(20);
    expect(interfaceFiles.length).toBeGreaterThan(8);
    // And the wiring that runs a command from the dock's gestures, which would
    // be outside the rule among the commands.
    const read = interfaceFiles.map((file) => forwardSlashes(file.fileName));
    for (const path of ['apps/web/src/app.tsx', 'apps/web/src/dock-rearrangement.ts']) {
      expect(read).toContain(forwardSlashes(inRepository(path)));
    }
  });

  it('names only exceptions that exist, so a renamed one cannot widen the rule unseen', () => {
    for (const exception of NOT_INTERFACE) {
      expect(existsSync(inRepository(exception)), exception).toBe(true);
    }
  });

  it('allows only members the stores have, so a name left behind cannot allow a later one unseen', () => {
    // A member renamed in its store stays allowed under its old name, which a
    // later member given that name would inherit without anyone deciding it.
    const checker = program.getTypeChecker();

    for (const [type, allowed] of Object.entries(READ_ONLY_MEMBERS)) {
      const declaredIn = DECLARED_IN[type] ?? '';
      const file = sources.find((source) => forwardSlashes(source.fileName).endsWith(declaredIn));
      const module = file === undefined ? undefined : checker.getSymbolAtLocation(file);
      const store = module === undefined ? undefined : checker.getExportsOfModule(module);
      const symbol = store?.find((exported) => exported.getName() === type);
      expect(symbol, `${type} in ${declaredIn}`).toBeDefined();
      if (symbol === undefined) continue;

      const members = checker
        .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))
        .map((member) => member.getName());
      expect(
        allowed.filter((member) => !members.includes(member)),
        type,
      ).toEqual([]);
    }
  });

  it('changes no authoritative state except through a command', () => {
    expect(storeWritesIn(program, interfaceFiles)).toEqual([]);
  });

  it('finds a change made by another route, so the rule can fail', () => {
    // The positive control, over the same detector: the commands are where the
    // stores are changed, and every change there must be visible to this rule.
    const commands = sources.filter(
      (file) =>
        forwardSlashes(file.fileName).includes('apps/web/src/commands/') &&
        !isTestCode(forwardSlashes(file.fileName)),
    );

    const found = storeWritesIn(program, commands);

    expect(found.some((entry) => entry.endsWith('PreferencesStore.change'))).toBe(true);
    expect(found.some((entry) => entry.endsWith('WorkspaceStore.rearranged'))).toBe(true);
  });

  it('finds a store changed by element access, by template literal and by a destructured parameter', () => {
    expect(control).toHaveLength(1);

    const found = storeWritesIn(program, control).map((entry) =>
      entry.replace(/^[^ ]+:(\d+) /, 'line $1 '),
    );

    expect(found).toEqual([
      'line 6 WorkspaceStore.rearranged',
      'line 10 WorkspaceStore.saveAs',
      'line 13 WorkspaceStore.remove',
    ]);
  });
});
