import { describe, expect, it } from 'vitest';

import { PcmDescriptionKind } from '@audiogubbins/audio-engine';
import type { HistoryNodeId } from '@audiogubbins/project-format';

import { playbackSettled } from '../testing/audio-fakes.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';

holdPlatformFiles();

/**
 * The loop imported and open in the editor in use, made 6 dB quieter after,
 * and a comparison open of side A, before the gain, and side B, after it.
 */
async function comparedLoop(): Promise<{ readonly audio: AudioWindow; readonly b: HistoryNodeId }> {
  const audio = await windowWithAudio();
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.focus('editor');
  const a = audio.session.getSnapshot().model.history.cursor;
  await audio.window.runAndHear('edit.gain', { decibels: -6 });
  const b = audio.session.getSnapshot().model.history.cursor;
  await audio.window.runAndHear('history.compare', { fromNode: a, node: b });
  return { audio, b };
}

/** The edit plan the transport was given last. */
function planPlayed(audio: AudioWindow): unknown {
  const [source] = audio.window.audio.playback.latest().loads.at(-1)?.sources ?? [];
  return source?.kind === PcmDescriptionKind.Edited ? source.plan : undefined;
}

/** The asset's plan as it stands now, in side B. */
function currentPlan(audio: AudioWindow): unknown {
  const description = audio.asset().describe();
  return description.kind === PcmDescriptionKind.Edited ? description.plan : undefined;
}

describe('hearing the two states of an A/B comparison (REQ-STOR-195)', () => {
  it('plays the audio in view as the side heard has it, changing neither state', async () => {
    const { audio, b } = await comparedLoop();

    audio.window.run('history.audition');
    await expect.poll(() => audio.window.audio.playback.opened.length).toBe(1);
    await playbackSettled(audio.window.context.audio);

    const played = planPlayed(audio);
    expect(played).toBeDefined();
    expect(played).not.toEqual(currentPlan(audio));
    expect(audio.window.context.playback.programme()).toBe(`compared-a:${audio.entry}`);
    const { model } = audio.session.getSnapshot();
    expect(model.history.cursor).toBe(b);
    expect(model.comparison?.listening).toBe('a');
  });

  it('goes on as the other side when the sides are switched while one plays', async () => {
    const { audio } = await comparedLoop();
    audio.window.run('history.audition');
    await expect.poll(() => audio.window.audio.playback.opened.length).toBe(1);
    await playbackSettled(audio.window.context.audio);
    const sideA = planPlayed(audio);

    expect(await audio.window.runAndHear('history.switch-side')).toBe('Side B is heard.');
    await expect
      .poll(() => audio.window.context.playback.programme())
      .toBe(`compared-b:${audio.entry}`);
    await playbackSettled(audio.window.context.audio);

    expect(planPlayed(audio)).toEqual(currentPlan(audio));
    expect(planPlayed(audio)).not.toEqual(sideA);
  });

  it('says why where the audio in view is not in the side heard', async () => {
    const audio = await windowWithAudio();
    const { context } = audio.window;
    context.editorViews.open('editor', audio.asset());
    context.editorViews.focus('editor');
    const { history } = audio.session.getSnapshot().model;
    await audio.window.runAndHear('history.compare', {
      fromNode: history.root,
      node: history.cursor,
    });

    audio.window.run('history.audition');

    await expect.poll(() => audio.window.said).toContain('Loop is not in side A.');
    expect(audio.window.audio.playback.opened).toEqual([]);
  });

  it('is refused where no comparison is open', async () => {
    const audio = await windowWithAudio();
    audio.window.context.editorViews.open('editor', audio.asset());
    audio.window.context.editorViews.focus('editor');

    const ran = audio.window.run('history.audition');

    expect(ran.kind === 'refused' ? ran.failures[0].summary : ran.kind).toBe(
      'No comparison is open.',
    );
  });
});
