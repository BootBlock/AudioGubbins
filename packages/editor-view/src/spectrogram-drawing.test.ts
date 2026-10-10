/**
 * A spectrogram lane drawn from its host's tiles: the level and the tiles a
 * view shows, one field per tile in view placed column by column on the
 * timeline, rows read through the lane's frequency axis, a tile not yet held
 * drawn as pending and an older revision's drawn dimmed until it is replaced,
 * the display range and ramp mapping the bytes, the reason a lane is not
 * drawn, the selection drawn over it on the same mapping, and the same frame
 * from a composer made again. The last case draws the tiles the real worker
 * core makes of a tone.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { MaskEffect, NO_FEATHER, type SpectralMask } from '@audiogubbins/domain';
import type { FieldBatch, RenderBatch, RenderFrame } from '@audiogubbins/renderer';
import {
  DEFAULT_SPECTROGRAM_CONFIG,
  SpectrogramHost,
  levelDecibels,
  type ShownTile,
  type SpectralTile,
  type SpectrogramGeometry,
  type SpectrogramHandle,
} from '@audiogubbins/spectral-analysis';
import {
  LocalSpectrogramWorker,
  MemoryTileCache,
  memorySubject,
  turn,
} from '@audiogubbins/spectral-analysis/testing';
import {
  EMPTY_SELECTION,
  pixelOf,
  samplesPerPixel,
  viewportAtStart,
  withSpectralMask,
} from '@audiogubbins/timeline';

import { FrameComposer } from './frame-composer.js';
import { frequencyAt } from './frequency-axis.js';
import type { Lane } from './lane-layout.js';
import { shownSpectrogram, type KnownSpectrogram } from './spectrogram-drawing.js';
import { PALETTE, at, scene } from './testing/scene.js';
import {
  DisplayMode,
  SpectrogramColours,
  type EditorViewState,
  type SpectralSettings,
} from './view-state.js';

const RATE = 48_000;
const BINS = DEFAULT_SPECTROGRAM_CONFIG.windowLength / 2 + 1;
/** Hertz between two bins of the default window at the test's rate. */
const SPACING = RATE / DEFAULT_SPECTROGRAM_CONFIG.windowLength;

/** A linear axis that runs past half the test's rate. */
const LINEAR_PAST_HALF_THE_RATE: SpectralSettings = {
  frequencyScale: 'linear',
  lowest: 0,
  highest: 30_000,
};

let host: SpectrogramHost | undefined;

afterEach(() => {
  host?.dispose();
  host = undefined;
});

/** A host over the real worker core, kept in memory. */
function testHost(): SpectrogramHost {
  host = new SpectrogramHost({
    createWorker: () => new LocalSpectrogramWorker(),
    cache: new MemoryTileCache(),
    report: () => undefined,
  });
  return host;
}

/** A handle on a sound of `frames` frames of `channels` channels, of silence unless given. */
function handleOf(
  frames: number,
  channels = 2,
  audio?: readonly Float32Array[],
): SpectrogramHandle {
  const sound = audio ?? Array.from({ length: channels }, () => new Float32Array(frames));
  return testHost().open(memorySubject('sound', sound));
}

function geometryOf(frames: number, channels = 2): SpectrogramGeometry {
  return handleOf(frames, channels).geometry(DEFAULT_SPECTROGRAM_CONFIG);
}

function spectrogram(state: EditorViewState): EditorViewState {
  return { ...state, displayMode: DisplayMode.Spectrogram };
}

/** A tile of `geometry` at a place, every byte `level`, of the given revision. */
function tileAt(
  geometry: SpectrogramGeometry,
  place: { readonly channel: number; readonly level: number; readonly index: number },
  revision = '1',
  level = 200,
): SpectralTile {
  const columns = Math.min(256, (geometry.levels[place.level]?.columns ?? 0) - place.index * 256);
  return {
    key: { identity: 'sound', revision, config: geometry.config, ...place },
    columns,
    bins: geometry.bins,
    values: new Uint8Array(columns * geometry.bins).fill(level),
  };
}

/** What is known where every tile is held, current unless `stale` says. */
function known(
  geometry: SpectrogramGeometry,
  held: (channel: number, level: number, index: number) => ShownTile | undefined = (
    channel,
    level,
    index,
  ) => ({ tile: tileAt(geometry, { channel, level, index }), stale: false }),
): KnownSpectrogram {
  return { kind: 'tiles', geometry, sampleRate: RATE, tile: held };
}

