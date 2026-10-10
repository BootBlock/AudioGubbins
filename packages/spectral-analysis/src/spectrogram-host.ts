/**
 * Sharing spectrograms among views: one job per sound identity and revision,
 * one worker for every job, the tiles held in memory between them, and the
 * kept cache (ADR-0080).
 *
 * A view opens a handle and releases it when it goes; the job lives while any
 * handle to it does. A view says which tiles it shows, and draws those the
 * page holds, an older revision's marked stale until the current one's
 * replaces it, so an edit never empties the view. The worker is made with the
 * first job and is the only one, so one tile is made at a time (G4). Its
 * messages are read field by field and handed to the job they name; one it
 * cannot read, or the worker failing, fails every job with the reason, which
 * each view's lanes show where they are not drawn, and the next sound opened
 * makes a new worker.
 */

import type { DspImplementation } from '@audiogubbins/audio-engine';

import type { SpectrogramConfig } from './spectrogram-config.js';
import { SpectrogramJob } from './spectrogram-job.js';
import type {
  SpectralTileCache,
  SpectrogramEvent,
  SpectrogramStatus,
  SpectrogramView,
} from './spectrogram-ports.js';
import { FromSpectrogramWorkerKind, type ToSpectrogramWorker } from './spectrogram-messages.js';
import { readFromSpectrogramWorker } from './spectrogram-message-reading.js';
import type { SpectrogramSubject } from './spectrogram-subject.js';
import { tilePlace, type SpectralTile } from './spectral-tile.js';
import type { SpectrogramGeometry } from './tile-geometry.js';
import { TILE_MEMORY_BUDGET_BYTES, TileMemory } from './tile-memory.js';

/**
 * The page's end of the spectrogram worker, given its DSP delivery and its
 * port to the preview worker as it was made, before anything else.
 */
export interface SpectrogramWorkerPort {
  post(message: ToSpectrogramWorker, transfer: readonly ArrayBuffer[]): void;
  /** Listens for the worker's messages, and for its failing, with the reason. */
  listen(onMessage: (value: unknown) => void, onFault: (reason: string) => void): void;
  terminate(): void;
}

/** What the host reports: a job's events, and which DSP the worker runs. */
export type SpectrogramHostEvent =
  | SpectrogramEvent
  | {
      readonly kind: 'dsp';
      readonly implementation: DspImplementation;
      readonly fallbackReason: string | undefined;
    };

/** A tile a view draws: the current revision's, or an older one's, drawn as stale. */
export interface ShownTile {
  readonly tile: SpectralTile;
  readonly stale: boolean;
}

/** A view's hold on a sound's spectrogram. */
export interface SpectrogramHandle {
  /** Whether the spectrogram can be drawn, and why not: the lanes say so. */
  readonly status: SpectrogramStatus;
  /** The sound's pyramid at `config`. */
  geometry(config: SpectrogramConfig): SpectrogramGeometry;
  /** Calls `listener` when a tile arrives or the status changes. */
  subscribe(listener: () => void): () => void;
  /** The tiles this view shows from now, made nearest its centre first; `undefined` for none. */
  show(view: SpectrogramView | undefined): void;
  /** The tile this view draws at a place, or `undefined` while it is pending. */
  tile(
    config: SpectrogramConfig,
    channel: number,
    level: number,
    index: number,
  ): ShownTile | undefined;
  /** Lets go; the job closes when the last handle to it does. */
  release(): void;
}

interface Shared {
  readonly job: SpectrogramJob;
  holders: number;
}

/** Shares spectrograms among views. */
export class SpectrogramHost {
  readonly #createWorker: () => SpectrogramWorkerPort;
  readonly #cache: SpectralTileCache;
  readonly #report: (event: SpectrogramHostEvent) => void;
  readonly #memory: TileMemory;
  readonly #shared = new Map<string, Shared>();
  readonly #byName = new Map<string, SpectrogramJob>();
  readonly #now: () => number;
  #worker: SpectrogramWorkerPort | undefined;
  #jobs = 0;
  #requests = 0;
  /** When the last job opened, which the next opens after. */
  #opened = Number.NEGATIVE_INFINITY;

