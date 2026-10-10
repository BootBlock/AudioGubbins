import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { sampleCount, type SampleCount } from '@audiogubbins/domain';
import { DisplayMode, ToolId, newDrawing, pointPlaced } from '@audiogubbins/editor-view';
import { scrolledBy } from '@audiogubbins/timeline';
import { WaveformPeakPyramid, peakGeometry } from '@audiogubbins/waveform';
import {
  DEFAULT_THEME_PREFERENCES,
  UNKNOWN_SYSTEM_APPEARANCE,
  resolveTheme,
} from '@audiogubbins/design-system';

import { buildShellContext } from '../testing/shell-context.js';
import { fakePanelParts } from '../testing/editor-fakes.js';
import { editorPaletteOf, editorTypeOf } from './theme-palette.js';
import { frameInputsOf, sameInputs, sceneOf } from './view-scene.js';
import { viewSources } from './view-sources.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('editor');
const THEME = resolveTheme(DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE);
const LOOK = { palette: editorPaletteOf(THEME), type: editorTypeOf(THEME) };

/** A view that shows no spectrogram. */
const NO_SPECTROGRAM = {
  spectrogram: { kind: 'not-drawn', reason: 'The view shows no spectrogram.' },
  spectrogramVersion: 0,
} as const;

/** `frames` as a boundary. */
function at(frames: number): SampleCount {
  const read = sampleCount(frames);
  if (!read.ok) throw new Error('Not a boundary.');
  return read.value;
}

/** The last frame drawn waited on peaks. */
const WAITING = { peaks: true, spectrogram: false };

describe("a view's frame inputs", () => {
  it('stay the same when another view scrolls or another asset is selected in, and change when its own view does', () => {
    const { context } = buildShellContext();
    const { stores } = fakePanelParts(context, logger);
    const [tones, surround] = context.assets.get().assets;
    if (tones === undefined || surround === undefined) throw new Error('No test assets.');
    for (const [panel, asset] of [
      ['one', tones],
      ['two', tones],
      ['three', surround],
    ] as const) {
      context.editorViews.open(panel, asset);
      context.editorViews.measured(panel, { width: 1000, height: 300 }, asset.length);
    }
    const audio = {
      pyramid: undefined,
      buckets: undefined,
      samples: undefined,
      length: tones.length,
    };
    const inputs = () => {
      const sources = viewSources(stores, 'one', LOOK);
      if (sources === undefined) throw new Error('No view.');
      return frameInputsOf(
        { ...sources, audio, ...NO_SPECTROGRAM, preview: undefined, snap: undefined },
        WAITING,
      );
    };
    const scroll = (panel: string) => {
      context.editorViews.change(panel, (state) => ({
        ...state,
        viewport: scrolledBy(state.viewport, 100, tones.length),
      }));
    };

    const before = inputs();
    scroll('two');
    context.selections.change(surround.id, (set) => ({ ...set, channels: [0] }));
    const unrelated = inputs();
    scroll('one');

    expect(sameInputs(unrelated, before)).toBe(true);
    expect(sameInputs(inputs(), before)).toBe(false);
  });

  it('count the peaks made since only while the last frame waited on some', () => {
    const { context } = buildShellContext();
    const { stores } = fakePanelParts(context, logger);
    const [tones] = context.assets.get().assets;
    if (tones === undefined) throw new Error('No test asset.');
    context.editorViews.open('one', tones);
    const sources = viewSources(stores, 'one', LOOK);
    if (sources === undefined) throw new Error('No view.');
    const pyramid = new WaveformPeakPyramid(peakGeometry(tones.length, 2));
    const scene = {
      ...sources,
      audio: { pyramid, buckets: undefined, samples: undefined, length: tones.length },
      ...NO_SPECTROGRAM,
      preview: undefined,
      snap: undefined,
    };
    const waiting = { peaks: true, spectrogram: false };
    const done = { peaks: false, spectrogram: false };
    const before = { waiting: frameInputsOf(scene, waiting), done: frameInputsOf(scene, done) };
    const [level] = pyramid.levels;
    pyramid.apply({ level: 0, first: 0, channels: [level!.channels[0]!, level!.channels[1]!] });

    expect(sameInputs(frameInputsOf(scene, waiting), before.waiting)).toBe(false);
    expect(sameInputs(frameInputsOf(scene, done), before.done)).toBe(true);
  });

  it('count the spectrogram tiles made since only while the last frame waited on some', () => {
    const { context } = buildShellContext();
    const { stores } = fakePanelParts(context, logger);
    const [tones] = context.assets.get().assets;
    if (tones === undefined) throw new Error('No test asset.');
    context.editorViews.open('one', tones);
    const sources = viewSources(stores, 'one', LOOK);
    if (sources === undefined) throw new Error('No view.');
    const scene = (version: number) => ({
      ...sources,
      audio: { pyramid: undefined, buckets: undefined, samples: undefined, length: tones.length },
      ...NO_SPECTROGRAM,
      spectrogramVersion: version,
      preview: undefined,
      snap: undefined,
    });
    const waiting = { peaks: false, spectrogram: true };
    const done = { peaks: false, spectrogram: false };

    expect(sameInputs(frameInputsOf(scene(2), waiting), frameInputsOf(scene(1), waiting))).toBe(
      false,
    );
    expect(sameInputs(frameInputsOf(scene(2), done), frameInputsOf(scene(1), done))).toBe(true);
  });
});

