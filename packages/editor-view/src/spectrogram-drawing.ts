/**
 * Drawing a spectrogram lane from the tiles its host holds (ADR-0080,
 * ADR-0082): one field batch per tile in view, through the view's ramp over
 * its display range, its columns placed by the timeline's exact conversions
 * (ADR-0041) and its rows by the inverse of the lane's frequency mapping.
 *
 * Which tiles a view shows is one account, `shownSpectrogram`, read by the
 * application to tell the host what to make and by the lane to draw it, so
 * what is asked for and what is drawn cannot differ. The level is the
 * coarsest whose columns are no wider than a device pixel, level 0 stretched
 * past it. A tile not yet held is drawn as pending, as peaks are; one of an
 * older revision is drawn, dimmed, until the current revision's replaces it,
 * so an edit never empties the lane. A lane whose spectrogram cannot be drawn
 * says why.
 *
 * A device row reads the bin nearest the frequency the axis shows at its
 * centre, worked out by `frequencyAt`, the same function the mask's overlay
 * and the spectral tools read a height by, so a tile and the selection drawn
 * over it share one mapping at every zoom and after every renderer reset. The
 * rows of a lane and the ramps are made again only where what they are made
 * from changes (G4, G5); a tile's field keeps its key, so a backend draws it
 * from the texture it holds, and no field is given for a tile out of view.
 */

import type { SampleCount } from '@audiogubbins/domain';
import type {
  Colour,
  ColourRamp,
  FieldBatch,
  RenderBatch,
  ScalarField,
  TextLabel,
} from '@audiogubbins/renderer';
import {
  levelDecibels,
  levelFor,
  tileKeyText,
  tileSpan,
  tilesOver,
  type FrameRange,
  type LevelGeometry,
  type ShownTile,
  type SpectralTile,
  type SpectrogramGeometry,
  type SpectrogramView,
} from '@audiogubbins/spectral-analysis';
import { pixelOf, visibleRange, type ViewportState } from '@audiogubbins/timeline';

import type { BuilderPool } from './batch-buffers.js';
import type { EditorPalette, EditorType } from './editor-palette.js';
import { frequencyAt } from './frequency-axis.js';
import type { Lane } from './lane-layout.js';
import {
  DisplayMode,
  visibleChannels,
  type EditorViewState,
  type SpectralSettings,
  type SpectrogramDisplay,
} from './view-state.js';

/**
 * What is known of a view's spectrogram: the host's tiles of the sound at the
 * view's settings, or why it cannot be drawn, which its lanes say.
 */
export type KnownSpectrogram =
  | {
      readonly kind: 'tiles';
      /** The sound's pyramid at the view's analysis settings. */
      readonly geometry: SpectrogramGeometry;
      /** The sound's rate, which places a bin's frequency. */
      readonly sampleRate: number;
      /** The tile drawn at a place of the pyramid, or `undefined` while it is pending. */
      readonly tile: (channel: number, level: number, index: number) => ShownTile | undefined;
    }
  | { readonly kind: 'not-drawn'; readonly reason: string };

/** How much of the lane's background a stale tile's colours are mixed with. */
const STALE_DIMMING = 0.5;

/** Frames a device pixel spans at `viewport` drawn at `pixelRatio`, below one where a sample is wider. */
function framesPerDevicePixel(viewport: ViewportState, pixelRatio: number): number {
  return viewport.zoom.kind === 'samples-per-pixel'
    ? viewport.zoom.samples / pixelRatio
    : 1 / (viewport.zoom.pixels * pixelRatio);
}

/** The channels a view at `state` draws a spectrogram of, of a sound of `channelCount`. */
function spectrogramChannels(state: EditorViewState, channelCount: number): readonly number[] {
  return state.displayMode === DisplayMode.Waveform ? [] : visibleChannels(state, channelCount);
}

/**
 * The tiles a view at `state`, drawn at `pixelRatio`, shows of a sound of
 * `length` frames whose pyramid is `geometry`: one level's, of every channel
 * it draws a spectrogram lane for, around the middle of what it shows; or
 * `undefined` where it shows none.
 */
export function shownSpectrogram(
  state: EditorViewState,
  geometry: SpectrogramGeometry,
  length: SampleCount,
  pixelRatio: number,
): SpectrogramView | undefined {
  const channels = spectrogramChannels(state, geometry.channels);
  const level =
    geometry.levels[levelFor(geometry, framesPerDevicePixel(state.viewport, pixelRatio))];
  if (channels.length === 0 || level === undefined) return undefined;
  const range: FrameRange = visibleRange(state.viewport, length);
  const tiles = tilesOver(level, range);
  if (tiles === undefined) return undefined;
  return {
    config: geometry.config,
    level: level.level,
    channels,
    first: tiles.first,
    last: tiles.last,
    centre: Math.floor((range.start + range.end) / 2),
  };
}

/** The first device pixel whose centre is at or after `edge`, in CSS pixels. */
function firstCentre(edge: number, ratio: number): number {
  return Math.ceil(edge * ratio - 0.5);
}

