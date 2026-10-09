import { describe, expect, it } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { derivedSampleCount, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { projectWorld } from '../testing/project-context.js';
import { grantedSettings, inputOpened } from '../testing/recording-fakes.js';
import { buildShellContext } from '../testing/shell-context.js';
import { everythingQueued } from '../testing/waiting.js';
import { DESCRIPTORS } from '../testing/shell-context.js';
import { shellCommands } from './shell-commands.js';
import type { ShellContext } from './shell-context.js';

/** A runner of the shell's commands over `context`, as the interface runs them. */
function runnerOver(context: ShellContext) {
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  const bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
  const run = (id: string, args?: CommandInvocation['arguments']) =>
    bus.execute(context, {
      commandId: commandId(id),
      ...(args === undefined ? {} : { arguments: args }),
    });
  return {
    run,
    /** Why `id` is refused, run with `args`. */
    refusal: (id: string, args?: CommandInvocation['arguments']) => {
      const outcome = run(id, args);
      return outcome.kind === 'refused' ? outcome.failures[0].summary : outcome.kind;
    },
  };
}

/** A window with a project open to change here, its input not yet armed. */
async function inAProject() {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  return { window, ...runnerOver(window.context) };
}

describe('arming and disarming the input', () => {
  it('is refused, with the reason, where no project can take a recording', () => {
    const { refusal } = runnerOver(buildShellContext().context);
    expect(refusal('recording.arm')).toBe('This test keeps no projects.');
  });

  it('arms once, then says the input is armed already, and disarms once', async () => {
    const { window, run, refusal } = await inAProject();
    expect(run('recording.arm').kind).toBe('applied');
    await inputOpened(window.recording);
    const { session } = window.context.recording.input.view.get();
    expect(session.kind === 'armed' && session.input.kind).toBe('open');
    expect(refusal('recording.arm')).toBe('An input is armed already.');

    expect(run('recording.disarm').kind).toBe('applied');
    expect(window.context.recording.input.view.get().session.kind).toBe('ready');
    expect(refusal('recording.disarm')).toBe('No input is armed.');
  });

  it('turns monitoring on only by its own command, warning of feedback first', async () => {
    const { window, run, refusal } = await inAProject();
    expect(refusal('recording.toggle-monitoring')).toBe(
      'No input is open, so there is nothing to monitor.',
    );
    run('recording.arm');
    await inputOpened(window.recording);
    const { monitoring } = window.context.recording;
    expect(monitoring.view.get().monitoring.kind).toBe('off');
    expect(refusal('recording.confirm-monitoring')).toBe(
      'No feedback warning is waiting to be confirmed.',
    );

    expect(run('recording.toggle-monitoring').kind).toBe('applied');
    expect(monitoring.view.get().monitoring.kind).toBe('confirming');
    expect(window.said.at(-1)).toContain('Confirm to monitor anyway');
    expect(run('recording.confirm-monitoring').kind).toBe('applied');
    expect(monitoring.view.get().monitoring.kind).toBe('on');
    expect(refusal('recording.confirm-monitoring')).toBe(
      'No feedback warning is waiting to be confirmed.',
    );
    expect(run('recording.toggle-monitoring').kind).toBe('applied');
    expect(monitoring.view.get().monitoring.kind).toBe('off');
  });

  it('says the levels only while an input is open', async () => {
    const { window, run, refusal } = await inAProject();
    expect(refusal('recording.say-levels')).toBe(
      'No input is open, so there are no levels to say.',
    );
    run('recording.arm');
    await inputOpened(window.recording);
    expect(run('recording.say-levels').kind).toBe('applied');
    expect(window.said.at(-1)).toBe('No levels have arrived from the input yet.');
  });
});

describe('choosing the input and the chain monitored through', () => {
  it('chooses a listed input once, and refuses one the browser does not list', async () => {
    const { context } = buildShellContext();
    const stop = context.recording.watch();
    await everythingQueued();
    const { run, refusal } = runnerOver(context);
    expect(refusal('recording.choose-input', { device: 'nowhere' })).toBe(
      'There is no such input.',
    );
    expect(run('recording.choose-input', { device: 'interface' }).kind).toBe('applied');
    expect(context.audioSettings.get().recording.input?.id).toBe('interface');
    expect(run('recording.choose-input', { device: 'interface' }).kind).toBe('unchanged');
    stop();
  });

  it('refuses to monitor through an asset that is not named, or has no rack', () => {
    const { refusal } = runnerOver(buildShellContext().context);
    expect(refusal('recording.monitor-through')).toBe('Say which asset.');
    expect(refusal('recording.monitor-through', { asset: 'not an identifier' })).toBe(
      'There is no such asset.',
    );
    expect(
      refusal('recording.monitor-through', { asset: '0f8fad5b-d9cb-469f-a165-70867728950e' }),
    ).toBe('That asset has no rack to monitor through.');
    expect(refusal('recording.monitor-dry')).toBe('The input is monitored dry already.');
  });
});

describe('the latency commands', () => {
  it('refuse a calibration while an input is armed, and a cancellation with none running', async () => {
    const { window, run, refusal } = await inAProject();
    expect(refusal('recording.cancel-calibration')).toBe('No calibration is running.');
    run('recording.arm');
    await inputOpened(window.recording);
    expect(refusal('recording.calibrate')).toBe(
      'Disarm the input first: the calibration opens it on its own.',
    );
    expect(window.context.recording.calibration.stage.get().kind).toBe('idle');
  });

  it('refuse an offset until the input and the rate of the path are known, then set it once', () => {
    const raw = ephemeralStorage();
    const first = runnerOver(buildShellContext(raw).context);
    expect(first.refusal('recording.set-manual-offset', { milliseconds: 5 })).toBe(
      'Choose an input first.',
    );
    expect(first.refusal('recording.forget-calibration')).toBe('Choose an input first.');

    raw.write(
      'audiogubbins.audio-settings',
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.audioSettings,
        recording: { input: { id: 'interface', label: 'Studio interface' } },
      }),
    );
    const { context } = buildShellContext(raw);
    const { refusal } = runnerOver(context);
    expect(refusal('recording.set-manual-offset', { milliseconds: 5 })).toBe(
      'Arm the input or play something first, so the sample rate the path runs at is known.',
    );
    expect(refusal('recording.set-manual-offset', { milliseconds: 'soon' })).toBe(
      'Say the offset in milliseconds.',
    );
  });
});

