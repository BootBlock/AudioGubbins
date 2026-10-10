/**
 * Composing a whole frame of a view from its state (REQ-AUDIO-152).
 *
 * Every frame is built from the view's state, its content, what is known of its
 * audio, the shared selection and the playhead, so the renderer holds nothing
 * and a lost device is recovered by composing the next frame. The composer
 * keeps only reusable arrays between frames (G4), never anything the frame is
 * about.
 *
 * A spectrogram lane draws the host's tiles of its channel under its frequency
 * axis, the waveform over them where the lane is an overlay, and the spectral
 * selection over both (REQ-EDIT-062, ADR-0082). Which tiles the frame shows is
 * worked out once, for every lane.
 */

import type {
  MarkerId,
  PlacedMarker,
  PlacedRegion,
  RegionId,
  SampleCount,
} from '@audiogubbins/domain';
import type {
  PlacedImage,
  RenderBatch,
  RenderFrame,
  RenderLayer,
  TextLabel,
} from '@audiogubbins/renderer';
import type { SpectrogramView } from '@audiogubbins/spectral-analysis';
import type { RulerTicks, SelectionSet, SnapTarget } from '@audiogubbins/timeline';

import { BuilderPool } from './batch-buffers.js';
import type { EditorPalette, EditorType } from './editor-palette.js';
import { LaneKind, type Lane, type ViewLayout } from './lane-layout.js';
import { MaskPainter, type SpectralEditOutline } from './mask-drawing.js';
import { frequencyY } from './frequency-axis.js';
import { drawLaneOverlay, type LaneOverlay } from './overlay-drawing.js';
import { drawRuler, drawStrip, type OverlayStyle } from './ruler-drawing.js';
import {
  SpectrogramPainter,
  shownSpectrogram,
  type KnownSpectrogram,
  type SpectrogramStyle,
} from './spectrogram-drawing.js';
import type { ToolPreview } from './tool-values.js';
import type { EditorViewState } from './view-state.js';
import { WaveformPainter, type KnownAudio } from './waveform-drawing.js';

/** What a view shows of its asset's content. */
export interface ViewContent {
  readonly length: SampleCount;
  /** Each channel's name, by its role or label, in layout order. */
  readonly channelNames: readonly string[];
  readonly markers: readonly PlacedMarker[];
  readonly regions: readonly PlacedRegion[];
  /** Where each of the asset's spectral edits applies, placed on the view's timeline. */
  readonly spectralEdits: readonly SpectralEditOutline[];
}

/** Everything one frame of a view is composed from. */
export interface ViewScene {
  readonly layout: ViewLayout;
  readonly state: EditorViewState;
  readonly pixelRatio: number;
  readonly content: ViewContent;
  readonly audio: KnownAudio;
  readonly spectrogram: KnownSpectrogram;
  readonly selection: SelectionSet;
  readonly playhead: SampleCount | undefined;
  readonly preview: ToolPreview | undefined;
  readonly snap: SnapTarget | undefined;
  readonly ruler: RulerTicks;
  /** The ruler's ticks and the grid's, where the grid is on. */
  readonly grid: readonly SampleCount[] | undefined;
  /** Picture thumbnails placed in the picture strip. */
  readonly picture: readonly PlacedImage[];
  readonly palette: EditorPalette;
  readonly type: EditorType;
}

/** What every lane's overlays read of a scene, as its overlays say. */
function laneOverlayOf(scene: ViewScene): LaneOverlay {
  const { state, content } = scene;
  return {
    selection: scene.selection,
    markers: state.overlays.markers ? content.markers : [],
    regions: state.overlays.regions ? content.regions : [],
    playhead: scene.playhead,
    preview: scene.preview,
    grid: scene.grid,
    spectral: state.spectral,
    spectralEdits: state.overlays.spectralEdits ? content.spectralEdits : [],
  };
}

/** How a scene's spectrogram lanes are drawn. */
function spectrogramStyleOf(scene: ViewScene): SpectrogramStyle {
  const { state } = scene;
  return {
    viewport: state.viewport,
    pixelRatio: scene.pixelRatio,
    axis: state.spectral,
    display: state.spectrogram,
    palette: scene.palette,
    type: scene.type,
  };
}

/** Composes a view's frames, keeping its arrays between them. */
export class FrameComposer {
  readonly #pool = new BuilderPool();
  readonly #waveform = new WaveformPainter();
  readonly #masks = new MaskPainter();
  readonly #spectrogram = new SpectrogramPainter();

  /**
   * Whether the last frame composed drew a column whose peaks were not yet
   * known, so the peaks made since may change it; a frame with none cannot be
   * changed by them, since a known bucket never changes.
   */
  get waiting(): boolean {
    return this.#waveform.waiting;
  }

  /**
   * Whether the last frame composed drew a spectrogram tile pending or stale,
   * so the tiles made since may change it; a frame with none cannot be
   * changed by them, since a tile of the current revision never changes.
   */
  get spectrogramWaiting(): boolean {
    return this.#spectrogram.waiting;
  }