function fields(frame: RenderFrame, lane = 0): FieldBatch[] {
  return (frame.layers[lane]?.batches ?? []).filter(
    (batch): batch is FieldBatch => batch.kind === 'field',
  );
}

function tileFields(frame: RenderFrame, lane = 0): FieldBatch[] {
  return fields(frame, lane).filter((batch) => batch.field.key.startsWith('spectrogram-tile:'));
}

function rectanglesOf(batches: readonly RenderBatch[], colour: readonly number[]): number {
  return batches
    .filter((batch) => batch.kind === 'rectangles' && batch.colour === colour)
    .reduce((sum, batch) => sum + (batch.kind === 'rectangles' ? batch.count : 0), 0);
}

function texts(frame: RenderFrame): readonly string[] {
  return frame.layers.flatMap((layer) =>
    layer.batches.flatMap((batch) =>
      batch.kind === 'text' ? batch.labels.map((label) => label.text) : [],
    ),
  );
}

function laneOf(frame: RenderFrame, index = 0): Lane {
  const clip = frame.layers[index]?.clip;
  if (clip === undefined) throw new Error('No lane.');
  return { channel: index, kind: 'spectrogram', area: clip };
}

/** The field column device column `index` reads, by `FieldBatch`'s rule. */
function columnRead(batch: FieldBatch, index: number, ratio: number): number {
  const centre = (index + 0.5) / ratio;
  const { from, to } = batch.columns;
  return Math.floor(from + ((centre - batch.at.x) * (to - from)) / batch.at.width);
}

describe('which tiles a view shows', () => {
  it('is the coarsest level whose columns are no wider than a device pixel, level 0 past it', () => {
    const geometry = geometryOf(4_800_000);
    const at1024 = (state: EditorViewState): EditorViewState =>
      spectrogram({ ...state, viewport: viewportAtStart(samplesPerPixel(1024), 1000) });
    const state = at1024(scene({ length: 4_800_000 }).state);

    // A level-1 column spans 1024 frames: a pixel's worth at one device pixel a CSS pixel.
    expect(shownSpectrogram(state, geometry, at(4_800_000), 1)).toEqual({
      config: DEFAULT_SPECTROGRAM_CONFIG,
      level: 1,
      channels: [0, 1],
      first: 0,
      last: 3,
      centre: 512_000,
    });
    expect(shownSpectrogram(state, geometry, at(4_800_000), 2)?.level).toBe(0);
    const zoomedIn = {
      ...state,
      viewport: viewportAtStart(samplesPerPixel(1), 1000),
    };
    expect(shownSpectrogram(zoomedIn, geometry, at(4_800_000), 1)).toMatchObject({
      level: 0,
      first: 0,
      last: 0,
    });
  });

  it('is of each channel a spectrogram lane is drawn for, and of none in the waveform display', () => {
    const geometry = geometryOf(100_000, 3);
    const base = scene({ channels: 3 }).state;
    expect(shownSpectrogram(base, geometry, at(100_000), 1)).toBeUndefined();
    for (const displayMode of [DisplayMode.Spectrogram, DisplayMode.Stacked, DisplayMode.Overlay]) {
      const state = { ...base, displayMode, hiddenChannels: [1] };
      expect(shownSpectrogram(state, geometry, at(100_000), 1)?.channels).toEqual([0, 2]);
    }
  });
});