/** How a lane's spectrogram is drawn. */
export interface SpectrogramStyle {
  readonly viewport: ViewportState;
  readonly pixelRatio: number;
  readonly axis: SpectralSettings;
  readonly display: SpectrogramDisplay;
  readonly palette: EditorPalette;
  readonly type: EditorType;
}

/** What a lane's row map was made from, compared field by field. */
interface RowSource {
  readonly top: number;
  readonly height: number;
  readonly ratio: number;
  readonly axis: SpectralSettings;
  /** Hertz between two bins. */
  readonly spacing: number;
}

function sameRows(one: RowSource, other: RowSource): boolean {
  return (
    one.top === other.top &&
    one.height === other.height &&
    one.ratio === other.ratio &&
    one.spacing === other.spacing &&
    one.axis.frequencyScale === other.axis.frequencyScale &&
    one.axis.lowest === other.axis.lowest &&
    one.axis.highest === other.axis.highest
  );
}

/**
 * The bin each device row of `lane` reads, top to bottom: the one nearest the
 * frequency the axis shows at the row's centre, as the middle of its cell, so
 * the floor a backend takes of it is that bin however the entry is rounded.
 */
function rowMap(lane: Lane, source: RowSource): Float32Array {
  const { ratio } = source;
  const first = firstCentre(lane.area.y, ratio);
  const count = firstCentre(lane.area.y + lane.area.height, ratio) - first;
  const rows = new Float32Array(Math.max(0, count));
  for (let row = 0; row < rows.length; row += 1) {
    const frequency = frequencyAt(lane, (first + row + 0.5) / ratio, source.axis);
    rows[row] = Math.round(frequency / source.spacing) + 0.5;
  }
  return rows;
}

/** `one` mixed with `other` by `share` of `other`, opaque. */
function mixed(one: Colour, other: Colour, share: number): readonly [number, number, number] {
  return [
    one[0] + (other[0] - one[0]) * share,
    one[1] + (other[1] - one[1]) * share,
    one[2] + (other[2] - one[2]) * share,
  ];
}

/** Two hexadecimal digits for each byte. */
const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/**
 * The ramp a tile's bytes are drawn through: each byte's level placed in the
 * display range, and the ramp's colour at that place, mixed with `dimmed` for
 * a stale tile. Its key is its colours written out, so equal keys hold equal
 * colours whichever view made them, as a backend that keeps ramps by key
 * needs.
 */
function rampOf(
  colours: readonly Colour[],
  display: SpectrogramDisplay,
  dimmed: Colour | undefined,
): ColourRamp {
  const { floor, ceiling } = display.range;
  const bytes = new Uint8Array(1024);
  const last = colours.length - 1;
  for (let value = 0; value < 256; value += 1) {
    const share = Math.min(1, Math.max(0, (levelDecibels(value) - floor) / (ceiling - floor)));
    const colour = colours[Math.round(share * last)] ?? colours[last];
    if (colour === undefined) continue;
    const [red, green, blue] = dimmed === undefined ? colour : mixed(colour, dimmed, STALE_DIMMING);
    bytes[value * 4] = Math.round(red * 255);
    bytes[value * 4 + 1] = Math.round(green * 255);
    bytes[value * 4 + 2] = Math.round(blue * 255);
    bytes[value * 4 + 3] = 255;
  }
  let key = 'spectrogram:';
  for (const byte of bytes) key += HEX[byte] ?? '';
  return { key, colours: bytes };
}

/** Why `lane`'s spectrogram is not drawn, written in its middle. */
function reasonLabel(lane: Lane, reason: string, style: SpectrogramStyle): TextLabel {
  const { area } = lane;
  return {
    text: reason,
    x: area.x + area.width / 2,
    y: area.y + area.height / 2,
    colour: style.palette.quietText,
    font: style.type.small,
    align: 'centre',
    baseline: 'middle',
  };
}

/**
 * Draws spectrogram lanes, keeping each lane's row map, the ramps in use and
 * each tile's field from frame to frame.
 */
export class SpectrogramPainter {
  #waiting = false;
  /** The row map each lane drawn last frame read, by the order it was drawn in. */
  #rows: ({ readonly source: RowSource; readonly rows: Float32Array } | undefined)[] = [];
  #next = 0;
  /** Each ramp drawn last frame or this, by what it was made from. */
  #ramps = new Map<string, ColourRamp>();
  #rampsBefore = new Map<string, ColourRamp>();
  /** A number for each list of colours and each background a ramp was made from, to look one up by. */
  readonly #names = new WeakMap<object, number>();
  #named = 0;
  /** Each tile's field, made once: a tile is a value, so its field is too. */
  readonly #fields = new WeakMap<SpectralTile, ScalarField>();

  /**
   * Whether a lane drawn since `begin` drew a tile pending or stale: until one
   * does, tiles made elsewhere change nothing drawn.
   */
  get waiting(): boolean {
    return this.#waiting;
  }

  /** Starts a frame's lanes, letting go of the ramps no lane drew last frame. */
  begin(): void {
    this.#waiting = false;
    this.#next = 0;
    this.#rampsBefore = this.#ramps;
    this.#ramps = new Map();
  }

