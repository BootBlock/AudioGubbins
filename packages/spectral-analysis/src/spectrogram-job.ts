/**
 * One revision of one sound's spectrogram on the page: the tiles its views
 * show, asked of the cache and then of the worker, and its status.
 *
 * The host shares one job among every view of a sound's identity and revision
 * (`spectrogram-host.ts`). A view says which tiles it shows; the job asks for
 * those the page does not hold at this revision, each of the cache first and
 * then of the worker with whatever the cache held, which the worker checks, and
 * cancels each, in the cache read or in the worker, once no view of the job
 * shows it, so nothing is analysed that no view asks for (ADR-0080). A tile the
 * worker made is kept in the cache, and one the cache refuses is reported and
 * still held in memory.
 */

import { describedBuffers } from '@audiogubbins/audio-engine';
import {
  Cancelled,
  FailureKind,
  createCancellationSource,
  fail,
  failure,
  type CancellationSource,
  type DomainResult,
} from '@audiogubbins/domain';

import { configText, type SpectrogramConfig } from './spectrogram-config.js';
import type {
  SpectralTileCache,
  SpectrogramEvent,
  SpectrogramStatus,
  SpectrogramView,
} from './spectrogram-ports.js';
import {
  FromSpectrogramWorkerKind,
  ToSpectrogramWorkerKind,
  type FromSpectrogramWorker,
  type ToSpectrogramWorker,
} from './spectrogram-messages.js';
import type { SpectrogramSubject } from './spectrogram-subject.js';
import {
  tileKeyText,
  tilePlace,
  type SpectralTile,
  type SpectralTileKey,
} from './spectral-tile.js';
import { decodeTile } from './tile-codec.js';
import {
  spectrogramGeometry,
  tileCentre,
  tileSpan,
  type SpectrogramGeometry,
} from './tile-geometry.js';

/** A tile asked for and not yet held. */
interface Asked {
  readonly key: SpectralTileKey;
  readonly request: number;
  /** Stops the cache read, which is all there is to stop before the worker is asked. */
  readonly cancel: CancellationSource;
  /** Whether the worker was asked, so must be told when the tile is no longer shown. */
  sent: boolean;
}

/** What a job is given by the host it belongs to. */
export interface JobServices {
  readonly post: (message: ToSpectrogramWorker, transfer: readonly ArrayBuffer[]) => void;
  readonly cache: SpectralTileCache;
  readonly report: (event: SpectrogramEvent) => void;
  /** A request number no other want of the host has. */
  readonly request: () => number;
  /** The tile the page holds at a tile's place, of whichever revision. */
  readonly held: (place: string) => SpectralTile | undefined;
  /** Holds a tile the worker gave, in place of any other revision's. */
  readonly hold: (tile: SpectralTile) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One revision of one sound's spectrogram on the page. */
export class SpectrogramJob {
  readonly subject: SpectrogramSubject;
  readonly name: string;
  readonly #services: JobServices;
  readonly #listeners = new Set<() => void>();
  #status: SpectrogramStatus = { kind: 'running' };
  /** What each view shows, by the view. */
  readonly #views = new Map<object, ReadonlyMap<string, SpectralTileKey>>();
  readonly #asked = new Map<string, Asked>();
  readonly #byRequest = new Map<number, string>();
  /** Each settings' pyramid of the subject, made once for the job's life (G5). */
  readonly #geometries = new Map<string, SpectrogramGeometry>();
  #closed = false;

  constructor(name: string, subject: SpectrogramSubject, services: JobServices) {
    this.name = name;
    this.subject = subject;
    this.#services = services;
  }

  get status(): SpectrogramStatus {
    return this.#status;
  }