  compose(scene: ViewScene): RenderFrame {
    this.#pool.reset();
    this.#waveform.begin();
    this.#masks.begin();
    this.#spectrogram.begin();
    const { layout, palette } = scene;
    const style: OverlayStyle = {
      viewport: scene.state.viewport,
      pixelRatio: scene.pixelRatio,
      palette,
      type: scene.type,
    };
    const overlay = laneOverlayOf(scene);
    const known = scene.spectrogram;
    const shown =
      known.kind === 'tiles'
        ? shownSpectrogram(scene.state, known.geometry, scene.content.length, scene.pixelRatio)
        : undefined;
    const layers: RenderLayer[] = layout.lanes.map((lane) => ({
      clip: lane.area,
      batches: this.#lane(lane, scene, shown, overlay, style),
    }));
    const separators = this.#pool.rectangles(palette.laneSeparator);
    for (const lane of layout.lanes)
      separators.add(0, lane.area.y + lane.area.height, layout.width, 1);
    layers.push({ batches: [separators.batch()] }, ...this.#above(scene, style));
    return {
      width: layout.width,
      height: layout.height,
      pixelRatio: scene.pixelRatio,
      clear: palette.background,
      layers,
    };
  }

  /** The layers above the lanes: the ruler, the strip and the picture. */
  #above(scene: ViewScene, style: OverlayStyle): RenderLayer[] {
    const { layout, state } = scene;
    const ruler: RenderBatch[] = [];
    drawRuler(
      this.#pool,
      layout,
      scene.ruler,
      style,
      { playhead: scene.playhead, snap: scene.snap },
      ruler,
    );
    const strip: RenderBatch[] = [];
    const { objects } = scene.selection;
    const selected = {
      markers: new Set<MarkerId>(objects?.kind === 'markers' ? objects.ids : []),
      regions: new Set<RegionId>(objects?.kind === 'regions' ? objects.ids : []),
    };
    const content = {
      markers: state.overlays.markers ? scene.content.markers : [],
      regions: state.overlays.regions ? scene.content.regions : [],
    };
    drawStrip(this.#pool, layout, content, selected, scene.preview, style, strip);
    const layers: RenderLayer[] = [
      { clip: layout.ruler, batches: ruler },
      { clip: layout.strip, batches: strip },
    ];
    if (layout.picture !== undefined) {
      const back = this.#pool.rectangles(scene.palette.spectrogramBackground);
      back.add(layout.picture.x, layout.picture.y, layout.picture.width, layout.picture.height);
      layers.push({
        clip: layout.picture,
        batches: [back.batch(), { kind: 'images', images: scene.picture }],
      });
    }
    return layers;
  }

  #lane(
    lane: Lane,
    scene: ViewScene,
    shown: SpectrogramView | undefined,
    overlay: LaneOverlay,
    style: OverlayStyle,
  ): RenderBatch[] {
    const { state } = scene;
    const out: RenderBatch[] = [];
    if (lane.kind !== LaneKind.Waveform) {
      this.#spectrogram.draw(
        this.#pool,
        lane,
        scene.spectrogram,
        shown,
        spectrogramStyleOf(scene),
        out,
      );
      this.#frequencyAxis(lane, scene, out);
    }
    if (lane.kind !== LaneKind.Spectrogram) {
      this.#waveform.draw(
        this.#pool,
        lane,
        scene.audio,
        {
          viewport: state.viewport,
          pixelRatio: scene.pixelRatio,
          amplitude: state.amplitude,
          rms: state.overlays.rms,
          clipping: state.overlays.clipping,
          palette: scene.palette,
        },
        out,
      );
    }
    drawLaneOverlay(this.#pool, this.#masks, lane, overlay, style, out);
    const name = scene.content.channelNames[lane.channel] ?? `Channel ${String(lane.channel + 1)}`;
    const label: TextLabel = {
      text: lane.kind === LaneKind.Spectrogram ? `${name} · spectrogram` : name,
      x: lane.area.x + 6,
      y: lane.area.y + 4,
      colour: scene.palette.quietText,
      font: scene.type.small,
      align: 'left',
      baseline: 'top',
    };
    out.push({ kind: 'text', labels: [label] });
    return out;
  }

  /** The frequencies marked at a spectrogram lane's right edge. */
  #frequencyAxis(lane: Lane, scene: ViewScene, out: RenderBatch[]): void {
    const { area } = lane;
    const settings = scene.state.spectral;
    const labels: TextLabel[] = [];
    const ticks = this.#pool.rectangles(scene.palette.grid);
    for (const frequency of [100, 1000, 10_000]) {
      if (frequency < settings.lowest || frequency > settings.highest) continue;
      const y = frequencyY(lane, frequency, settings);
      // At the lane's right edge, clear of the channel's name at its left.
      ticks.add(area.x + area.width - 6, y, 6, 1);
      labels.push({
        text: frequency >= 1000 ? `${String(frequency / 1000)} kHz` : `${String(frequency)} Hz`,
        x: area.x + area.width - 8,
        y,
        colour: scene.palette.quietText,
        font: scene.type.small,
        align: 'right',
        baseline: 'middle',
      });
    }
    out.push(ticks.batch(), { kind: 'text', labels });
  }
}
