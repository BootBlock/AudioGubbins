/**
 * One editor view on the page: its canvases and renderer, the frames it draws
 * and when, and the pointer and keys that work it (REQ-AUDIO-152,
 * REQ-EDIT-065).
 *
 * It holds no state a person made. Each frame is composed from the stores (the
 * view's presentation, the asset's content, selection and playhead), what is
 * known of the audio and the drag in progress, so a lost device is recovered by
 * the next frame and two views of an asset show one selection. What it changes,
 * it changes through commands; the one thing it writes itself is the size it is
 * laid out at, which is a measurement, not an action.
 *
 * A frame is drawn when something it shows has changed, and every display frame
 * while the transport plays the asset, when the view also follows the playhead
 * as its follow mode says. A change to a store is only a reason to look: the
 * frame is composed again only where a value it is drawn from is not the one
 * the last frame was, so a view is not redrawn for another view's scroll. A
 * right click or a long press on it is the context actions', which the panel
 * wraps it in.
 */

import type { GraphicsPlatform } from '@audiogubbins/capabilities';
import type { QualityMode } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import { FrameComposer, FollowMode, type ToolPreview } from '@audiogubbins/editor-view';
import { Renderer, browserBackends, type RendererReport } from '@audiogubbins/renderer';
import type { SnapTarget } from '@audiogubbins/timeline';
import type { PeakHost, PeakStatus } from '@audiogubbins/waveform';

import { browserSchedule } from '../audio/browser-schedule.js';
import type { Filmstrip } from '../picture/filmstrip.js';

import { EditorCanvases } from './editor-canvases.js';
import type { IntentCommand } from './intent-commands.js';
import { listenToPointers } from './pointer-input.js';
import { ToolPointer } from './tool-pointer.js';
import { followingScroll, viewSources, type SurfaceStores } from './view-sources.js';
import { ViewAudio } from './view-audio.js';
import { frameInputsOf, sameInputs, sceneOf, type SceneSources } from './view-scene.js';
import type { EditorPalette, EditorType } from '@audiogubbins/editor-view';

/** What a surface is made with. */
export interface SurfaceOptions {
  readonly host: HTMLElement;
  readonly panel: string;
  readonly stores: SurfaceStores;
  readonly peaks: PeakHost;
  readonly graphics: GraphicsPlatform;
  readonly look: () => { readonly palette: EditorPalette; readonly type: EditorType };
  readonly run: (command: IntentCommand) => void;
  /** Told what the renderer tried and what it draws with, as that changes. */
  readonly report: (report: RendererReport) => void;
  /** Told where the peaks of the asset shown are, as that changes. */
  readonly peaksChanged: (status: PeakStatus) => void;
  /** Opens the context actions at a point of the page, where a press was held still. */
  readonly contextActions: (clientX: number, clientY: number) => void;
  readonly logger: Logger;
}

/** One editor view on the page. */
export class EditorSurface {
  readonly #options: SurfaceOptions;
  readonly #canvases: EditorCanvases;
  readonly #renderer: Renderer;
  readonly #composer = new FrameComposer();
  readonly #stops: (() => void)[] = [];
  /**
   * The audio of the asset shown, held for its revision and the render
   * quality, a change of either of which changes the peaks it draws.
   */
  #audio:
    | {
        readonly asset: string;
        readonly revision: string;
        readonly quality: QualityMode;
        readonly view: ViewAudio;
      }
    | undefined;
  #size = { width: 0, height: 0 };
  #frame: number | undefined;
  #preview: ToolPreview | undefined;
  #snap: SnapTarget | undefined;
  #panning = false;
  #disposed = false;
  #lastReport = '';
  /** The values the last frame was drawn from, in `#inputsOf`'s order. */
  #drawn: readonly unknown[] = [];
  /** The filmstrip listened to, and how many thumbnails it has made since. */
  #filmstrip: { readonly strip: Filmstrip; readonly stop: () => void } | undefined;
  #thumbnails = 0;
  /** What the panel was last told of the peaks, as its words would change. */
  #toldPeaks = '';

