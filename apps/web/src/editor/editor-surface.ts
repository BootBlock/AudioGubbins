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
 * as its follow mode says. A right click or a long press on it is the context
 * actions', which the panel wraps it in.
 */

import type { GraphicsPlatform } from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';
import { FrameComposer, FollowMode, type ToolPreview } from '@audiogubbins/editor-view';
import { Renderer, browserBackends, type RendererReport } from '@audiogubbins/renderer';
import type { SnapTarget } from '@audiogubbins/timeline';
import type { PeakHost, PeakStatus } from '@audiogubbins/waveform';

import { browserSchedule } from '../audio/browser-schedule.js';
import { EditorCanvases } from './editor-canvases.js';
import type { IntentCommand } from './intent-commands.js';
import { listenToPointers } from './pointer-input.js';
import { ToolPointer } from './tool-pointer.js';
import { followingScroll, viewSources, type SurfaceStores } from './view-sources.js';
import { ViewAudio } from './view-audio.js';
import { sceneOf, type SceneSources } from './view-scene.js';
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
  readonly logger: Logger;
}

/** One editor view on the page. */
export class EditorSurface {
  readonly #options: SurfaceOptions;
  readonly #canvases: EditorCanvases;
  readonly #renderer: Renderer;
  readonly #composer = new FrameComposer();
  readonly #stops: (() => void)[] = [];
  #audio: { readonly asset: string; readonly view: ViewAudio } | undefined;
  #size = { width: 0, height: 0 };
  #frame: number | undefined;
  #preview: ToolPreview | undefined;
  #snap: SnapTarget | undefined;
  #panning = false;
  #disposed = false;
  #lastReport = '';

  constructor(options: SurfaceOptions) {
    this.#options = options;
    this.#canvases = new EditorCanvases(options.host);
    this.#renderer = new Renderer({
      surface: this.#canvases,
      backends: browserBackends(options.graphics.gpu, browserSchedule),
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
      stores.content,
      stores.cues,
      stores.picture,
      stores.audio,
    ]) {
      this.#stops.push(store.subscribe(this.redraw));
    }
    this.#stops.push(graphics.watchPixelRatio(this.redraw));
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

  #listenToPointers(): void {
    const { host, panel, run, logger } = this.#options;
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
      zeroCrossing: (position, within, channels) =>
        this.#audio?.view.zeroCrossings.nearest(position, within, channels) ??
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
    if (this.#audio?.asset !== sources.asset.id) {
      this.#releaseAudio();
      const view: ViewAudio = new ViewAudio({
        peaks,
        asset: sources.asset,
        changed: () => {
          this.#options.peaksChanged(view.status);
          this.redraw();
        },
        failed: (reason) => {
          logger.warning('Samples for the editor could not be read.', { reason });
        },
      });
      this.#audio = { asset: sources.asset.id, view };
      this.#options.peaksChanged(view.status);
    }
    const ratio = this.#options.graphics.pixelRatio();
    return {
      ...sources,
      audio: this.#audio.view.known(sources.state.viewport, ratio),
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

  #draw(): void {
    const sources = this.#sources();
    if (sources === undefined || this.#size.width <= 0 || this.#size.height <= 0) return;
    this.#renderer.draw(this.#composer.compose(this.#scene(sources)));
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
