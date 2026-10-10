import { describe, expect, it } from 'vitest';

import { SelectionFacet, activeFacet, samplesWithin } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';

holdPlatformFiles();

const LOOP_MARKERS = [
  { name: 'Attack', at: 0 },
  { name: 'Sustain', at: 4800 },
  { name: 'Release', at: 244_800 },
];

/** A window with the loop imported and marked, shown in an editor a thousand pixels wide. */
async function markedLoop(): Promise<AudioWindow> {
  const audio = await windowWithAudio({ markers: LOOP_MARKERS });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', { width: 1000, height: 300 }, audio.asset().length);
  context.editorViews.focus('editor');
  return audio;
}

const placed = (asset: EditorAsset) =>
  asset.markers.map((marker) => [marker.displayName, marker.position]);

describe('the marker commands (ADR-0047)', () => {
  it('add a marker at the playhead to the project, and undo removes it again', async () => {
    const audio = await markedLoop();
    const { window } = audio;
    window.run('editor.set-playhead', { position: 24_000 });

    expect(await window.runAndHear('editor.add-marker')).toBe('Marker 4 added at 0:00.500.');
    expect(placed(audio.asset())).toContainEqual(['Marker 4', 24_000]);
    expect(
      [...audio.session.getSnapshot().model.state.project.markers.values()].map(
        (marker) => marker.displayName,
      ),
    ).toContain('Marker 4');

    await window.runAndHear('edit.undo');
    expect(placed(audio.asset()).map(([name]) => name)).toEqual(['Attack', 'Sustain', 'Release']);
  });

  it('select the next and previous marker from the keyboard, from the playhead or the one selected', async () => {
    const audio = await markedLoop();
    const { window } = audio;
    const [attack, sustain, release] = audio.asset().markers;
    const selected = () => window.context.selections.of(audio.entry).objects;
    window.run('editor.set-playhead', { position: 2400 });

    window.run('editor.select-next-marker');
    expect(selected()).toEqual({ kind: 'markers', ids: [sustain?.id] });
    window.run('editor.select-next-marker');
    expect(selected()).toEqual({ kind: 'markers', ids: [release?.id] });
    expect(window.run('editor.select-next-marker')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'No marker lies after the one selected.' }],
    });
    window.run('editor.select-previous-marker');
    window.run('editor.select-previous-marker');
    expect(selected()).toEqual({ kind: 'markers', ids: [attack?.id] });
  });

  it('say how to select a marker when a command needs one and a region is selected instead', async () => {
    const audio = await markedLoop();
    audio.window.run('editor.select-time', { start: 0, end: 4800 });
    await audio.window.runAndHear('region.create');
    audio.window.run('editor.select-next-region');

    expect(audio.window.run('editor.remove-markers')).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'The active selection holds no markers. Select a marker first: tap one in the strip above the lanes, or use “Select the next marker”.',
        },
      ],
    });
  });

  it('remove the selected markers as one change, which one undo restores whole', async () => {
    const audio = await markedLoop();
    const { window } = audio;
    const before = audio.asset().markers;
    window.run('editor.select-marker', { marker: before[1]?.id ?? '' });
    window.run('editor.select-marker', { marker: before[2]?.id ?? '', add: true });

    expect(await window.runAndHear('editor.remove-markers')).toBe('2 markers removed.');
    expect(placed(audio.asset())).toEqual([['Attack', 0]]);
    expect(window.context.selections.of(audio.entry).objects).toBeUndefined();

    await window.runAndHear('edit.undo');
    expect(audio.asset().markers).toEqual(before);
  });

  it('nudge the selected marker by a pixel and by a sample, each undone in turn', async () => {
    // A marker could be moved only by dragging it: without a pointer it could
    // not be moved at all.
    const audio = await markedLoop();
    const { window } = audio;
    const sustain = audio.asset().markers[1];
    if (sustain === undefined) throw new Error('No Sustain marker.');
    const entry = window.context.editorViews.entry('editor');
    if (entry === undefined) throw new Error('No view.');
    const perPixel = samplesWithin(entry.state.viewport, 1);
    window.run('editor.select-marker', { marker: sustain.id });

    await window.runAndHear('editor.nudge-markers-forward');
    await window.runAndHear('editor.nudge-markers-back-sample');
    expect(audio.asset().markers[1]?.position).toBe(sustain.position + perPixel - 1);

    await window.runAndHear('edit.undo');
    expect(audio.asset().markers[1]?.position).toBe(sustain.position + perPixel);
    await window.runAndHear('edit.undo');
    expect(audio.asset().markers[1]?.position).toBe(sustain.position);
  });

  it('nudge none of the selected markers where one would pass the start', async () => {
    const audio = await markedLoop();
    const { window } = audio;
    const [attack, sustain] = audio.asset().markers;
    if (attack === undefined || sustain === undefined) throw new Error('No markers.');
    window.run('editor.select-marker', { marker: sustain.id });
    window.run('editor.select-marker', { marker: attack.id, add: true });

    expect(window.run('editor.nudge-markers-back-sample').kind).toBe('refused');
    expect(audio.asset().markers.map((marker) => marker.position)).toEqual([0, 4800, 244_800]);

    await window.runAndHear('editor.nudge-markers-forward-sample');
    expect(audio.asset().markers.map((marker) => marker.position)).toEqual([1, 4801, 244_800]);
  });

  it('move a marker, and undo moves it back', async () => {
    const audio = await markedLoop();
    const { window } = audio;
    const [first] = audio.asset().markers;

    expect(
      await window.runAndHear('editor.move-marker', { marker: first?.id ?? '', to: 960 }),
    ).toBe('Attack moved to 0:00.020.');
    expect(audio.asset().markers[0]?.position).toBe(960);
    await window.runAndHear('edit.undo');
    expect(audio.asset().markers[0]?.position).toBe(0);
  });

  it('show a marker added in one view in every view of the asset (REQ-EDIT-061)', async () => {
    const audio = await markedLoop();
    const { window } = audio;
    window.context.editorViews.open('two', audio.asset());
    window.context.editorViews.measured('two', { width: 400, height: 300 }, audio.asset().length);

    await window.runAndHear('editor.add-marker', { view: 'two', at: 1200 });

    const shown = window.context.editorViews.entry('editor')?.asset;
    expect(
      shown === undefined ? [] : placed(window.context.assets.find(shown) ?? audio.asset()),
    ).toContainEqual(['Marker 4', 1200]);
  });

  it('refuse a test sound, saying it is not part of a project', async () => {
    const audio = await markedLoop();
    const { context } = audio.window;
    const tone = context.assets.find('test:tone-bursts');
    if (tone === undefined) throw new Error('No test sound.');
    context.editorViews.open('editor', tone);

    const refused = audio.window.run('editor.add-marker');

    expect(refused).toMatchObject({
      kind: 'refused',
      failures: [{ summary: expect.stringMatching(/not part of a project/) }],
    });
  });
});