describe('a spectrogram lane', () => {
  it('draws one field for each tile in view, each column where the timeline places its frames', () => {
    const geometry = geometryOf(480_000);
    const viewed = (state: EditorViewState): EditorViewState =>
      spectrogram({
        ...state,
        viewport: { ...viewportAtStart(samplesPerPixel(64), 1000), start: at(200_000) },
      });
    for (const pixelRatio of [1, 2]) {
      const frame = new FrameComposer().compose(
        scene({ length: 480_000, state: viewed, spectrogram: known(geometry), pixelRatio }),
      );
      const { viewport } = viewed(scene({}).state);
      // 200,000 to 264,000 frames: the second and third tiles of 131,072 frames.
      const drawn = tileFields(frame);
      expect(drawn.map((batch) => batch.field.key)).toEqual([
        expect.stringContaining('\u00000\u00000\u00001\u00001'),
        expect.stringContaining('\u00000\u00000\u00002\u00001'),
      ]);
      for (const [offset, batch] of drawn.entries()) {
        const start = (offset + 1) * 131_072;
        expect(batch.at.x).toBe(pixelOf(viewport, start));
        expect(batch.columns).toEqual({ from: 0, to: 256 });
        for (let index = 0; index < 1000 * pixelRatio; index += 1) {
          const frameAt = 200_000 + ((index + 0.5) / pixelRatio) * 64;
          const column = Math.floor((frameAt - start) / 512);
          if (column < 0 || column >= 256) continue;
          expect(columnRead(batch, index, pixelRatio)).toBe(column);
        }
      }
    }
  });

  it('ends the last tile at the end of the sound, its last column no wider than what is left', () => {
    const geometry = geometryOf(480_000);
    const frame = new FrameComposer().compose(
      scene({ length: 480_000, state: spectrogram, spectrogram: known(geometry) }),
    );
    const last = tileFields(frame).at(-1);
    // The fourth tile starts at 393,216 and holds 170 columns, the last 256 frames past the end.
    expect(last?.columns).toEqual({ from: 0, to: (480_000 - 393_216) / 512 });
    expect(last?.at.x).toBe(393_216 / 480);
    expect(last?.at.width).toBeCloseTo((480_000 - 393_216) / 480, 9);
  });

  it('reads at each device row the bin nearest the frequency its axis shows there', () => {
    const geometry = geometryOf(100_000);
    const axes: readonly SpectralSettings[] = [
      { frequencyScale: 'logarithmic', lowest: 20, highest: 20_000 },
      LINEAR_PAST_HALF_THE_RATE,
    ];
    for (const axis of axes) {
      for (const pixelRatio of [1, 1.5]) {
        const frame = new FrameComposer().compose(
          scene({
            state: (state) => ({ ...spectrogram(state), spectral: axis }),
            spectrogram: known(geometry),
            pixelRatio,
          }),
        );
        const lane = laneOf(frame);
        const [batch] = tileFields(frame);
        if (batch === undefined) throw new Error('No tile drawn.');
        const first = Math.ceil(lane.area.y * pixelRatio - 0.5);
        expect(batch.rows.length).toBe(
          Math.ceil((lane.area.y + lane.area.height) * pixelRatio - 0.5) - first,
        );
        for (const [row, read] of batch.rows.entries()) {
          const frequency = frequencyAt(lane, (first + row + 0.5) / pixelRatio, axis);
          expect(Math.floor(read)).toBe(Math.round(frequency / SPACING));
        }
      }
    }
    // Past half the rate a row reads no bin, so the lane's background shows there.
    const linear = new FrameComposer().compose(
      scene({
        state: (state) => ({ ...spectrogram(state), spectral: LINEAR_PAST_HALF_THE_RATE }),
        spectrogram: known(geometry),
      }),
    );
    const [top] = tileFields(linear);
    expect(Math.floor(top?.rows[0] ?? 0)).toBeGreaterThanOrEqual(BINS);
  });

  it('draws a tile not yet held as pending, and waits for it', () => {
    const geometry = geometryOf(480_000);
    const composer = new FrameComposer();
    const frame = composer.compose(
      scene({
        length: 480_000,
        state: spectrogram,
        spectrogram: known(geometry, (channel, level, index) =>
          index === 1
            ? undefined
            : { tile: tileAt(geometry, { channel, level, index }), stale: false },
        ),
      }),
    );
    expect(tileFields(frame)).toHaveLength(3);
    expect(rectanglesOf(frame.layers[0]?.batches ?? [], PALETTE.pending)).toBe(1);
    expect(composer.spectrogramWaiting).toBe(true);

    const settled = new FrameComposer();
    settled.compose(scene({ length: 480_000, state: spectrogram, spectrogram: known(geometry) }));
    expect(settled.spectrogramWaiting).toBe(false);
  });

  it('draws an older revision’s tile dimmed until the current one replaces it', () => {
    const geometry = geometryOf(100_000);
    const composer = new FrameComposer();
    const stale = composer.compose(
      scene({
        state: spectrogram,
        spectrogram: known(geometry, (channel, level, index) => ({
          tile: tileAt(geometry, { channel, level, index }, '0'),
          stale: true,
        })),
      }),
    );
    expect(composer.spectrogramWaiting).toBe(true);
    const current = new FrameComposer().compose(
      scene({ state: spectrogram, spectrogram: known(geometry) }),
    );
    const [old] = tileFields(stale);
    const [now] = tileFields(current);
    if (old === undefined || now === undefined) throw new Error('No tile drawn.');
    expect(old.ramp.key).not.toBe(now.ramp.key);
    // The loudest colour, mixed halfway with the lane's background.
    const last = (PALETTE.spectrogramRamps.theme.at(-1) ?? [0, 0, 0, 1])[1];
    const background = PALETTE.spectrogramBackground[1];
    expect(now.ramp.colours[255 * 4 + 1]).toBe(Math.round(last * 255));
    expect(old.ramp.colours[255 * 4 + 1]).toBe(Math.round((last + (background - last) / 2) * 255));
  });

  it('maps a byte through the display range to the view’s ramp, the tile unchanged', () => {
    const geometry = geometryOf(100_000);
    const draw = (state: EditorViewState): FieldBatch => {
      const [batch] = tileFields(
        new FrameComposer().compose(
          scene({ state: () => spectrogram(state), spectrogram: known(geometry) }),
        ),
      );
      if (batch === undefined) throw new Error('No tile drawn.');
      return batch;
    };
    const base = scene({}).state;
    const ranged = {
      ...base,
      spectrogram: { ...base.spectrogram, range: { floor: -90, ceiling: -30 } },
    };
    const batch = draw(ranged);
    const green = (byte: number): number => batch.ramp.colours[byte * 4 + 1] ?? -1;
    const byteOf = (decibels: number): number => (decibels + 127.5) * 2;
    expect(levelDecibels(byteOf(-90))).toBe(-90);
    // At and below the floor the first colour, at and above the ceiling the last.
    expect(green(0)).toBe(0);
    expect(green(byteOf(-90))).toBe(0);
    expect(green(byteOf(-30))).toBe(255);
    expect(green(255)).toBe(255);
    // Halfway up the range, the ramp's middle colour: entry 128 of 256.
    expect(green(byteOf(-60))).toBe(128);
    expect(Array.from(batch.ramp.colours.filter((_, at) => at % 4 === 3))).toEqual(
      Array.from({ length: 256 }, () => 255),
    );

    const grey = draw({
      ...ranged,
      spectrogram: { ...ranged.spectrogram, colours: SpectrogramColours.Greyscale },
    });
    expect(grey.ramp.key).not.toBe(batch.ramp.key);
    expect(grey.ramp.colours[255 * 4 + 2]).toBe(255);
    expect(grey.field.key).toBe(batch.field.key);
    expect(grey.field.values).toEqual(batch.field.values);
    expect(draw(base).ramp.key).not.toBe(batch.ramp.key);
  });

  it('says why where its spectrogram cannot be drawn', () => {
    const frame = new FrameComposer().compose(
      scene({
        channels: 1,
        state: spectrogram,
        spectrogram: { kind: 'not-drawn', reason: 'The spectrogram worker stopped: it ran out.' },
      }),
    );
    expect(tileFields(frame)).toEqual([]);
    expect(texts(frame)).toEqual(
      expect.arrayContaining([
        '100 Hz',
        '1 kHz',
        '10 kHz',
        'The spectrogram worker stopped: it ran out.',
      ]),
    );
  });

  it('draws the selection over its tiles on the same frequency axis and timeline', () => {
    const geometry = geometryOf(100_000);
    const band = { low: 1_000, high: 4_000 };
    const mask: SpectralMask = {
      shapes: [
        {
          kind: 'rectangle',
          effect: MaskEffect.Add,
          range: { start: at(25_600), end: at(51_200) },
          band,
        },
      ],
      feather: NO_FEATHER,
    };
    for (const spectral of [
      { frequencyScale: 'logarithmic', lowest: 20, highest: 20_000 },
      { frequencyScale: 'linear', lowest: 0, highest: 24_000 },
    ] as const) {
      const frame = new FrameComposer().compose(
        scene({
          state: (state) => ({ ...spectrogram(state), spectral }),
          spectrogram: known(geometry),
          selection: withSpectralMask(EMPTY_SELECTION, mask),
        }),
      );
      const [tile] = tileFields(frame);
      const weight = fields(frame).find((batch) => batch.field.key.startsWith('spectral-mask'));
      if (tile === undefined || weight === undefined) throw new Error('Nothing drawn.');
      // The selection is drawn after the tiles, over them.
      expect(fields(frame).indexOf(weight)).toBeGreaterThan(fields(frame).indexOf(tile));
      const lane = laneOf(frame);
      const top = Math.ceil(lane.area.y - 0.5);
      // Every row the selection weighs fully reads a bin within its band.
      const fromTop = Math.round(weight.at.y) - top;
      for (let row = 0; row < weight.field.height; row += 1) {
        const middle =
          weight.field.values[row * weight.field.width + Math.floor(weight.field.width / 2)];
        if (middle !== 255) continue;
        const bin = Math.floor(tile.rows[fromTop + row] ?? Number.NaN);
        expect(bin * SPACING).toBeGreaterThanOrEqual(band.low - SPACING);
        expect(bin * SPACING).toBeLessThanOrEqual(band.high + SPACING);
      }
      // The selection's first column is where the tile's 51st column begins: 25,600 frames.
      expect(columnRead(tile, Math.round(weight.at.x), 1)).toBe(50);
    }
  });

  it('is composed again the same by a new composer, as after a renderer is reset', () => {
    const geometry = geometryOf(480_000);
    const given = scene({
      length: 480_000,
      state: spectrogram,
      spectrogram: known(geometry),
      selection: withSpectralMask(EMPTY_SELECTION, {
        shapes: [
          {
            kind: 'rectangle',
            effect: MaskEffect.Add,
            range: { start: at(10_000), end: at(90_000) },
            band: { low: 300, high: 3_000 },
          },
        ],
        feather: NO_FEATHER,
      }),
    });
    const text = (frame: RenderFrame): string =>
      JSON.stringify(frame, (key, value: unknown) =>
        key === 'values' && value instanceof Uint8Array
          ? value.length
          : value instanceof Float32Array || value instanceof Uint8Array
            ? [...value]
            : key === 'key' && typeof value === 'string'
              ? value.replace(/spectral-mask-weight:\d+/, 'spectral-mask-weight')
              : value,
      );
    expect(text(new FrameComposer().compose(given))).toBe(text(new FrameComposer().compose(given)));
  });
});