  /** The places every view of the job shows. */
  *shownPlaces(): Generator<string> {
    for (const shown of this.#views.values())
      for (const key of shown.values()) yield tilePlace(key);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Tells every view the job's tiles or status changed. */
  changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /**
   * Opens the job in the worker, moving to it the arrays of a sound held in
   * memory, which the subject gives for the worker to keep.
   */
  start(): void {
    const description = this.subject.describe();
    this.#services.post(
      {
        kind: ToSpectrogramWorkerKind.Open,
        job: this.name,
        identity: this.subject.identity,
        revision: this.subject.revision,
        channels: this.subject.channels,
        description,
        quality: this.subject.quality,
      },
      describedBuffers([description]),
    );
  }

  geometry(config: SpectrogramConfig): SpectrogramGeometry {
    const name = configText(config);
    const kept = this.#geometries.get(name);
    if (kept !== undefined) return kept;
    const made = spectrogramGeometry(config, this.subject.frames, this.subject.channels);
    this.#geometries.set(name, made);
    return made;
  }

  /** The key of a tile of this job's revision. */
  keyOf(config: SpectrogramConfig, channel: number, level: number, index: number): SpectralTileKey {
    const { identity, revision } = this.subject;
    return { identity, revision, channel, config, level, index };
  }

  /** What `view` shows from now, `undefined` for nothing; asks for the tiles not held and cancels those no view shows. */
  show(viewer: object, view: SpectrogramView | undefined): void {
    if (this.#closed || this.#status.kind === 'failed') return;
    if (view === undefined) {
      this.#views.delete(viewer);
    } else {
      const shown = new Map<string, SpectralTileKey>();
      const geometry = this.geometry(view.config);
      const level = geometry.levels[view.level];
      const indexes: number[] = [];
      for (
        let index = Math.max(0, view.first);
        index <= Math.min(view.last, (level?.tiles ?? 0) - 1);
        index += 1
      ) {
        indexes.push(index);
      }
      // Asked for nearest the centre first, so the worker hears of those first.
      if (level !== undefined) {
        const distance = (index: number): number =>
          Math.abs(tileCentre(level, index) - view.centre);
        indexes.sort((one, other) => distance(one) - distance(other));
      }
      for (const index of indexes) {
        for (const channel of view.channels) {
          if (channel >= geometry.channels) continue;
          const key = this.keyOf(view.config, channel, view.level, index);
          shown.set(tileKeyText(key), key);
        }
      }
      this.#views.set(viewer, shown);
      this.#services.post(
        { kind: ToSpectrogramWorkerKind.Focus, job: this.name, centre: view.centre },
        [],
      );
    }
    this.#reconcile();
  }

  #reconcile(): void {
    const wanted = new Map<string, SpectralTileKey>();
    for (const shown of this.#views.values())
      for (const [text, key] of shown) wanted.set(text, key);
    for (const [text, asked] of this.#asked) {
      if (!wanted.has(text)) this.#cancel(text, asked);
    }
    for (const [text, key] of wanted) {
      if (this.#asked.has(text)) continue;
      if (this.#services.held(tilePlace(key))?.key.revision === key.revision) continue;
      this.#ask(text, key);
    }
  }

  #ask(text: string, key: SpectralTileKey): void {
    const request = this.#services.request();
    const asked: Asked = { key, request, cancel: createCancellationSource(), sent: false };
    this.#asked.set(text, asked);
    this.#byRequest.set(request, text);
    this.#services.cache
      .read(key, asked.cancel.signal)
      .catch((error: unknown) => {
        if (!asked.cancel.signal.aborted) {
          this.#services.report({
            kind: 'cache-unreadable',
            identity: key.identity,
            reason: messageOf(error),
          });
        }
        return undefined;
      })
      .then((cached) => {
        if (asked.cancel.signal.aborted || this.#asked.get(text) !== asked) return;
        asked.sent = true;
        this.#services.post(
          {
            kind: ToSpectrogramWorkerKind.Want,
            job: this.name,
            request,
            config: key.config,
            channel: key.channel,
            level: key.level,
            index: key.index,
            cached,
          },
          cached === undefined ? [] : [cached.buffer],
        );
      })
      .catch((error: unknown) => {
        this.#failOpen(`The spectrogram could not be asked for: ${messageOf(error)}`);
      });
  }

  #cancel(text: string, asked: Asked): void {
    this.#asked.delete(text);
    this.#byRequest.delete(asked.request);
    asked.cancel.cancel(new Cancelled('No view shows the tile.'));
    if (asked.sent) {
      this.#services.post(
        { kind: ToSpectrogramWorkerKind.Cancel, job: this.name, request: asked.request },
        [],
      );
    }
  }

  /** Handles a message from the worker for this job. */
  receive(
    message: Exclude<FromSpectrogramWorker, { kind: typeof FromSpectrogramWorkerKind.Dsp }>,
  ): void {
    if (this.#closed) return;
    if (message.kind === FromSpectrogramWorkerKind.Failed) {
      this.fail(message.reason);
      return;
    }
    const text = this.#byRequest.get(message.request);
    const asked = text === undefined ? undefined : this.#asked.get(text);
    // A tile no view shows any longer, cancelled after the worker sent it.
    if (text === undefined || asked === undefined) return;
    this.#asked.delete(text);
    this.#byRequest.delete(message.request);
    const decoded = this.#decoded(asked.key, message.bytes);
    if (!decoded.ok) {
      this.#failOpen(`The worker's tile could not be read: ${decoded.failures[0].summary}`);
      return;
    }
    if (message.refusedCache !== undefined) {
      this.#services.report({
        kind: 'cache-refused',
        identity: asked.key.identity,
        reason: message.refusedCache,
      });
    }
    this.#services.hold(decoded.value);
    if (!message.adopted) {
      this.#services.cache.write(asked.key, message.bytes).catch((error: unknown) => {
        this.#services.report({
          kind: 'cache-unwritten',
          identity: asked.key.identity,
          reason: messageOf(error),
        });
      });
    }
  }

  /** The tile in bytes the worker sent, checked against the key and shape asked for. */
  #decoded(key: SpectralTileKey, bytes: Uint8Array<ArrayBuffer>): DomainResult<SpectralTile> {
    const geometry = this.geometry(key.config);
    const level = geometry.levels[key.level];
    if (level === undefined) {
      return fail(
        failure(
          'spectral.tile-refused',
          FailureKind.Rejected,
          'The tile is of no level the sound has.',
        ),
      );
    }
    const columns = tileSpan(level, key.index).columns;
    return decodeTile(bytes, { key, columns, bins: geometry.bins }, false);
  }

  /** Ends a job the worker still holds open, which it is told to close. */
  #failOpen(reason: string): void {
    if (this.#closed || this.#status.kind === 'failed') return;
    this.#services.post({ kind: ToSpectrogramWorkerKind.Close, job: this.name }, []);
    this.fail(reason);
  }

  /**
   * Ends the job with `reason`, cancelling every tile asked for. The worker
   * holds it open no longer: it failed the job, or stopped.
   */
  fail(reason: string): void {
    if (this.#closed || this.#status.kind === 'failed') return;
    this.#status = { kind: 'failed', reason };
    this.#cancelAll();
    this.#views.clear();
    this.#services.report({ kind: 'failed', identity: this.subject.identity, reason });
    this.changed();
  }

  #cancelAll(): void {
    for (const asked of this.#asked.values()) asked.cancel.cancel(new Cancelled());
    this.#asked.clear();
    this.#byRequest.clear();
  }

  /** Closes the job: the worker releases the sound, and every tile asked for is cancelled. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancelAll();
    this.#views.clear();
    if (this.#status.kind !== 'failed') {
      this.#services.post({ kind: ToSpectrogramWorkerKind.Close, job: this.name }, []);
    }
    this.#listeners.clear();
  }
}