  constructor(options: SurfaceOptions) {
    this.#options = options;
    this.#canvases = new EditorCanvases(options.host);
    this.#renderer = new Renderer({
      surface: this.#canvases,
      backends: browserBackends(options.graphics.gpu, browserSchedule, () =>
        this.#canvases.offscreen(),
      ),
    });
    this.#stops.push(this.#renderer.subscribe(this.#reported));
    void this.#renderer.start().then(() => {
      this.#reported(this.#renderer.report);
    });
    this.#watch();
    this.#listenToPointers();
    this.#listenToKeys();
    this.redraw();
  }

  /** What the renderer draws with, passed on, and recorded when it changes. */
  readonly #reported = (report: RendererReport): void => {
    this.#options.report(report);
    const said = `${report.state}:${report.active ?? 'none'}:${String(report.losses)}`;
    if (said === this.#lastReport) return;
    this.#lastReport = said;
    this.#options.logger.info('An editor view\u2019s renderer changed.', {
      state: report.state,
      renderer: report.active ?? 'none',
      losses: report.losses,
      recoveries: report.recoveries,
    });
  };

  /** Asks for a frame, drawn on the next display frame. */
  readonly redraw = (): void => {
    if (this.#frame !== undefined || this.#disposed) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = undefined;
      this.#draw();
    });
  };

  #watch(): void {
    const { stores, host, graphics } = this.#options;
    for (const store of [
      stores.editorViews,
      stores.selections,
      stores.assets,
      stores.cues,
      stores.picture,
      stores.audio,
      stores.audioSettings,
    ]) {
      this.#stops.push(store.subscribe(this.redraw));
    }
    this.#stops.push(graphics.watchPixelRatio(this.redraw));
    this.#stops.push(stores.picture.subscribe(this.#watchFilmstrip));
    this.#stops.push(() => this.#filmstrip?.stop());
    this.#watchFilmstrip();
    const resizing = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      this.#size = { width: entry.contentRect.width, height: entry.contentRect.height };
      const sources = this.#sources();
      if (sources !== undefined) {
        stores.editorViews.measured(this.#options.panel, this.#size.width, sources.asset.length);
      }
      this.redraw();
    });
    resizing.observe(host);
    this.#stops.push(() => {
      resizing.disconnect();
    });
  }

  /** Listens to the picture's filmstrip, which makes thumbnails the frame shows as they come. */
  readonly #watchFilmstrip = (): void => {
    const strip = this.#options.stores.picture.filmstrip;
    if (strip === this.#filmstrip?.strip) return;
    this.#filmstrip?.stop();
    this.#filmstrip =
      strip === undefined
        ? undefined
        : {
            strip,
            stop: strip.subscribe(() => {
              this.#thumbnails += 1;
              this.redraw();
            }),
          };
  };

  /** Tells the panel where the peaks are, where that changes what it says. */
  #tellPeaks(status: PeakStatus): void {
    const said =
      status.kind === 'generating'
        ? `${status.kind}:${String(Math.floor(status.progress * 100))}`
        : status.kind;
    if (said === this.#toldPeaks) return;
    this.#toldPeaks = said;
    this.#options.peaksChanged(status);
  }

  #listenToPointers(): void {
    const { host, panel, run, logger, contextActions } = this.#options;
    const tool = new ToolPointer({
      panel,
      snapshot: () => {
        const sources = this.#sources();
        return sources === undefined ? undefined : { sources, layout: this.#scene(sources).layout };
      },
      panning: () => this.#panning,
      run,
      show: (preview, snap) => {
        this.#preview = preview;
        this.#snap = snap;
        this.redraw();
      },
      fault: (error) => {
        logger.error('A pointer event in the editor could not be taken.', {
          reason: error instanceof Error ? error.message : String(error),
        });
      },
      zeroCrossing: (position, within, channels, signal) =>
        this.#audio?.view.zeroCrossings.nearest(position, within, channels, signal) ??
        Promise.resolve(undefined),
    });
    this.#stops.push(
      listenToPointers(this.#canvases.pointerTarget, {
        panel,
        tool,
        run,
        focus: () => {
          host.focus({ preventScroll: true });
        },
        contextActions,
      }),
    );
  }

  /** The held space bar, which makes any tool the hand while the view has the keyboard. */
  #listenToKeys(): void {
    const { host } = this.#options;
    const key = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      // The held space bar is the hand, and not the page scrolling.
      event.preventDefault();
      this.#panning = event.type === 'keydown';
    };
    const blurred = (): void => {
      this.#panning = false;
    };
    host.addEventListener('keydown', key);
    host.addEventListener('keyup', key);
    host.addEventListener('blur', blurred);
    this.#stops.push(() => {
      host.removeEventListener('keydown', key);
      host.removeEventListener('keyup', key);
      host.removeEventListener('blur', blurred);
    });
  }

  /** What the view draws from now, holding the peaks of the asset it shows. */
  #sources(): SceneSources | undefined {
    const { stores, panel, peaks, look, logger } = this.#options;
    const sources = viewSources(stores, panel, look());
    if (sources === undefined) {
      this.#releaseAudio();
      return undefined;
    }
    const quality = stores.audioSettings.get().renderQuality;
    const { id: asset, revision } = sources.asset;
    let held = this.#audio;
    if (held?.asset !== asset || held.revision !== revision || held.quality !== quality) {
      this.#releaseAudio();
      const view: ViewAudio = new ViewAudio({
        peaks,
        asset: sources.asset,
        quality,
        changed: this.redraw,
        progressed: () => {
          this.#tellPeaks(view.status);
          // A frame whose columns were all known shows none of what came.
          if (this.#composer.waiting) this.redraw();
        },
        failed: (reason) => {
          logger.warning('Samples for the editor could not be read.', { reason });
        },
      });
      held = { asset, revision, quality, view };
      this.#audio = held;
      this.#tellPeaks(view.status);
    }
    const ratio = this.#options.graphics.pixelRatio();
    return {
      ...sources,
      audio: held.view.known(sources.state.viewport, ratio),
      preview: this.#preview,
      snap: this.#snap,
    };
  }

  #scene(sources: SceneSources) {
    return sceneOf(
      sources,
      this.#size.width,
      this.#size.height,
      this.#options.graphics.pixelRatio(),
    );
  }

  /** The values a frame of `sources` is drawn from, each compared by identity. */
  #inputsOf(sources: SceneSources): readonly unknown[] {
    return [
      ...frameInputsOf(sources, this.#composer.waiting),
      this.#options.stores.picture.get(),
      this.#thumbnails,
      this.#size.width,
      this.#size.height,
      this.#options.graphics.pixelRatio(),
    ];
  }

  #draw(): void {
    const sources = this.#sources();
    if (sources === undefined || this.#size.width <= 0 || this.#size.height <= 0) return;
    const inputs = this.#inputsOf(sources);
    if (!sameInputs(inputs, this.#drawn)) {
      this.#drawn = inputs;
      this.#renderer.draw(this.#composer.compose(this.#scene(sources)));
    }
    const { stores, panel, run } = this.#options;
    if (!stores.playing(sources.asset.id)) return;
    if (sources.state.follow !== FollowMode.Off) {
      const to = followingScroll(sources.state, sources.playhead, sources.asset.length);
      if (to !== undefined) run({ id: 'editor.scroll-to', args: { view: panel, position: to } });
    }
    this.redraw();
  }

  #releaseAudio(): void {
    this.#audio?.view.release();
    this.#audio = undefined;
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    for (const stop of this.#stops) stop();
    this.#releaseAudio();
    this.#renderer.dispose();
    this.#canvases.dispose();
  }
}