describe("restarting the audio engine at the input's own rate", () => {
  const RESTART = 'recording.restart-at-input-rate';

  it('is refused with the reason until an open input runs at another rate', async () => {
    const { window, run, refusal } = await inAProject();
    expect(refusal(RESTART)).toBe(
      'No input is open, so there is no rate of its own to restart at.',
    );
    run('recording.arm');
    await inputOpened(window.recording);
    expect(refusal(RESTART)).toBe("The audio engine runs at the input's rate already.");
    expect(window.recording.contexts[0]?.closes).toBe(0);
  });

  it('is refused while a recording runs, which it never cuts off', async () => {
    const { window, run, refusal } = await inAProject();
    window.recording.media.granted = grantedSettings({ sampleRate: 44_100 });
    run('recording.arm');
    await inputOpened(window.recording);
    expect(run('recording.record').kind).toBe('applied');

    expect(refusal(RESTART)).toBe(
      'A recording is running. Stop it before restarting the audio engine.',
    );
    expect(window.context.recording.input.view.get().session.kind).toBe('recording');
    expect(window.recording.contexts[0]?.closes).toBe(0);
  });

  it('is refused for a punch, which records at the rate of the audio it replaces', async () => {
    const { window, refusal } = await inAProject();
    window.recording.media.granted = grantedSettings({ sampleRate: 44_100 });
    expectSuccess(
      window.context.recording.input.arm({
        purpose: {
          kind: 'punch',
          asset: unsafeBrandId<'AssetId'>('asset-1'),
          start: derivedSampleCount(48_000),
          length: derivedSampleCount(48_000),
          preRoll: derivedSampleCount(0),
          postRoll: derivedSampleCount(0),
        },
        holdsWriteLease: () => true,
      }),
    );
    await everythingQueued();
    expect(refusal(RESTART)).toBe(
      'A punch records at the rate of the audio it replaces, so the audio engine keeps that rate.',
    );
  });
});

describe('the recording settings commands', () => {
  it('refuse each value the recording package refuses, with its reason', () => {
    const { refusal } = runnerOver(buildShellContext().context);
    expect(refusal('recording.set-retrospective', { seconds: 2 })).toBe(
      'The retrospective buffer keeps between 5 and 60 seconds.',
    );
    expect(refusal('recording.set-count-in', { seconds: 11 })).toBe(
      'A count-in lasts from 0 to 10 seconds.',
    );
    expect(refusal('recording.choose-profile', { profile: 'Nothing like it' })).toBe(
      'There is no capture profile called Nothing like it.',
    );
    expect(
      refusal('recording.save-custom-profile', {
        name: 'Close mic',
        echoCancellation: 'off',
      }),
    ).toBe('Say whether each kind of processing is on or off.');
    expect(
      refusal('recording.save-custom-profile', {
        name: '  ',
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: false,
      }),
    ).toBe('A capture profile needs a name.');
    expect(
      refusal('recording.save-custom-profile', {
        name: 'Raw/Studio',
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        voiceIsolation: false,
      }),
    ).toBe("Raw/Studio is a built-in profile's name; give the Custom profile another.");
    expect(refusal('recording.remove-custom-profile', { profile: 'Voice' })).toBe(
      'Voice is built in, so it cannot be removed.',
    );
    expect(refusal('recording.monitor-automatically', { on: true })).toBe('Choose an input first.');
  });
});