  /**
   * Draws `lane`'s spectrogram into `out`: the tiles of `shown` of its
   * channel, or the reason `known` gives that none can be drawn.
   */
  draw(
    pool: BuilderPool,
    lane: Lane,
    known: KnownSpectrogram,
    shown: SpectrogramView | undefined,
    style: SpectrogramStyle,
    out: RenderBatch[],
  ): void {
    const slot = this.#next;
    this.#next += 1;
    const { area } = lane;
    const background = pool.rectangles(style.palette.spectrogramBackground);
    background.add(area.x, area.y, area.width, area.height);
    out.push(background.batch());
    if (known.kind === 'not-drawn') {
      out.push({ kind: 'text', labels: [reasonLabel(lane, known.reason, style)] });
      return;
    }
    if (shown?.channels.includes(lane.channel) !== true) return;
    const rows = this.#rowsFor(slot, lane, {
      top: area.y,
      height: area.height,
      ratio: style.pixelRatio,
      axis: style.axis,
      spacing: known.sampleRate / known.geometry.config.windowLength,
    });
    this.#tiles(pool, lane, known, shown, rows, style, out);
  }

  /** The tiles of `shown` in `lane`, each through its ramp, or pending where not yet held. */
  #tiles(
    pool: BuilderPool,
    lane: Lane,
    known: Extract<KnownSpectrogram, { readonly kind: 'tiles' }>,
    shown: SpectrogramView,
    rows: Float32Array,
    style: SpectrogramStyle,
    out: RenderBatch[],
  ): void {
    const level = known.geometry.levels[shown.level];
    if (level === undefined) return;
    const { area } = lane;
    const pending = pool.rectangles(style.palette.pending);
    for (let index = shown.first; index <= shown.last; index += 1) {
      const held = known.tile(lane.channel, shown.level, index);
      const placed = this.#placed(level, index, known.geometry.frames, lane, style.viewport);
      if (placed === undefined) continue;
      if (held === undefined) {
        this.#waiting = true;
        const from = Math.max(area.x, placed.at.x);
        const to = Math.min(area.x + area.width, placed.at.x + placed.at.width);
        pending.add(from, area.y, to - from, area.height);
        continue;
      }
      if (held.stale) this.#waiting = true;
      out.push({
        kind: 'field',
        field: this.#fieldOf(held.tile),
        ramp: this.#ramp(style, held.stale),
        at: placed.at,
        columns: placed.columns,
        rows,
      });
    }
    out.push(pending.batch());
  }

  /**
   * Where tile `index` of `level` lies in `lane`: from its first frame to the
   * end of its columns or of the sound, whichever is first, and the columns
   * that span, so a device pixel reads the column its centre's frame lies in.
   */
  #placed(
    level: LevelGeometry,
    index: number,
    frames: number,
    lane: Lane,
    viewport: ViewportState,
  ): Pick<FieldBatch, 'at' | 'columns'> | undefined {
    const span = tileSpan(level, index);
    const end = Math.min(frames, span.start + span.columns * level.columnFrames);
    if (end <= span.start) return undefined;
    // Placed as the selection and the waveform place a position, so all three
    // share one mapping.
    const left = pixelOf(viewport, span.start);
    const right = pixelOf(viewport, end);
    return {
      at: { x: left, y: lane.area.y, width: right - left, height: lane.area.height },
      columns: { from: 0, to: (end - span.start) / level.columnFrames },
    };
  }

  #rowsFor(slot: number, lane: Lane, source: RowSource): Float32Array {
    const kept = this.#rows[slot];
    if (kept !== undefined && sameRows(kept.source, source)) return kept.rows;
    const rows = rowMap(lane, source);
    this.#rows[slot] = { source, rows };
    return rows;
  }

  #fieldOf(tile: SpectralTile): ScalarField {
    const known = this.#fields.get(tile);
    if (known !== undefined) return known;
    const field = {
      key: `spectrogram-tile:${tileKeyText(tile.key)}`,
      width: tile.columns,
      height: tile.bins,
      values: tile.values,
    };
    this.#fields.set(tile, field);
    return field;
  }

  #nameOf(value: object): number {
    const known = this.#names.get(value);
    if (known !== undefined) return known;
    this.#named += 1;
    this.#names.set(value, this.#named);
    return this.#named;
  }

  #ramp(style: SpectrogramStyle, stale: boolean): ColourRamp {
    const { display, palette } = style;
    const colours = palette.spectrogramRamps[display.colours];
    const dimmed = stale ? palette.spectrogramBackground : undefined;
    const made = [
      String(this.#nameOf(colours)),
      dimmed === undefined ? 'current' : `stale-${String(this.#nameOf(dimmed))}`,
      String(display.range.floor),
      String(display.range.ceiling),
    ].join(':');
    const ramp =
      this.#ramps.get(made) ?? this.#rampsBefore.get(made) ?? rampOf(colours, display, dimmed);
    this.#ramps.set(made, ramp);
    return ramp;
  }
}