describe('a spectrogram lane drawn from the worker', () => {
  it('draws the tiles the worker makes of a tone, loud at the tone’s bin and quiet away from it', async () => {
    const frames = 48_000;
    const tone = Float32Array.from(
      { length: frames },
      (_, index) => 0.5 * Math.sin((2 * Math.PI * 3_000 * index) / RATE),
    );
    const handle = handleOf(frames, 1, [tone]);
    const config = DEFAULT_SPECTROGRAM_CONFIG;
    const state = (each: EditorViewState): EditorViewState => ({
      ...spectrogram(each),
      spectral: { frequencyScale: 'linear', lowest: 0, highest: 24_000 },
    });
    const view = state(scene({ length: frames, channels: 1 }).state);
    const geometry = handle.geometry(config);
    const shown = shownSpectrogram(view, geometry, at(frames), 1);
    handle.show(shown);
    for (let tries = 0; tries < 400 && handle.tile(config, 0, 0, 0) === undefined; tries += 1) {
      await turn();
    }
    const frame = new FrameComposer().compose(
      scene({
        length: frames,
        channels: 1,
        state,
        spectrogram: {
          kind: 'tiles',
          geometry,
          sampleRate: RATE,
          tile: (channel, level, index) => handle.tile(config, channel, level, index),
        },
      }),
    );
    const [batch] = tileFields(frame);
    if (batch === undefined) throw new Error('No tile drawn.');
    const { values, width } = batch.field;
    const middle = Math.floor(width / 2);
    const level = (bin: number): number => values[bin * width + middle] ?? -1;
    const toneBin = 3_000 / SPACING;
    // A sine at half of full scale lies 6 dB below it, at byte (127.5 - 6) * 2.
    expect(level(toneBin)).toBe(242);
    // A hundred bins away the window lets through more than 60 dB less.
    expect(level(toneBin + 100)).toBeLessThan(242 - 120);
    // The device row at the height 3 kHz is drawn at reads a bin of the tone's main lobe.
    const lane = laneOf(frame);
    const row = Math.floor(lane.area.height * (1 - 3_000 / 24_000));
    expect(Math.abs(Math.floor(batch.rows[row] ?? 0) - toneBin)).toBeLessThanOrEqual(2);
    expect(level(Math.floor(batch.rows[row] ?? 0))).toBeGreaterThan(200);
    handle.release();
  });
});
