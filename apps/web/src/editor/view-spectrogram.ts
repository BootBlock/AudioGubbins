/**
 * What a view knows of its asset's spectrogram: a hold on the host's job for
 * the edited sound it shows, and the tiles the view's lanes show of it, which
 * the host is told whenever they change (ADR-0080).
 *
 * The job is shared by every view of the source and revision, and the tiles the
 * page holds by every view of the source, an older revision's drawn stale while
 * the current one's are made; this view's hold is released when the view goes
 * or stops showing a spectrogram. Which tiles it shows is the editor view's one
 * account (`shownSpectrogram`), the same the lanes draw, so the host makes
 * exactly what is drawn, nearest the middle of the view first, and lets go of
 * what scrolls out of it. A view that redraws in place tells the host nothing.
 */

import type { QualityMode } from '@audiogubbins/domain';
import {
  DisplayMode,
  shownSpectrogram,
  type EditorViewState,
  type KnownSpectrogram,
} from '@audiogubbins/editor-view';
import type {
  SpectrogramHandle,
  SpectrogramHost,
  SpectrogramStatus,
  SpectrogramSubject,
  SpectrogramView,
} from '@audiogubbins/spectral-analysis';

import type { EditorAsset } from '../assets/editor-asset.js';
import { editedRevisionOf } from './edited-revision.js';

/**
 * The sound whose spectrogram shows `asset` as a final render at `quality`
 * makes it, named by its identity and revision.
 */
function spectrogramSubjectOf(asset: EditorAsset, quality: QualityMode): SpectrogramSubject {
  return {
    identity: asset.id,
    revision: editedRevisionOf(asset, quality),
    channels: asset.layout.roles.length,
    frames: asset.length,
    describe: asset.describe,
    quality,
  };
}

function sameView(one: SpectrogramView | undefined, other: SpectrogramView | undefined): boolean {
  if (one === undefined || other === undefined) return one === other;
  return (
    one.config === other.config &&
    one.level === other.level &&
    one.first === other.first &&
    one.last === other.last &&
    one.centre === other.centre &&
    one.channels.length === other.channels.length &&
    one.channels.every((channel, index) => channel === other.channels[index])
  );
}

/** One view's hold on its asset's spectrogram. */
export class ViewSpectrogram {
  readonly #handle: SpectrogramHandle;
  readonly #asset: EditorAsset;
  readonly #stopListening: () => void;
  #version = 0;
  #known: KnownSpectrogram | undefined;
  #shown: SpectrogramView | undefined;

  constructor(options: {
    readonly spectrograms: Pick<SpectrogramHost, 'open'>;
    readonly asset: EditorAsset;
    /** The render quality, whose sound the spectrogram shows. */
    readonly quality: QualityMode;
    /**
     * Told when a tile of the source has come or the spectrogram's status has
     * changed, which a frame drawn from it may show.
     */
    readonly progressed: () => void;
  }) {
    const { asset } = options;
    this.#asset = asset;
    this.#handle = options.spectrograms.open(spectrogramSubjectOf(asset, options.quality));
    this.#stopListening = this.#handle.subscribe(() => {
      this.#version += 1;
      options.progressed();
    });
  }

  /** Whether the spectrogram is being made, or why it cannot be. */
  get status(): SpectrogramStatus {
    return this.#handle.status;
  }

  /** How many times the host has said its tiles or status changed: a frame waiting on tiles draws again when it moves. */
  get version(): number {
    return this.#version;
  }

  /**
   * What is known for a view at `state` drawn at `ratio`, which tells the
   * host the tiles the view shows where they have changed.
   */
  known(state: EditorViewState, ratio: number): KnownSpectrogram {
    const status = this.#handle.status;
    if (status.kind === 'failed') {
      if (this.#known?.kind !== 'not-drawn' || this.#known.reason !== status.reason) {
        this.#known = { kind: 'not-drawn', reason: status.reason };
      }
      return this.#known;
    }
    const config = state.spectrogram.analysis;
    const geometry = this.#handle.geometry(config);
    if (this.#known?.kind !== 'tiles' || this.#known.geometry !== geometry) {
      this.#known = {
        kind: 'tiles',
        geometry,
        sampleRate: this.#asset.sampleRate,
        tile: (channel, level, index) => this.#handle.tile(config, channel, level, index),
      };
    }
    const shown = shownSpectrogram(state, geometry, this.#asset.length, ratio);
    if (!sameView(shown, this.#shown)) {
      this.#shown = shown;
      this.#handle.show(shown);
    }
    return this.#known;
  }

  /** Lets go of the spectrogram, and of the tiles asked for. */
  release(): void {
    this.#stopListening();
    this.#handle.show(undefined);
    this.#handle.release();
  }
}

