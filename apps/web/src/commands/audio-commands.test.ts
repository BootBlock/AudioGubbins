import { beforeEach, describe, expect, it } from 'vitest';

import {
  AUDIO_PLAYBACK,
  OFFLINE_RENDERING,
  createCapabilityRegistry,
  type CapabilityEnvironment,
} from '@audiogubbins/capabilities';
import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { PerformanceProfile, TransportMode } from '@audiogubbins/audio-engine';

import { RenderStage } from '../state/audio-view-store.js';
import { playbackSettled, type FakePlayback, type FakeRendering } from '../testing/audio-fakes.js';
import { CAPABLE, DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { everythingQueued } from '../testing/waiting.js';
import { audioCommands } from './audio-commands.js';
import { shellCommands } from './shell-commands.js';
import type { ShellContext } from './shell-context.js';

const TRANSPORT = ['transport.play-test-signal', 'transport.pause', 'transport.stop'];

/** A bus over the shell's commands, and a context over fakes in a browser `environment` describes. */
function rig(environment: CapabilityEnvironment = CAPABLE): {
  readonly context: ShellContext;
  readonly bus: CommandBus<ShellContext>;
  readonly playback: FakePlayback;
  readonly rendering: FakeRendering;
} {
  const built = buildShellContext();
  const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('shell');
  const context = { ...built.context, capabilities: createCapabilityRegistry(environment, logger) };
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  const bus = createCommandBus(registry, logger);
  return { context, bus, ...built.audio };
}

function reason(bus: CommandBus<ShellContext>, context: ShellContext, id: string) {
  const availability = bus.availability(context, commandId(id));
  return availability.available ? undefined : availability.reason;
}

describe('the audio commands', () => {
  it('are registered with the shell, each in the Transport category, none undoable', () => {
    const ids = shellCommands(DESCRIPTORS).map((command) => command.id);
    for (const command of audioCommands()) {
      expect(ids).toContain(command.id);
      expect(command.category).toBe('transport');
      expect(command.undoable).toBe(false);
    }
  });

  it('offers one command for each profile, Custom among them', () => {
    const profiles = audioCommands()
      .map((command) => command.id)
      .filter((id) => id.startsWith('transport.profile-'));
    expect(profiles).toEqual([
      'transport.profile-low-latency',
      'transport.profile-balanced',
      'transport.profile-maximum-stability',
      'transport.profile-custom',
    ]);
  });
});

describe('the audio commands where a capability is missing', () => {
  it('keeps the transport in the palette, unavailable, for the reason the Capabilities panel gives', () => {
    const { context, bus } = rig({ ...CAPABLE, hasAudioWorklet: false });
    const explanation = context.capabilities.featureAvailability(AUDIO_PLAYBACK).explanation;

    for (const id of TRANSPORT) expect(reason(bus, context, id)).toBe(explanation);
    expect(explanation).toContain('Playback is unavailable in this browser.');
  });

  it('keeps the offline render in the palette, unavailable, for its own reason', () => {
    const { context, bus } = rig({ ...CAPABLE, hasWebWorkers: false });
    const explanation = context.capabilities.featureAvailability(OFFLINE_RENDERING).explanation;

    expect(reason(bus, context, 'transport.render-test-signal')).toBe(explanation);
    // Playback needs no worker, and stays available.
    expect(reason(bus, context, 'transport.play-test-signal')).toBeUndefined();
  });

  it('makes nothing when the unavailable Play is run anyway', () => {
    const { context, bus, playback } = rig({ ...CAPABLE, hasAudioWorklet: false });

    const outcome = bus.execute(context, { commandId: commandId('transport.play-test-signal') });

    expect(outcome.kind).toBe('refused');
    expect(playback.opened).toEqual([]);
  });

  it('lets a profile be chosen without playback, since a profile never switches a feature', () => {
    const { context, bus } = rig({ ...CAPABLE, hasAudioWorklet: false, hasWebWorkers: false });

    expect(reason(bus, context, 'transport.profile-low-latency')).toBeUndefined();
  });
});

describe('running the audio commands', () => {
  let context: ShellContext;
  let bus: CommandBus<ShellContext>;
  let playback: FakePlayback;
  let rendering: FakeRendering;
  const run = (id: string) => bus.execute(context, { commandId: commandId(id) });

  beforeEach(() => {
    ({ context, bus, playback, rendering } = rig());
  });

  it('plays the test signal, and offers Pause and Stop only once it plays', async () => {
    expect(reason(bus, context, 'transport.pause')).toBe('Nothing is playing.');
    expect(reason(bus, context, 'transport.stop')).toBe('Nothing is playing.');

    expect(run('transport.play-test-signal').kind).toBe('applied');
    expect(reason(bus, context, 'transport.play-test-signal')).toBe('The test signal is starting.');
    await playbackSettled(context.audio);

    expect(playback.latest().status.transport.mode).toBe(TransportMode.Playing);
    expect(reason(bus, context, 'transport.play-test-signal')).toBe(
      'The test signal is already playing.',
    );
    expect(reason(bus, context, 'transport.pause')).toBeUndefined();
    expect(reason(bus, context, 'transport.stop')).toBeUndefined();
  });

  it('pauses and stops, saying each', async () => {
    run('transport.play-test-signal');
    await playbackSettled(context.audio);

    expect(run('transport.pause').kind).toBe('applied');
    expect(context.interaction.get().announcement?.text).toBe('Playback is paused.');
    expect(context.audio.get().playback?.transport.mode).toBe(TransportMode.Paused);

    expect(run('transport.stop').kind).toBe('applied');
    expect(context.interaction.get().announcement?.text).toBe('Playback is stopped.');
    expect(context.audio.get().playback?.transport.mode).toBe(TransportMode.Stopped);
    expect(reason(bus, context, 'transport.stop')).toBe('Nothing is playing.');
  });

  it('renders the test signal, and refuses a second render while the first runs', async () => {
    expect(run('transport.render-test-signal').kind).toBe('applied');
    expect(reason(bus, context, 'transport.render-test-signal')).toBe(
      'The test signal is already rendering.',
    );
    await everythingQueued();

    expect(rendering.requests).toHaveLength(1);
    expect(context.audio.get().render.stage).toBe(RenderStage.Finished);
    expect(reason(bus, context, 'transport.render-test-signal')).toBeUndefined();
  });

  it('chooses a profile, says it, and refuses the one already chosen', () => {
    expect(reason(bus, context, 'transport.profile-balanced')).toBe(
      'Balanced is already the performance profile.',
    );

    expect(run('transport.profile-maximum-stability').kind).toBe('applied');

    expect(context.audioSettings.get().chosen.profile).toBe(PerformanceProfile.MaximumStability);
    expect(context.interaction.get().announcement?.text).toBe(
      'The performance profile is Maximum stability.',
    );
    expect(reason(bus, context, 'transport.profile-balanced')).toBeUndefined();
  });

  it('plays on in a new context when the profile changes while playing', async () => {
    run('transport.play-test-signal');
    await playbackSettled(context.audio);

    run('transport.profile-low-latency');
    await playbackSettled(context.audio);

    expect(playback.opened.map((one) => [one.profile.profile, one.closed])).toEqual([
      [PerformanceProfile.Balanced, true],
      [PerformanceProfile.LowLatency, false],
    ]);
    expect(context.audio.get().playback?.transport.mode).toBe(TransportMode.Playing);
  });
});

describe('the Custom profile and the render decisions', () => {
  let context: ShellContext;
  let bus: CommandBus<ShellContext>;
  let playback: FakePlayback;
  let rendering: FakeRendering;
  const run = (id: string) => bus.execute(context, { commandId: commandId(id) });

  beforeEach(() => {
    ({ context, bus, playback, rendering } = rig());
  });

  it('plays with the Custom settings once Custom is chosen', async () => {
    run('transport.play-test-signal');
    await playbackSettled(context.audio);

    expect(run('transport.profile-custom').kind).toBe('applied');
    expect(context.interaction.get().announcement?.text).toBe('The performance profile is Custom.');
    await playbackSettled(context.audio);

    expect(playback.opened.at(-1)?.profile).toEqual({
      profile: PerformanceProfile.Custom,
      settings: context.audioSettings.get().custom,
    });
  });

  it('never changes what can be done: every other command is as available under every profile', () => {
    const others = shellCommands(DESCRIPTORS)
      .map((command) => command.id)
      .filter((id) => !id.startsWith('transport.profile-'));
    const availabilityUnder = (profile: string) => {
      run(`transport.profile-${profile}`);
      return others.map((id) => [id, bus.availability(context, id).available]);
    };

    const balanced = others.map((id) => [id, bus.availability(context, id).available]);
    for (const profile of ['low-latency', 'maximum-stability', 'custom', 'balanced']) {
      expect(availabilityUnder(profile)).toEqual(balanced);
    }
  });

  it('says a render starts in the background when it does', async () => {
    run('transport.render-mode-background-offline');

    expect(run('transport.render-test-signal').kind).toBe('applied');

    expect(context.interaction.get().announcement?.text).toBe(
      'Rendering the test signal offline, in the background.',
    );
    await everythingQueued();
  });

  it('offers the decisions only while a render waits on a warning, and says what it asks', async () => {
    expect(reason(bus, context, 'transport.render-safer')).toBe(
      'No render is waiting for a decision.',
    );
    run('transport.render-mode-final-offline');
    context.renderStrategy.measured(2);

    expect(run('transport.render-test-signal').kind).toBe('applied');

    expect(rendering.requests).toEqual([]);
    expect(context.interaction.get().announcement?.text).toMatch(
      /The processor is the limiting resource\. Render in the background, or render as chosen\?$/,
    );
    expect(reason(bus, context, 'transport.render-safer')).toBeUndefined();
    expect(reason(bus, context, 'transport.render-as-chosen')).toBeUndefined();

    expect(run('transport.render-safer').kind).toBe('applied');
    await everythingQueued();

    expect(rendering.runs.map((one) => one.priority)).toEqual(['background']);
    expect(reason(bus, context, 'transport.render-as-chosen')).toBe(
      'No render is waiting for a decision.',
    );
  });
});
