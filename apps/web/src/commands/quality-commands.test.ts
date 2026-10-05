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
  InferencePath,
  MAXIMUM_QUALITY,
  QualityLevel,
  ResamplingGrade,
  namedQualityMode,
} from '@audiogubbins/domain';

import { previewQualityOf } from '../state/audio-settings-store.js';
import { playbackSettled, type FakePlayback, type FakeRendering } from '../testing/audio-fakes.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { everythingQueued } from '../testing/waiting.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { qualityCommands } from './quality-commands.js';
import { shellCommands } from './shell-commands.js';
import type { ShellContext } from './shell-context.js';

let context: ShellContext;
let bus: CommandBus<ShellContext>;
let playback: FakePlayback;
let rendering: FakeRendering;

beforeEach(() => {
  const built = buildShellContext(ephemeralStorage());
  context = built.context;
  playback = built.audio.playback;
  rendering = built.audio.rendering;
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

function refusals(outcome: ReturnType<typeof run>): readonly string[] | false {
  return outcome.kind === 'refused' && outcome.failures.map((one) => one.summary);
}

describe('the quality commands', () => {
  it('are registered with the shell, none undoable, the Custom ones kept out of the palette', () => {
    const ids = shellCommands(DESCRIPTORS).map((command) => command.id);
    for (const command of qualityCommands()) {
      expect(ids).toContain(command.id);
      expect(command.undoable).toBe(false);
    }
    const hidden = qualityCommands()
      .filter((command) => command.discoverable === false)
      .map((command) => command.id);
    expect(hidden).toEqual([
      'transport.set-custom-render-quality',
      'transport.set-custom-preview-quality',
    ]);
  });

  it('describe each level by the values it sets', () => {
    const draft = qualityCommands().find(
      (command) => command.id === 'transport.render-quality-draft',
    );
    expect(draft?.description).toBe(
      'Renders, and draws waveforms, at Draft quality. Resampling draft, oversampling none, spectral overlap 2 frames, inference path pinned.',
    );
  });
});

describe('choosing the render quality', () => {
  it('renders at the highest quality by default, and at the level chosen', async () => {
    expect(reason('transport.render-quality-maximum')).toBe(
      'Maximum is already the render quality.',
    );

    expect(run('transport.render-quality-draft').kind).toBe('applied');
    expect(said()).toBe('Render quality: Draft.');
    run('transport.render-test-signal');
    await everythingQueued();

    expect(context.audioSettings.get().renderQuality).toEqual(namedQualityMode(QualityLevel.Draft));
    expect(rendering.requests.map((request) => request.quality.level)).toEqual([
      QualityLevel.Draft,
    ]);
  });

  it('sets the values given over those in force, and names the level they make', () => {
    expect(run('transport.set-custom-render-quality', { oversampling: 4 }).kind).toBe('applied');

    expect(context.audioSettings.get().renderQuality).toEqual({
      level: QualityLevel.Custom,
      settings: { ...MAXIMUM_QUALITY.settings, oversampling: 4 },
    });
    expect(said()).toBe('Render quality: Custom.');

    run('transport.set-custom-render-quality', {
      resampling: ResamplingGrade.High,
      spectralOverlap: 4,
    });
    expect(context.audioSettings.get().renderQuality.level).toBe(QualityLevel.High);
    expect(said()).toBe('Render quality: High.');
  });

  it('refuses every value in the wrong form at once, and keeps what was there', () => {
    const outcome = run('transport.set-custom-render-quality', {
      resampling: 'best',
      oversampling: 3,
      spectralOverlap: '4',
      inference: 'quick',
    });

    expect(refusals(outcome)).toEqual([
      'A resampling grade is draft, high or maximum.',
      'Oversampling is 1, 2, 4 or 8 times.',
      'A spectral overlap is 2, 4 or 8 frames.',
      'An inference path is pinned or accelerated.',
    ]);
    expect(context.audioSettings.get().renderQuality).toBe(MAXIMUM_QUALITY);
  });

  it('says it changed nothing when given the values in force', () => {
    expect(run('transport.set-custom-render-quality', { oversampling: 8 }).kind).toBe('unchanged');
  });
});

describe('choosing the preview quality', () => {
  it('follows the profile by default, and plays on at the level chosen', async () => {
    expect(reason('transport.preview-quality-automatic')).toBe(
      'Automatic is already the preview quality.',
    );
    run('transport.play-test-signal');
    await playbackSettled(context.audio);

    expect(run('transport.preview-quality-high').kind).toBe('applied');
    expect(said()).toBe('Preview quality: High.');
    await playbackSettled(context.audio);

    expect(playback.latest().loads.map((request) => request.quality.level)).toEqual([
      QualityLevel.Standard,
      QualityLevel.High,
    ]);
    expect(reason('transport.preview-quality-high')).toBe('High is already the preview quality.');

    run('transport.preview-quality-automatic');
    expect(context.audioSettings.get().previewQuality).toBeUndefined();
  });

  it('sets the values given over those it previews at, and stops following the profile', () => {
    const outcome = run('transport.set-custom-preview-quality', {
      inference: InferencePath.Accelerated,
    });

    expect(outcome.kind).toBe('applied');
    expect(context.audioSettings.get().previewQuality).toEqual({
      level: QualityLevel.Custom,
      settings: {
        ...namedQualityMode(QualityLevel.Standard).settings,
        inference: InferencePath.Accelerated,
      },
    });
    expect(said()).toBe('Preview quality: Custom.');
  });

  it('takes the profile’s own values as a choice, which no longer follows the profile', () => {
    const profile = previewQualityOf(context.audioSettings.get());

    expect(run('transport.set-custom-preview-quality', { ...profile.settings }).kind).toBe(
      'applied',
    );
    expect(context.audioSettings.get().previewQuality).toBe(profile);
    expect(run('transport.set-custom-preview-quality', { ...profile.settings }).kind).toBe(
      'unchanged',
    );
  });

  it('refuses a value in the wrong form, and keeps following the profile', () => {
    expect(
      refusals(run('transport.set-custom-preview-quality', { oversampling: 'twice' })),
    ).toEqual(['Oversampling is 1, 2, 4 or 8 times.']);
    expect(context.audioSettings.get().previewQuality).toBeUndefined();
  });
});
