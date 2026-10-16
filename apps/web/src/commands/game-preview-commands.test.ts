/**
 * The Game preview's commands over a real project (ADR-0104, ADR-0106): a
 * scenario set up is the session's until it is kept, which the project's
 * scenario commands do as a change the history keeps; deleting a kept one
 * removes it there; and running the preview changes nothing of the project,
 * its history least of all.
 */

import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { GamePreviewScenario, GamePreviewScenarioId } from '@audiogubbins/game-audio';
import { addGroupInvocation, assignMemberInvocation } from '@audiogubbins/project-commands';

import { regionEntryId } from '../assets/project-entry.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { PreviewCommand } from './preview-run-commands.js';

holdPlatformFiles();

const GROUP = unsafeBrandId<'GameAssetGroupId'>('9a000000-0001');

/** A project whose one region, "Step", is the one member of the group "Footsteps". */
async function footsteps(): Promise<AudioWindow> {
  const audio = await windowWithAudio({ regions: [{ name: 'Step', start: 0, end: 24_000 }] });
  const [region] = audio.session.getSnapshot().model.state.project.regions.values();
  if (region === undefined) throw new Error('The project has no region.');
  expectSuccess(
    await audio.session.run(addGroupInvocation({ id: GROUP, name: 'Footsteps', policy: {} })),
  );
  expectSuccess(
    await audio.session.run(
      assignMemberInvocation({ kind: 'region', region: region.id }, GROUP, 'own'),
    ),
  );
  await expect
    .poll(() => audio.window.context.assets.find(regionEntryId(region.id)), { timeout: 5000 })
    .toBeDefined();
  return audio;
}

function historyOf(audio: AudioWindow): number {
  return audio.session.getSnapshot().model.history.nodes.size;
}

function keptScenarios(
  audio: AudioWindow,
): ReadonlyMap<GamePreviewScenarioId, GamePreviewScenario> {
  return audio.session.getSnapshot().model.state.gameAudio?.scenarios ?? new Map();
}

describe('the preview scenario commands', () => {
  it('sets a scenario up for the session alone, playing the first group', async () => {
    const audio = await footsteps();
    const before = historyOf(audio);

    audio.window.run(PreviewCommand.NewScenario);

    const draft = audio.window.context.gamePreview.store.get().draft;
    expect(draft?.kept).toBeUndefined();
    expect(draft?.scenario.emitters.map((one) => one.subject)).toEqual([
      { kind: 'group', group: GROUP },
    ]);
    expect(keptScenarios(audio).size).toBe(0);
    expect(historyOf(audio)).toBe(before);
  });

  it('keeps it in the project, and keeps a change to it in its place', async () => {
    const audio = await footsteps();
    audio.window.run(PreviewCommand.NewScenario);
    const { store } = audio.window.context.gamePreview;

    expect(await audio.window.runAndHear(PreviewCommand.KeepScenario)).toMatch(
      /kept in the project/u,
    );
    const first = store.get().draft?.scenario;
    expect(first === undefined ? undefined : keptScenarios(audio).get(first.id)).toEqual(first);

    audio.window.run(PreviewCommand.NewSeed);
    await audio.window.runAndHear(PreviewCommand.KeepScenario);

    const changed = store.get().draft?.scenario;
    expect(keptScenarios(audio).size).toBe(1);
    expect(changed === undefined ? undefined : keptScenarios(audio).get(changed.id)?.seed).toBe(
      changed?.seed,
    );
    expect(changed?.seed).not.toBe(first?.seed);
  });

  it('deletes a kept scenario from the project', async () => {
    const audio = await footsteps();
    audio.window.run(PreviewCommand.NewScenario);
    await audio.window.runAndHear(PreviewCommand.KeepScenario);

    expect(await audio.window.runAndHear(PreviewCommand.DeleteScenario)).toMatch(/deleted/u);

    expect(keptScenarios(audio).size).toBe(0);
    expect(audio.window.context.gamePreview.store.get().draft).toBeUndefined();
  });

  it('opens a kept scenario again to run it', async () => {
    const audio = await footsteps();
    audio.window.run(PreviewCommand.NewScenario);
    await audio.window.runAndHear(PreviewCommand.KeepScenario);
    const [kept] = keptScenarios(audio).values();
    audio.window.context.gamePreview.store.close();

    audio.window.run(PreviewCommand.ChooseScenario, { scenario: kept?.id ?? '' });

    expect(audio.window.context.gamePreview.store.get().draft).toEqual({ scenario: kept, kept });
  });
});

