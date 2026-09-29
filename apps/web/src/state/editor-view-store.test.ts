import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { DisplayMode, ToolId } from '@audiogubbins/editor-view';
import { SnapKind, StandardFrameRates, pixelsPerSample } from '@audiogubbins/timeline';

import { testAssets } from '../assets/test-assets.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { EDITOR_VIEWS_KEY, createEditorViewStore } from './editor-view-store.js';
import { createStateStorage, type KeyValueStorage } from './state-storage.js';

const [TONES, , , LONG] = expectSuccess(testAssets());
if (TONES === undefined || LONG === undefined) throw new Error('No test assets.');

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('editor');

/** A store over `raw`, writing at once. */
function storeOver(raw: KeyValueStorage) {
  return createEditorViewStore(
    createStateStorage(raw, logger, () => undefined),
    logger,
    (write) => {
      write();
    },
  );
}

describe('the editor views', () => {
  it('fit a new view to its asset once its width is measured', () => {
    const views = storeOver(ephemeralStorage());
    views.open('editor', TONES);
    views.measured('editor', 1000, TONES.length);

    expect(views.entry('editor')?.state.viewport).toMatchObject({
      start: 0,
      width: 1000,
      zoom: { kind: 'samples-per-pixel', samples: 480 },
    });
  });

  it('keep each view between visits, field by field, without its width', () => {
    const raw = ephemeralStorage();
    const first = storeOver(raw);
    first.open('editor', LONG);
    first.measured('editor', 800, LONG.length);
    first.change('editor', (state) => ({
      ...state,
      viewport: { ...state.viewport, start: state.viewport.start, zoom: pixelsPerSample(8) },
      displayMode: DisplayMode.Stacked,
      tool: ToolId.Razor,
      hiddenChannels: [1],
      timeFormat: { kind: 'timecode', frames: StandardFrameRates.ntscDropFrame },
      snapping: { ...state.snapping, kinds: new Set([SnapKind.Marker]) },
    }));
    first.focus('editor');

    const again = storeOver(raw);
    const kept = again.entry('editor');
    expect(kept?.asset).toBe(LONG.id);
    expect(kept?.state).toMatchObject({
      displayMode: DisplayMode.Stacked,
      tool: ToolId.Razor,
      hiddenChannels: [1],
      timeFormat: { kind: 'timecode', frames: StandardFrameRates.ntscDropFrame },
      viewport: { zoom: { kind: 'pixels-per-sample', pixels: 8 }, width: 0 },
    });
    expect([...(kept?.state.snapping.kinds ?? [])]).toEqual([SnapKind.Marker]);
    expect(again.get().focused).toBe('editor');
  });

  it('take a stored field that is not usable as its default, and keep the rest', () => {
    const raw = ephemeralStorage();
    raw.write(
      EDITOR_VIEWS_KEY,
      JSON.stringify({
        schemaVersion: 1,
        views: {
          editor: { asset: TONES.id, tool: 'chainsaw', amplitude: 3, displayMode: 'overlay' },
          broken: { tool: 'hand' },
        },
      }),
    );

    const views = storeOver(raw);
    expect(views.entry('editor')?.state).toMatchObject({
      tool: ToolId.Select,
      amplitude: 1,
      displayMode: DisplayMode.Overlay,
    });
    expect(views.entry('broken')).toBeUndefined();
  });

  it('start afresh from views written for another version', () => {
    const raw = ephemeralStorage();
    raw.write(EDITOR_VIEWS_KEY, JSON.stringify({ schemaVersion: 99, views: { editor: {} } }));

    expect(storeOver(raw).get().views.size).toBe(0);
  });

  it('forget the view of a panel that is closed, and the focus on it', () => {
    const views = storeOver(ephemeralStorage());
    views.open('one', TONES);
    views.open('two', TONES);
    views.focus('two');

    views.forgetClosed(['one']);

    expect([...views.get().views.keys()]).toEqual(['one']);
    expect(views.get().focused).toBeUndefined();
  });

  it('write a burst of changes once', () => {
    const raw = ephemeralStorage();
    let writes = 0;
    const counting: KeyValueStorage = {
      ...raw,
      write: (key, value) => {
        writes += 1;
        raw.write(key, value);
      },
    };
    const waiting: (() => void)[] = [];
    const views = createEditorViewStore(
      createStateStorage(counting, logger, () => undefined),
      logger,
      (write) => waiting.push(write),
    );
    views.open('editor', TONES);
    for (let step = 0; step < 10; step += 1) {
      views.change('editor', (state) => ({ ...state, amplitude: step % 2 === 0 ? 2 : 1 }));
    }
    for (const write of waiting) write();

    expect(waiting).toHaveLength(1);
    expect(writes).toBe(1);
  });
});
