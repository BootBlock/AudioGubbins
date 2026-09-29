import { beforeEach, describe, expect, it } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import {
  PRESET_SETTINGS,
  PerformanceProfile,
  ProcessingMode,
  SchedulingPolicy,
} from '@audiogubbins/audio-engine';

import { AUDIO_SETTINGS_KEY } from '../state/audio-settings-store.js';
import { playbackSettled, type FakePlayback } from '../testing/audio-fakes.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { audioSettingsCommands } from './audio-settings-commands.js';
import { shellCommands } from './shell-commands.js';
import type { ShellContext } from './shell-context.js';

const BALANCED = PRESET_SETTINGS[PerformanceProfile.Balanced];

let context: ShellContext;
let bus: CommandBus<ShellContext>;
let playback: FakePlayback;
let raw: ReturnType<typeof ephemeralStorage>;

beforeEach(() => {
  raw = ephemeralStorage();
  const built = buildShellContext(raw);
  context = built.context;
  playback = built.audio.playback;
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
});

function run(id: string, args?: CommandInvocation['arguments']) {
  return bus.execute(context, {
    commandId: commandId(id),
    ...(args === undefined ? {} : { arguments: args }),
  });
}

function reason(id: string): string | undefined {
  const availability = bus.availability(context, commandId(id));
  return availability.available ? undefined : availability.reason;
}

function said(): string | undefined {
  return context.interaction.get().announcement?.text;
}

describe('the audio settings commands', () => {
  it('are registered with the shell, none undoable, and none needing a capability', () => {
    const ids = shellCommands(DESCRIPTORS).map((command) => command.id);
    for (const command of audioSettingsCommands()) {
      expect(ids).toContain(command.id);
      expect(command.undoable).toBe(false);
    }
  });

  it('keeps the Custom settings command out of the palette, since only a form can supply them', () => {
    const custom = audioSettingsCommands().find(
      (command) => command.id === 'transport.set-custom-profile',
    );
    expect(custom?.discoverable).toBe(false);
  });
});

describe('setting the Custom profile', () => {
  it('keeps the settings for later while a preset is in force, and says so', () => {
    const outcome = run('transport.set-custom-profile', {
      latencyHint: 0.02,
      feedAheadMilliseconds: 400,
      backgroundConcurrencyWhileInteractive: 3,
      renderChunkMilliseconds: 250,
    });

    expect(outcome.kind).toBe('applied');
    expect(context.audioSettings.get().custom).toEqual({
      latencyHint: 0.02,
      feedAheadMilliseconds: 400,
      backgroundConcurrencyWhileInteractive: 3,
      renderChunkMilliseconds: 250,
    });
    expect(context.audioSettings.get().chosen.profile).toBe(PerformanceProfile.Balanced);
    expect(said()).toBe('The Custom profile is changed. Choose it to use it.');
  });

  it('changes only the fields given', () => {
    run('transport.set-custom-profile', { renderChunkMilliseconds: 125 });

    expect(context.audioSettings.get().custom).toEqual({
      ...BALANCED,
      renderChunkMilliseconds: 125,
    });
  });

  it('refuses invalid settings for every reason at once, and keeps what was there', () => {
    const outcome = run('transport.set-custom-profile', {
      feedAheadMilliseconds: 0,
      backgroundConcurrencyWhileInteractive: 1.5,
      renderChunkMilliseconds: -1,
    });

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.failures.map((one) => one.summary)).toEqual([
      'The feed-ahead time must be a finite number greater than zero; 0 was given.',
      expect.stringContaining(
        'The background concurrency while interactive must be a whole number',
      ),
      'The render chunk length must be a finite number greater than zero; -1 was given.',
    ]);
    expect(context.audioSettings.get().custom).toBe(BALANCED);
  });

  it('refuses a field in the wrong form, naming it as the person knows it', () => {
    const outcome = run('transport.set-custom-profile', {
      latencyHint: 'fast',
      feedAheadMilliseconds: 'soon',
    });

    expect(outcome.kind === 'refused' && outcome.failures.map((one) => one.summary)).toEqual([
      'A latency hint is interactive, balanced, playback, or a number of seconds.',
      'The feed-ahead time must be a number.',
    ]);
  });

  it('says it changed nothing when given the settings already kept', () => {
    expect(run('transport.set-custom-profile', { ...BALANCED }).kind).toBe('unchanged');
  });

  it('plays on with the new settings where Custom is in force', async () => {
    run('transport.profile-custom');
    run('transport.play-test-signal');
    await playbackSettled(context.audio);

    run('transport.set-custom-profile', { feedAheadMilliseconds: 750 });
    expect(said()).toBe('The Custom profile is changed, and in force.');
    await playbackSettled(context.audio);

    expect(playback.opened.map((one) => one.profile.settings.feedAheadMilliseconds)).toEqual([
      BALANCED.feedAheadMilliseconds,
      750,
    ]);
  });

  it('keeps the Custom profile and its settings between visits', () => {
    run('transport.set-custom-profile', { feedAheadMilliseconds: 750 });
    run('transport.profile-custom');

    const again = buildShellContext(raw).context.audioSettings.get();
    expect(again.chosen).toEqual({
      profile: PerformanceProfile.Custom,
      settings: { ...BALANCED, feedAheadMilliseconds: 750 },
    });
    expect(raw.read(AUDIO_SETTINGS_KEY)).toContain('"feedAheadMilliseconds":750');
  });
});

describe('choosing the background priority', () => {
  it('puts playback and editing first by default, and chooses throughput when asked', () => {
    expect(reason('transport.priority-interactive-first')).toBe(
      'Playback and editing first is already the background priority.',
    );

    expect(run('transport.priority-throughput').kind).toBe('applied');

    expect(context.audioSettings.get().priorityPolicy).toBe(SchedulingPolicy.Throughput);
    expect(said()).toBe('Background priority: Background work as fast as possible.');
    expect(reason('transport.priority-throughput')).toBe(
      'Background work as fast as possible is already the background priority.',
    );
  });
});

describe('choosing the render mode', () => {
  it('chooses automatically by default, and sets a mode when asked', () => {
    expect(reason('transport.render-mode-automatic')).toBe('Automatic is already the render mode.');

    expect(run('transport.render-mode-background-offline').kind).toBe('applied');
    expect(context.audioSettings.get().renderMode).toBe(ProcessingMode.BackgroundOffline);
    expect(said()).toBe('Render mode: Background rendering.');

    expect(run('transport.render-mode-automatic').kind).toBe('applied');
    expect(context.audioSettings.get().renderMode).toBeUndefined();
  });
});
