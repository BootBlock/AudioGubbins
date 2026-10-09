import { describe, expect, it, vi } from 'vitest';

import { PcmDescriptionKind } from '@audiogubbins/audio-engine';
import { processorsOf } from '@audiogubbins/domain';
import type { HistoryNodeId } from '@audiogubbins/project-format';

import { playbackSettled } from '../testing/audio-fakes.js';
import {
  holdPlatformFiles,
  rackedWithDeepFilterNet,
  windowWithAudio,
  type AudioWindow,
} from '../testing/project-audio.js';

holdPlatformFiles();

/**
 * The loop imported and open in the editor in use, made 6 dB quieter after,
 * and a comparison open of side A, before the gain, and side B, after it;
 * with the plan the loop had in side A.
 */
async function comparedLoop(): Promise<{
  readonly audio: AudioWindow;
  readonly b: HistoryNodeId;
  readonly planA: unknown;
}> {
  const audio = await windowWithAudio();
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.focus('editor');
  const a = audio.session.getSnapshot().model.history.cursor;
  const planA = currentPlan(audio);
  await audio.window.runAndHear('edit.gain', { decibels: -6 });
  const b = audio.session.getSnapshot().model.history.cursor;
  await audio.window.runAndHear('history.compare', { fromNode: a, node: b });
  return { audio, b, planA };
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
    const { audio, b, planA } = await comparedLoop();
    const stateA = await audio.session.comparedState('a');
    const stateB = audio.session.getSnapshot().model.state;

    audio.window.run('history.audition');
    await expect.poll(() => audio.window.audio.playback.opened.length).toBe(1);
    await playbackSettled(audio.window.context.audio);

    expect(planA).toBeDefined();
    expect(planPlayed(audio)).toEqual(planA);
    const { model } = audio.session.getSnapshot();
    expect(model.history.cursor).toBe(b);
    expect(model.comparison?.listening).toBe('a');
    expect(model.state).toEqual(stateB);
    expect(await audio.session.comparedState('a')).toEqual(stateA);
  });

  it('plays the side asked for last, whichever the worker answers first', async () => {
    const { audio, planA } = await comparedLoop();
    const { session } = audio;
    const asked = session.comparedState;
    // Side B's state is answered only after side A's, asked for after it.
    let answerB = (): void => undefined;
    const answeredB = new Promise<void>((resolve) => {
      answerB = resolve;
    });
    vi.spyOn(session, 'comparedState').mockImplementation(async (side, signal) => {
      if (side === 'b') await answeredB;
      return await asked(side, signal);
    });

    audio.window.run('history.audition', { side: 'b' });
    audio.window.run('history.audition', { side: 'a' });
    await expect.poll(() => audio.window.audio.playback.opened.length).toBe(1);
    await playbackSettled(audio.window.context.audio);
    answerB();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await playbackSettled(audio.window.context.audio);

    expect(planPlayed(audio)).toEqual(planA);
    expect(audio.window.audio.playback.latest().loads).toHaveLength(1);
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

  it('says why where a chain in the side heard runs a model this page cannot run', async () => {
    const audio = await windowWithAudio();
    const { context } = audio.window;
    const unracked = audio.session.getSnapshot().model.history.cursor;
    const rack = await rackedWithDeepFilterNet(audio);
    const racked = audio.session.getSnapshot().model.history.cursor;
    const [processor] = processorsOf(rack.slots);
    if (processor === undefined) throw new Error('The rack holds DeepFilterNet 3.');
    // Known once the page has read which packs it holds: none.
    await expect.poll(() => context.modelGate.get()(processor)).toBeDefined();
    // One step gave the sound its rack, with the chain in it.
    await audio.window.runAndHear('edit.undo');
    await expect.poll(() => context.assets.find(audio.entry)).toBeDefined();
    context.editorViews.open('editor', audio.asset());
    context.editorViews.focus('editor');
    await audio.window.runAndHear('history.compare', { fromNode: racked, node: unracked });

    audio.window.run('history.audition', { side: 'a' });

    await expect
      .poll(() => audio.window.said.at(-1))
      .toMatch(
        /^Loop cannot be heard as side A has it yet\. DeepFilterNet 3 cannot run because the model it needs is not available\. /,
      );
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
