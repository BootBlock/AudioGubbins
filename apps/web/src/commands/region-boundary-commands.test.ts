import { describe, expect, it } from 'vitest';

import type { Region } from '@audiogubbins/domain';

import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';

holdPlatformFiles();

/** The loop imported with a region "Body" from one second to five, open in an editor. */
async function regionOfLoop(): Promise<{ readonly audio: AudioWindow; readonly region: Region }> {
  const audio = await windowWithAudio({ regions: [{ name: 'Body', start: 48_000, end: 240_000 }] });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', { width: 1000, height: 300 }, audio.asset().length);
  context.editorViews.focus('editor');
  const [region] = regionsOf(audio);
  if (region === undefined) throw new Error('No region.');
  return { audio, region };
}

function regionsOf(audio: AudioWindow): readonly Region[] {
  return [...audio.session.getSnapshot().model.state.project.regions.values()];
}

const spanOf = (audio: AudioWindow) => regionsOf(audio).map((one) => [one.start, one.end]);

describe('moving one end of a region (REQ-EDIT-014)', () => {
  it('moves the start to the playhead, keeping the end, and undo puts it back', async () => {
    const { audio, region } = await regionOfLoop();
    audio.window.run('editor.set-playhead', { position: 24_000 });

    expect(await audio.window.runAndHear('region.move-start', { region: region.id })).toBe(
      'Moved the start of Body to 0:00.500.',
    );
    expect(spanOf(audio)).toEqual([[24_000, 240_000]]);

    await audio.window.runAndHear('edit.undo');
    expect(spanOf(audio)).toEqual([[48_000, 240_000]]);
  });

  it('moves the end to the position given, keeping the start, as one step of the history', async () => {
    const { audio, region } = await regionOfLoop();

    await audio.window.runAndHear('region.move-end', { region: region.id, to: 96_000 });
    expect(spanOf(audio)).toEqual([[48_000, 96_000]]);

    await audio.window.runAndHear('edit.undo');
    expect(spanOf(audio)).toEqual([[48_000, 240_000]]);
    await audio.window.runAndHear('edit.redo');
    expect(spanOf(audio)).toEqual([[48_000, 96_000]]);
  });

  it('refuses an end that would meet or pass the other, leaving the region as it was', async () => {
    const { audio, region } = await regionOfLoop();

    const late = audio.window.run('region.move-start', { region: region.id, to: 240_000 });
    const early = audio.window.run('region.move-end', { region: region.id, to: 24_000 });

    expect(late).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'The start of Body must stay before its end.' }],
    });
    expect(early).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'The end of Body must stay after its start.' }],
    });
    expect(spanOf(audio)).toEqual([[48_000, 240_000]]);
  });

  it('changes nothing where the end is there already', async () => {
    const { audio, region } = await regionOfLoop();

    expect(audio.window.run('region.move-end', { region: region.id, to: 240_000 })).toMatchObject({
      kind: 'unchanged',
    });
    expect(spanOf(audio)).toEqual([[48_000, 240_000]]);
  });

  it('reads a position in a view of the region from the region’s own start', async () => {
    const { audio, region } = await regionOfLoop();
    audio.window.run('region.open', { region: region.id });

    await audio.window.runAndHear('region.move-end', { to: 48_000 });
    expect(spanOf(audio)).toEqual([[48_000, 96_000]]);

    await audio.window.runAndHear('region.move-start', { to: 4800 });
    expect(spanOf(audio)).toEqual([[52_800, 96_000]]);
  });
});