describe('a selection holding markers (ADR-0042)', () => {
  it('makes the marker selected last the active facet, and keeps the range behind it', async () => {
    const audio = await markedLoop();
    const [attack] = audio.asset().markers;
    if (attack === undefined) throw new Error('No marker.');

    audio.window.run('editor.select-time', { start: 100, end: 200 });
    audio.window.run('editor.select-marker', { marker: attack.id });

    const set = audio.window.context.selections.of(audio.entry);
    expect(activeFacet(set)).toBe(SelectionFacet.Objects);
    expect(set.time).toEqual({ start: 100, end: 200 });
  });

  it('is acted on by its facet made last, never by one made before it', async () => {
    const audio = await markedLoop();
    const { window } = audio;
    const [attack] = audio.asset().markers;
    if (attack === undefined) throw new Error('No marker.');

    window.run('editor.select-marker', { marker: attack.id });
    window.run('editor.select-time', { start: 4800, end: 9600 });
    const removal = window.run('editor.remove-markers');
    window.run('editor.select-marker', { marker: attack.id });
    const shown = window.context.editorViews.entry('editor')?.state.viewport;
    const zoom = window.run('editor.zoom-to-selection');

    expect(removal.kind).toBe('refused');
    expect(audio.asset().markers).toHaveLength(3);
    expect(zoom.kind).toBe('refused');
    expect(window.context.editorViews.entry('editor')?.state.viewport).toEqual(shown);
  });

  it('extends from the playhead when the facet made last is not a range', async () => {
    const audio = await markedLoop();
    const { window } = audio;
    const [attack] = audio.asset().markers;
    if (attack === undefined) throw new Error('No marker.');

    window.run('editor.select-time', { start: 100, end: 200 });
    window.run('editor.select-marker', { marker: attack.id });
    window.run('editor.set-playhead', { position: 4800 });
    window.run('editor.extend-selection-forward-sample');

    expect(window.context.selections.of(audio.entry).time).toEqual({ start: 4800, end: 4801 });
  });
});

describe('the reference picture', () => {
  it('marks the frame the playhead is in on the project asset, named by its timecode', async () => {
    const audio = await markedLoop();
    const { window } = audio;
    const { context } = window;
    window.run('picture.open', { file: context.chosenFiles.offer(new File([], 'reference.webm')) });
    context.picture.element.dispatchEvent(new Event('loadeddata'));
    window.run('editor.set-playhead', { position: 48_000 + 100 });

    await window.runAndHear('picture.mark-frame');

    // At 25 frames a second a frame is 1920 samples, so the playhead is in
    // frame 25, which starts at one second.
    expect(
      audio.asset().markers.find((each) => each.displayName.startsWith('Frame')),
    ).toMatchObject({ displayName: 'Frame 00:00:01:00', position: 48_000 });
  });
});