  constructor(options: {
    readonly createWorker: () => SpectrogramWorkerPort;
    readonly cache: SpectralTileCache;
    readonly report: (event: SpectrogramHostEvent) => void;
    /**
     * The time in milliseconds since 1970, which dates each job, so a cache
     * the page's windows and visits share keeps the revision opened last.
     */
    readonly now: () => number;
    /** The bytes of tiles held in memory: {@link TILE_MEMORY_BUDGET_BYTES} unless a test says. */
    readonly memoryBudget?: number;
  }) {
    this.#createWorker = options.createWorker;
    this.#cache = options.cache;
    this.#report = options.report;
    this.#now = options.now;
    this.#memory = new TileMemory(options.memoryBudget ?? TILE_MEMORY_BUDGET_BYTES);
  }

  /** A handle on `subject`'s spectrogram, shared with every other view of the same sound and revision. */
  open(subject: SpectrogramSubject): SpectrogramHandle {
    const key = `${subject.identity}\u0000${subject.revision}`;
    const shared = this.#shared.get(key) ?? this.#start(key, subject);
    shared.holders += 1;
    const job = shared.job;
    const viewer = {};
    let released = false;
    return {
      get status() {
        return job.status;
      },
      geometry: (config) => job.geometry(config),
      subscribe: (listener) => job.subscribe(listener),
      show: (view) => {
        if (released) return;
        job.show(viewer, view);
        if (view === undefined) return;
        for (const channel of view.channels) {
          for (let index = view.first; index <= view.last; index += 1) {
            this.#memory.shown(tilePlace(job.keyOf(view.config, channel, view.level, index)));
          }
        }
      },
      tile: (config, channel, level, index) => {
        const tile = this.#memory.at(
          tilePlace({ identity: subject.identity, config, channel, level, index }),
        );
        return tile === undefined
          ? undefined
          : { tile, stale: tile.key.revision !== subject.revision };
      },
      release: () => {
        if (released) return;
        released = true;
        job.show(viewer, undefined);
        shared.holders -= 1;
        if (shared.holders === 0) this.#close(key, job);
      },
    };
  }

  #start(key: string, subject: SpectrogramSubject): Shared {
    this.#jobs += 1;
    // Later than the last job however close they come, so two jobs opened in
    // one millisecond are still told apart.
    this.#opened = Math.max(this.#now(), this.#opened + 1);
    const job = new SpectrogramJob(`spectrogram-${String(this.#jobs)}`, subject, {
      post: (message, transfer) => {
        this.#workerPort().post(message, transfer);
      },
      cache: this.#cache,
      report: this.#report,
      request: () => {
        this.#requests += 1;
        return this.#requests;
      },
      held: (place) => this.#memory.at(place),
      hold: (tile) => {
        this.#hold(tile);
      },
      opened: this.#opened,
    });
    const shared: Shared = { job, holders: 0 };
    this.#shared.set(key, shared);
    this.#byName.set(job.name, job);
    job.start();
    return shared;
  }

  /** Holds a tile, keeping every tile a view shows, and tells the views of its sound. */
  #hold(tile: SpectralTile): void {
    const shown = new Set<string>();
    for (const { job } of this.#shared.values())
      for (const place of job.shownPlaces()) shown.add(place);
    this.#memory.hold(tile, (place) => shown.has(place));
    for (const { job } of this.#shared.values()) {
      if (job.subject.identity === tile.key.identity) job.changed();
    }
  }

  #workerPort(): SpectrogramWorkerPort {
    if (this.#worker !== undefined) return this.#worker;
    const worker = this.#createWorker();
    worker.listen(
      (value) => {
        this.#receive(value);
      },
      (reason) => {
        this.#workerFailed(reason);
      },
    );
    this.#worker = worker;
    return worker;
  }

  #receive(value: unknown): void {
    const read = readFromSpectrogramWorker(value);
    if (!read.ok) {
      this.#workerFailed(read.failures[0].summary);
      return;
    }
    const message = read.value;
    if (message.kind === FromSpectrogramWorkerKind.Dsp) {
      this.#report({
        kind: 'dsp',
        implementation: message.implementation,
        fallbackReason: message.fallbackReason,
      });
      return;
    }
    this.#byName.get(message.job)?.receive(message);
  }

  /** The worker failed, or sent what cannot be read: every job fails with the reason, and the next sound opened makes a new worker. */
  #workerFailed(reason: string): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    for (const job of this.#byName.values()) job.fail(`The spectrogram worker stopped: ${reason}`);
  }

  #close(key: string, job: SpectrogramJob): void {
    this.#shared.delete(key);
    this.#byName.delete(job.name);
    job.close();
  }

  /** Closes every job and the worker. */
  dispose(): void {
    for (const [key, shared] of [...this.#shared]) this.#close(key, shared.job);
    this.#worker?.terminate();
    this.#worker = undefined;
  }
}