describe('running the preview', () => {
  it('plays the scenario set up and changes nothing of the project', async () => {
    const audio = await footsteps();
    audio.window.run(PreviewCommand.NewScenario);
    const state = audio.session.getSnapshot().model.state;
    const before = historyOf(audio);

    const ran = audio.window.run(PreviewCommand.Run);

    expect(ran.kind).toBe('applied');
    expect(audio.window.context.gamePreview.runner.playing()).toBeDefined();
    audio.window.run(PreviewCommand.Stop);
    expect(audio.window.context.gamePreview.runner.playing()).toBeUndefined();
    expect(historyOf(audio)).toBe(before);
    expect(audio.session.getSnapshot().model.state).toBe(state);
  });

  it('triggers the emitter it names, or the first, and refuses one the run has not', async () => {
    const audio = await footsteps();
    audio.window.run(PreviewCommand.NewScenario);
    audio.window.run(PreviewCommand.Run);
    const [emitter] = audio.window.context.gamePreview.runner.playing()?.emitters ?? [];

    expect(audio.window.run(PreviewCommand.Trigger).kind).toBe('applied');
    expect(audio.window.run(PreviewCommand.Trigger, { emitter: emitter ?? '' }).kind).toBe(
      'applied',
    );
    expect(audio.window.run(PreviewCommand.StopVoices, { emitter: emitter ?? '' }).kind).toBe(
      'applied',
    );
    expect(audio.window.run(PreviewCommand.Trigger, { emitter: 'e0000000-0009' }).kind).toBe(
      'refused',
    );
  });

  it('is unavailable with no scenario set up, saying so', async () => {
    const audio = await footsteps();
    const ran = audio.window.run(PreviewCommand.Run);
    expect(ran.kind).toBe('refused');
  });
});

/** What a person could see of the preview and its scenarios change. */
function seen(audio: AudioWindow): string {
  const { store } = audio.window.context.gamePreview;
  return JSON.stringify({
    draft: store.get().draft,
    run: store.get().run.kind,
    kept: [...keptScenarios(audio).values()],
    playing: audio.window.context.gamePreview.runner.playing()?.key,
  });
}

/** Runs `id` and, where it starts work in the project, waits for what it comes to say. */
async function ranOnce(
  audio: AudioWindow,
  id: string,
  args?: Readonly<Record<string, string>>,
): Promise<string> {
  const settles = id === PreviewCommand.KeepScenario || id === PreviewCommand.DeleteScenario;
  if (settles) {
    await audio.window.runAndHear(id, args);
    return 'applied';
  }
  return audio.window.run(id, args).kind;
}

/** Each command, the state it is run from, and what it is given. */
interface Twice {
  readonly id: string;
  readonly before: readonly string[];
  readonly args?: (audio: AudioWindow) => Readonly<Record<string, string>>;
}

const TWICE: readonly Twice[] = [
  { id: PreviewCommand.NewScenario, before: [] },
  {
    id: PreviewCommand.ChooseScenario,
    before: [PreviewCommand.NewScenario, PreviewCommand.KeepScenario],
    args: (audio) => ({ scenario: [...keptScenarios(audio).keys()][0] ?? '' }),
  },
  { id: PreviewCommand.KeepScenario, before: [PreviewCommand.NewScenario] },
  {
    id: PreviewCommand.DeleteScenario,
    before: [PreviewCommand.NewScenario, PreviewCommand.KeepScenario],
  },
  { id: PreviewCommand.NewSeed, before: [PreviewCommand.NewScenario] },
  { id: PreviewCommand.Run, before: [PreviewCommand.NewScenario] },
  { id: PreviewCommand.Stop, before: [PreviewCommand.NewScenario, PreviewCommand.Run] },
];

describe('each preview command run a second time', () => {
  it.each(TWICE)(
    '$id changes something again, or says it would not',
    async ({ id, before, args }) => {
      const audio = await footsteps();
      for (const step of before) await ranOnce(audio, step);
      const given = args?.(audio);

      expect(await ranOnce(audio, id, given)).toBe('applied');
      const after = seen(audio);
      const second = audio.window.run(id, given);

      expect(second.kind !== 'applied' || seen(audio) !== after).toBe(true);
    },
  );
});
