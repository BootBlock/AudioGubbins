import { beforeEach, describe, expect, it } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type ExecutionResult,
  type CommandBus,
} from '@audiogubbins/commands';
import {
  BundleContentKey,
  DEFAULT_VERBOSITY,
  LogSeverity,
  createDiagnosticCentre,
  createLogStore,
  type DiagnosticBundle,
} from '@audiogubbins/diagnostics';
import { CapabilityKey } from '@audiogubbins/capabilities';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { readStoredVerbosity } from '../state/verbosity-store.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import type { RecordedTextFiles } from '../testing/text-files.js';
import { bundleSourcesFrom } from './diagnostic-commands.js';
import { shellCommands } from './shell-commands.js';
import type { ShellContext } from './shell-context.js';

/**
 * The consented diagnostic export and the verbosity controls.
 *
 * REQ-PRIV-161: "The diagnostic-bundle UI must show the user what will be
 * included before submission or export." REQ-PRIV-165 requires
 * user-configurable verbosity and subsystem filtering. The bundle library,
 * `setVerbosity` and the category overrides are tested on their own; these hold
 * the commands that call them, without which none of them would have a caller.
 */

let context: ShellContext;
let files: RecordedTextFiles;
let bus: CommandBus<ShellContext>;
let storage: ReturnType<typeof ephemeralStorage>;

function start(): void {
  const built = buildShellContext(storage);
  context = built.context;
  files = built.files;

  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
}

beforeEach(() => {
  storage = ephemeralStorage();
  start();
});

function run(id: string, args?: Readonly<Record<string, string | boolean>>) {
  return bus.execute(context, {
    commandId: commandId(id),
    ...(args === undefined ? {} : { arguments: args }),
  });
}

/** The report the last export saved, read back as the user would read it. */
function savedReport(): DiagnosticBundle {
  const saved = files.saved.at(-1);
  if (saved === undefined) throw new Error('Nothing was saved.');
  return JSON.parse(saved.text) as DiagnosticBundle;
}

/**
 * Why a command refused, or `undefined` when it did not.
 *
 * Read from the outcome rather than from the announcement. A command that
 * announced a refusal and reported success to the bus would pass tests that
 * read the announcement, so these tests ask the outcome, and the announcement
 * is what the interface does with it.
 */
function refusalOf(result: ExecutionResult<ShellContext>): string | undefined {
  return result.kind === 'refused' ? result.failures[0].summary : undefined;
}

