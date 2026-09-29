import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
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
import { frameInputsOf, sameInputs } from './view-scene.js';
import { viewSources } from './view-sources.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('editor');
const THEME = resolveTheme(DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE);
const LOOK = { palette: editorPaletteOf(THEME), type: editorTypeOf(THEME) };

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
      context.editorViews.measured(panel, 1000, asset.length);
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
      return frameInputsOf({ ...sources, audio, preview: undefined, snap: undefined }, true);
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
      preview: undefined,
      snap: undefined,
    };
    const before = { waiting: frameInputsOf(scene, true), done: frameInputsOf(scene, false) };
    const [level] = pyramid.levels;
    pyramid.apply({ level: 0, first: 0, channels: [level!.channels[0]!, level!.channels[1]!] });

    expect(sameInputs(frameInputsOf(scene, true), before.waiting)).toBe(false);
    expect(sameInputs(frameInputsOf(scene, false), before.done)).toBe(true);
  });
});
