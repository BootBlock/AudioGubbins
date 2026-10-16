/**
 * Projects for the tests of the guided workflows' commands and dialog: a
 * recording of two short tones apart in silence, imported as a person imports
 * one, with a region over each tone in an asset group, made by the project's
 * own commands, and the recording open in the editor.
 */

import { expect } from 'vitest';

import type { GameAssetGroup } from '@audiogubbins/game-audio';
import { addGroupInvocation, assignMemberInvocation } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import { silence, type SignalFixture } from '@audiogubbins/test-fixtures';

import { windowWithAudio, type AudioWindow } from './project-audio.js';

/** The recording's rate. */
export const RATE = 48_000;

/** Two seconds of silence holding two 0.25 s tones of 440 Hz, at 0.25 s and 1.25 s. */
export function twoBursts(): SignalFixture {
  const quiet = silence({ length: 2 * RATE });
  const [samples] = quiet.channels;
  if (samples === undefined) throw new Error('Silence has its channel.');
  for (const start of [RATE / 4, (5 * RATE) / 4]) {
    for (let n = 0; n < RATE / 4; n += 1) {
      samples[start + n] = 0.5 * Math.sin((2 * Math.PI * 440 * n) / RATE);
    }
  }
  return { ...quiet, name: 'two-bursts' };
}

/** The project as `audio`'s session holds it now. */
export function stateOf(audio: AudioWindow): ProjectState {
  return audio.session.getSnapshot().model.state;
}

/** The recording open in the editor, its view focused. */
export function inTheEditor(audio: AudioWindow): void {
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.focus('editor');
}

/** The recording with a region over each tone, with room around it, in a group called Steps. */
export async function groupOfTwo(): Promise<{
  readonly audio: AudioWindow;
  readonly group: GameAssetGroup;
}> {
  const audio = await windowWithAudio({
    fixture: twoBursts(),
    name: 'Steps',
    regions: [
      { name: 'Step 1', start: 0, end: RATE },
      { name: 'Step 2', start: RATE, end: 2 * RATE },
    ],
  });
  const group: GameAssetGroup = {
    id: audio.window.storage.ids.next<'GameAssetGroupId'>(),
    name: 'Steps',
    policy: {},
  };
  const regions = [...stateOf(audio).project.regions.values()];
  const added = await audio.session.runGroup('Group the steps', [
    addGroupInvocation(group),
    ...regions.map((region) =>
      assignMemberInvocation({ kind: 'region', region: region.id }, group.id, 'inherit'),
    ),
  ]);
  expect(added.ok).toBe(true);
  inTheEditor(audio);
  return { audio, group };
}

/** Waits for a workflow's analyses to end. */
export async function analysesEnded(audio: AudioWindow): Promise<void> {
  await expect
    .poll(() => audio.window.context.workflowAnalysis.get().kind, { timeout: 60_000 })
    .toBe('idle');
}