describe('exporting a diagnostic report', () => {
  it('opens the dialogue and saves nothing until the user chooses', () => {
    // REQ-PRIV-161: the user is shown what will be included before export.
    run('help.open-diagnostic-export');

    expect(context.interaction.get().diagnosticExportOpen).toBe(true);
    expect(files.saved).toEqual([]);
  });

  it('closes the dialogue by command, as it opens it', () => {
    run('help.open-diagnostic-export');
    run('help.close-diagnostic-export');

    expect(context.interaction.get().diagnosticExportOpen).toBe(false);
    expect(run('help.close-diagnostic-export').kind).toBe('refused');
  });

  it('saves exactly the categories the user left switched on', () => {
    run('help.export-diagnostics', {
      include: [BundleContentKey.ProductVersion, BundleContentKey.Environment].join(','),
    });

    const report = savedReport();
    expect(report.contents.map((entry) => entry.key)).toEqual([
      BundleContentKey.ProductVersion,
      BundleContentKey.Environment,
    ]);
    expect(report.logs).toBeUndefined();
    expect(report.capabilities).toBeUndefined();
  });

  it('includes nothing it was not told to, whatever else could have gone in', () => {
    // The command decides nothing about what is included: a macro or a
    // replayed journal entry cannot widen what the user agreed to.
    run('help.export-diagnostics', { include: 'environment,not-a-category' });

    expect(savedReport().contents.map((entry) => entry.key)).toEqual([
      BundleContentKey.Environment,
    ]);
  });

  it('refuses to save an empty report, and says why', () => {
    const outcome = run('help.export-diagnostics', { include: '' });

    expect(files.saved).toEqual([]);
    expect(refusalOf(outcome)).toContain('at least one thing');
  });

  it('removes a path from the notes the user wrote', () => {
    run('help.export-diagnostics', {
      include: BundleContentKey.ReproductionNotes,
      notes: String.raw`It failed on C:\Users\someone\Music\take.wav`,
    });

    const notes = savedReport().reproductionNotes ?? '';
    expect(notes).toContain('It failed on');
    expect(notes).not.toContain('someone');
    expect(notes).not.toContain('take.wav');
  });

  it('keeps a file name only when the user chose to', () => {
    run('help.export-diagnostics', {
      include: BundleContentKey.ReproductionNotes,
      notes: String.raw`It failed on C:\Users\someone\Music\take.wav`,
      keepFileNames: true,
    });

    const notes = savedReport().reproductionNotes ?? '';
    expect(notes).not.toContain('someone');
    expect(notes).toContain('take.wav');
  });

  it('says so, and stays open, when the browser will not save the file', () => {
    // REQ-PRIV-161: an export failure stays local and actionable.
    context = { ...context, files: { save: () => 'The browser would not save the file.' } };
    run('help.open-diagnostic-export');

    const outcome = run('help.export-diagnostics', { include: BundleContentKey.Environment });
    expect(refusalOf(outcome)).toContain('would not save');
    expect(refusalOf(outcome)).toContain('Nothing was sent');
    expect(context.interaction.get().diagnosticExportOpen).toBe(true);
  });

  it('closes the dialogue once the report is saved', () => {
    run('help.open-diagnostic-export');
    run('help.export-diagnostics', { include: BundleContentKey.Environment });

    expect(context.interaction.get().diagnosticExportOpen).toBe(false);
  });

  it('describes the report from the same sources it is built from', () => {
    // Showing one thing and exporting another is what reading both from one
    // place prevents.
    context.logs.write({
      timestamp: 0,
      severity: LogSeverity.Error,
      category: 'shell',
      message: 'Something failed.',
      fields: {},
    });

    expect(bundleSourcesFrom(context, undefined).logs).toBe(context.logs.snapshot());
  });

  it('says which capability is still being asked, rather than reporting it missing', () => {
    // A question in flight is neither present nor missing, and the feature
    // list leaves it out for that reason. Reported here as unavailable with
    // nothing to tell the two apart, a report exported in the first moments of
    // a session said a capability was missing and every feature was working.
    const asking: ShellContext = {
      ...context,
      capabilities: {
        ...context.capabilities,
        all: () => [
          {
            key: CapabilityKey.WebGpu,
            available: false,
            reason: 'AudioGubbins is still asking this browser whether it can do this.',
            checking: true,
          },
        ],
      },
    };

    expect(bundleSourcesFrom(asking, undefined).capabilities).toEqual([
      {
        key: CapabilityKey.WebGpu,
        available: false,
        reason: 'AudioGubbins is still asking this browser whether it can do this.',
        checking: true,
      },
    ]);
  });
});