/** What a view that shows no spectrogram knows of one: it has no lane to say so in. */
const NO_SPECTROGRAM: KnownSpectrogram = {
  kind: 'not-drawn',
  reason: 'The view shows no spectrogram.',
};

/**
 * A view's spectrogram held while it draws a spectrogram lane, of the edited
 * sound it shows: made again for another asset, revision or render quality,
 * any of which changes the tiles, and let go of when the view draws none.
 * Whoever shows the view is told whether it is being made or why it cannot
 * be, as that changes, and none once the view draws no spectrogram.
 */
export class ShownSpectrogram {
  readonly #spectrograms: Pick<SpectrogramHost, 'open'>;
  readonly #progressed: () => void;
  readonly #statusChanged: (status: SpectrogramStatus | undefined) => void;
  /** What was last told of the status, by the words it would change. */
  #told = 'none';
  #held:
    | {
        readonly asset: EditorAsset;
        readonly quality: QualityMode;
        readonly view: ViewSpectrogram;
      }
    | undefined;

  constructor(
    spectrograms: Pick<SpectrogramHost, 'open'>,
    progressed: () => void,
    statusChanged: (status: SpectrogramStatus | undefined) => void,
  ) {
    this.#spectrograms = spectrograms;
    this.#progressed = progressed;
    this.#statusChanged = statusChanged;
  }

  /** What a view of `asset` at `state`, drawn at `ratio`, knows of its spectrogram at `quality`. */
  known(
    asset: EditorAsset,
    state: EditorViewState,
    quality: QualityMode,
    ratio: number,
  ): { readonly spectrogram: KnownSpectrogram; readonly spectrogramVersion: number } {
    if (state.displayMode === DisplayMode.Waveform) {
      this.release();
      return { spectrogram: NO_SPECTROGRAM, spectrogramVersion: 0 };
    }
    const held = this.#held;
    const same =
      held?.asset.id === asset.id &&
      held.asset.revision === asset.revision &&
      held.quality === quality;
    const view = same ? held.view : this.#hold(asset, quality);
    return { spectrogram: view.known(state, ratio), spectrogramVersion: view.version };
  }

  /** Whether the spectrogram held is being made, or why it cannot be; none while none is held. */
  get status(): SpectrogramStatus | undefined {
    return this.#held?.view.status;
  }

  #hold(asset: EditorAsset, quality: QualityMode): ViewSpectrogram {
    this.release();
    const view = new ViewSpectrogram({
      spectrograms: this.#spectrograms,
      asset,
      quality,
      progressed: () => {
        this.#tell();
        this.#progressed();
      },
    });
    this.#held = { asset, quality, view };
    this.#tell();
    return view;
  }

  /** Tells of the status where it changes what would be said of it. */
  #tell(): void {
    const { status } = this;
    const said = status?.kind === 'failed' ? `failed:${status.reason}` : (status?.kind ?? 'none');
    if (said === this.#told) return;
    this.#told = said;
    this.#statusChanged(status);
  }

  /** Lets go of the spectrogram held, if any. */
  release(): void {
    this.#held?.view.release();
    this.#held = undefined;
    this.#tell();
  }
}