describe('a shape drawn from the keyboard in a frame', () => {
  it('is drawn with its points and cursor, and the selection it would leave, and redrawn as it changes', () => {
    const { context } = buildShellContext();
    const { stores } = fakePanelParts(context, logger);
    const [tones] = context.assets.get().assets;
    if (tones === undefined) throw new Error('No test asset.');
    context.editorViews.open('one', tones);
    context.editorViews.measured('one', { width: 1000, height: 300 }, tones.length);
    context.editorViews.change('one', (state) => ({
      ...state,
      displayMode: DisplayMode.Spectrogram,
      tool: ToolId.SpectralLasso,
    }));
    let drawing = newDrawing(1);
    for (const [position, rung] of [
      [10_000, 150],
      [60_000, 160],
      [90_000, 60],
    ] as const) {
      drawing = pointPlaced({ ...drawing, rung }, at(position));
    }
    context.editorViews.draw('one', () => drawing);
    const audio = {
      pyramid: undefined,
      buckets: undefined,
      samples: undefined,
      length: tones.length,
    };
    const sourcesOf = () => {
      const sources = viewSources(stores, 'one', LOOK);
      if (sources === undefined) throw new Error('No view.');
      return { ...sources, audio, ...NO_SPECTROGRAM, preview: undefined, snap: undefined };
    };
    const before = frameInputsOf(sourcesOf(), WAITING);
    const scene = sceneOf(sourcesOf(), 1000, 300, 1);

    expect(scene.drawing?.channel).toBe(1);
    expect(scene.drawing?.points).toHaveLength(3);
    expect(scene.preview?.kind === 'spectral-shape' && scene.preview.drawn.shape.kind).toBe(
      'polygon',
    );
    context.editorViews.draw('one', (each) => each && { ...each, placed: [] });
    expect(sameInputs(frameInputsOf(sourcesOf(), WAITING), before)).toBe(false);
    expect(sceneOf(sourcesOf(), 1000, 300, 1).preview).toBeUndefined();
  });

  it('is not drawn while a tool that draws no spectral shape is in use', () => {
    const { context } = buildShellContext();
    const { stores } = fakePanelParts(context, logger);
    const [tones] = context.assets.get().assets;
    if (tones === undefined) throw new Error('No test asset.');
    context.editorViews.open('one', tones);
    context.editorViews.measured('one', { width: 1000, height: 300 }, tones.length);
    context.editorViews.change('one', (state) => ({
      ...state,
      displayMode: DisplayMode.Spectrogram,
    }));
    context.editorViews.draw('one', () => pointPlaced(newDrawing(0), at(1_000)));
    const sources = viewSources(stores, 'one', LOOK);
    if (sources === undefined) throw new Error('No view.');
    const audio = {
      pyramid: undefined,
      buckets: undefined,
      samples: undefined,
      length: tones.length,
    };
    const scene = sceneOf(
      { ...sources, audio, ...NO_SPECTROGRAM, preview: undefined, snap: undefined },
      1000,
      300,
      1,
    );
    expect(scene.drawing).toBeUndefined();
  });
});