describe('choosing how much the log records', () => {
  it('sets the overall level', () => {
    run('help.set-verbosity', { severity: LogSeverity.Debug });

    expect(context.diagnostics.verbosity().defaultSeverity).toBe(LogSeverity.Debug);
  });

  it('sets one subsystem apart from the rest', () => {
    const before = context.diagnostics.verbosity().defaultSeverity;
    run('help.set-verbosity', { category: 'commands', severity: LogSeverity.Trace });

    expect(context.diagnostics.verbosity().categoryOverrides['commands']).toBe(LogSeverity.Trace);
    expect(context.diagnostics.verbosity().defaultSeverity).toBe(before);
  });

  it('returns a subsystem to the overall level', () => {
    run('help.set-verbosity', { category: 'commands', severity: LogSeverity.Trace });
    run('help.set-verbosity', { category: 'commands', severity: 'default' });

    expect(context.diagnostics.verbosity().categoryOverrides['commands']).toBeUndefined();
  });

  it('keeps the choice across a reload', () => {
    run('help.set-verbosity', { severity: LogSeverity.Info });
    run('help.set-verbosity', { category: 'commands', severity: LogSeverity.Trace });

    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('test');
    expect(readStoredVerbosity(storage, logger)).toEqual({
      defaultSeverity: LogSeverity.Info,
      categoryOverrides: { commands: LogSeverity.Trace },
    });
  });

  it('refuses a level that does not exist', () => {
    const before = context.diagnostics.verbosity();

    expect(refusalOf(run('help.set-verbosity', { severity: 'loud' }))).toContain('Choose a level');
    expect(context.diagnostics.verbosity()).toEqual(before);
  });

  it('drops a stored override naming a level this build does not have, and keeps the rest', () => {
    storage.write(
      'audiogubbins.verbosity',
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.logVerbosity,
        defaultSeverity: 'info',
        categoryOverrides: { commands: 'trace', storage: 'shouting' },
      }),
    );

    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('test');
    expect(readStoredVerbosity(storage, logger)).toEqual({
      defaultSeverity: LogSeverity.Info,
      categoryOverrides: { commands: LogSeverity.Trace },
    });
  });

  it('ignores levels written for another version of the format', () => {
    // The one persisted partition that carried no version at all, so a later
    // change to the shape of the overrides would have had nothing to recognise
    // an old file by (REQ-REPO-187).
    storage.write(
      'audiogubbins.verbosity',
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.logVerbosity + 1,
        defaultSeverity: 'trace',
        categoryOverrides: {},
      }),
    );

    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('test');
    expect(readStoredVerbosity(storage, logger)).toEqual(DEFAULT_VERBOSITY);
  });

  it('keeps nothing but a category name, so a value built into one never reaches storage', () => {
    // The subsystems are listed from the records in the log, and a category
    // built from a path was written to storage verbatim, where no log rotation
    // and no redaction reaches it.
    const refused = run('help.set-verbosity', {
      category: 'import /home/someone/take.wav',
      severity: LogSeverity.Trace,
    });

    expect(refusalOf(refused)).toBe('That is not a part of AudioGubbins that writes to the log.');
    expect(storage.read('audiogubbins.verbosity') ?? '').not.toContain('/home/someone');
  });

  it('drops a stored override keyed by anything but a category name, and bounds the rest', () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`part-${String(index)}`, 'trace']),
    );
    storage.write(
      'audiogubbins.verbosity',
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.logVerbosity,
        defaultSeverity: 'info',
        categoryOverrides: { 'C:\\Users\\someone\\take.wav': 'trace', ...many },
      }),
    );

    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('test');
    const overrides = Object.keys(readStoredVerbosity(storage, logger).categoryOverrides);

    expect(overrides.some((one) => one.includes('someone'))).toBe(false);
    expect(overrides).toHaveLength(32);
  });

  it('says which part it changed in words a reader uses', () => {
    run('help.set-verbosity', { category: 'shell', severity: LogSeverity.Trace });

    expect(context.interaction.get().announcement?.text).toBe(
      'The log records trace and above from the shell.',
    );
  });

  it('writes the version it will read back', () => {
    // A level other than the one in force: the same one writes nothing now.
    run('help.set-verbosity', { severity: LogSeverity.Warning });

    const written: unknown = JSON.parse(storage.read('audiogubbins.verbosity') ?? '{}');
    expect(written).toMatchObject({ schemaVersion: SCHEMA_VERSIONS.logVerbosity });

    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('test');
    expect(readStoredVerbosity(storage, logger).defaultSeverity).toBe(LogSeverity.Warning);
  });
});
