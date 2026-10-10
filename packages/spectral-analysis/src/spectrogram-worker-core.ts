/**
 * What the spectrogram worker does, apart from the scope it runs in.
 *
 * It runs the DSP the page delivers, the WebAssembly module where one is
 * compiled and the reference where none is, and says which (ADR-0080). Each job
 * is one revision of one sound, read through the engine's plan readers, a
 * racked sound through the preview worker's renders once the page has given the
 * port to them (ADR-0061). A want names one tile; the cached bytes it carries
 * are checked against its key and checksum and given back, or the tile is made.
 * Tiles are made one place at a time, nearest the focus of the job focused
 * last, the wants of every channel at that place in one pass, with a turn to
 * the host between chunks of each, so a want cancelled or a focus moved is read
 * within one chunk's work. A cancelled want is answered with nothing, and work
 * no want still waits on stops.
 */

import {
  PreviewClient,
  ProcessedStart,
  describedSource,
  previewPort,
  type ChainProcessing,
  type DspDelivery,
  type PcmSource,
  type ScopeDsp,
  type ToPreview,
} from '@audiogubbins/audio-engine';
import {
  createCancellationSource,
  discreteLayout,
  type CancellationSource,
} from '@audiogubbins/domain';

import { configText } from './spectrogram-config.js';
import {
  FromSpectrogramWorkerKind,
  ToSpectrogramWorkerKind,
  type CompiledModule,
  type FromSpectrogramWorker,
  type ToSpectrogramWorker,
} from './spectrogram-messages.js';
import { readToSpectrogramWorker } from './spectrogram-message-reading.js';
import { analyseTiles } from './tile-analysis.js';
import { decodeTile } from './tile-codec.js';
import { spectrogramGeometry, tileSpan, type SpectrogramGeometry } from './tile-geometry.js';
import { answers, takeNearestPlace, wantedKey, type Want, type Waiting } from './tile-wants.js';

/** What the worker's scope gives the core. */
export interface SpectrogramWorkerHost {
  readonly post: (message: FromSpectrogramWorker, transfer: readonly ArrayBuffer[]) => void;
  /** Resolves after the events already queued for the worker have run. */
  readonly yieldToHost: () => Promise<void>;
  /** How the chains an edited sound's plan names are run: the effect rack's. */
  readonly processing: ChainProcessing;
  /** The DSP the scope runs from the delivery: the module's instance, or the reference path. */
  readonly chooseDsp: (delivery: DspDelivery<CompiledModule>) => ScopeDsp;
  /** Reports a message that could not be read, which the page sent wrongly. */
  readonly reportFault: (error: Error) => void;
}

/** One revision of one sound. */
interface Job {
  readonly name: string;
  readonly identity: string;
  readonly revision: string;
  readonly source: PcmSource;
  readonly dsp: ScopeDsp;
  /** Each settings' pyramid, made once for the job's life (G5). */
  readonly geometries: Map<string, SpectrogramGeometry>;
  /** The frame its tiles are made nearest, once a view has said. */
  focus: number;
  readonly waiting: Map<number, Waiting>;
}

/** The place being made, and the wants waiting on it. */
interface Making {
  readonly job: Job;
  readonly wants: Map<number, Waiting>;
  readonly cancel: CancellationSource;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The spectrogram worker's work, given its scope's parts. */
export class SpectrogramWorkerCore {
  readonly #host: SpectrogramWorkerHost;
  #dsp: ScopeDsp | undefined;
  #previews: PreviewClient | undefined;
  readonly #jobs = new Map<string, Job>();
  /** Jobs by the focus they were given last, the latest first. */
  #order: string[] = [];
  #making: Making | undefined;
  #pumping = false;

  constructor(host: SpectrogramWorkerHost) {
    this.#host = host;
  }

  /** Handles one message from the page. */
  receive(value: unknown): void {
    const read = readToSpectrogramWorker(value);
    if (!read.ok) {
      this.#host.reportFault(new Error(read.failures[0].summary));
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case ToSpectrogramWorkerKind.Dsp:
        this.#chooseDsp(message.delivery);
        break;
      case ToSpectrogramWorkerKind.Previews:
        this.#previews = new PreviewClient(previewPort<ToPreview>(message.port));
        break;
      case ToSpectrogramWorkerKind.Open:
        this.#open(message);
        break;
      case ToSpectrogramWorkerKind.Focus:
        this.#focus(message.job, message.centre);
        break;
      case ToSpectrogramWorkerKind.Want:
        this.#want(message);
        break;
      case ToSpectrogramWorkerKind.Cancel:
        this.#cancel(message.job, message.request);
        break;
      case ToSpectrogramWorkerKind.Close:
        this.#close(message.job);
        break;
    }
  }

  /**
   * A message from the page could not be deserialised, so which job it was for
   * is unknown: every job fails with the reason, rather than one leaving the
   * page waiting on a tile for ever.
   */
  messageFailed(): void {
    for (const name of [...this.#jobs.keys()]) {
      this.#fail(name, 'A message to the spectrogram worker could not be read.');
    }
  }

  #post(message: FromSpectrogramWorker): void {
    const transfer = message.kind === FromSpectrogramWorkerKind.Tile ? [message.bytes.buffer] : [];
    this.#host.post(message, transfer);
  }

  #chooseDsp(delivery: DspDelivery<CompiledModule>): void {
    const scoped = this.#host.chooseDsp(delivery);
    this.#dsp = scoped;
    this.#post({
      kind: FromSpectrogramWorkerKind.Dsp,
      implementation: scoped.dsp.implementation,
      fallbackReason: scoped.fallbackReason,
    });
  }

  #fail(job: string, reason: string): void {
    this.#close(job);
    this.#post({ kind: FromSpectrogramWorkerKind.Failed, job, reason });
  }

  #open(
    message: Extract<ToSpectrogramWorker, { kind: typeof ToSpectrogramWorkerKind.Open }>,
  ): void {
    if (this.#jobs.has(message.job)) this.#close(message.job);
    const dsp = this.#dsp;
    if (dsp === undefined) {
      this.#post({
        kind: FromSpectrogramWorkerKind.Failed,
        job: message.job,
        reason: 'The spectrogram worker was given a sound before its DSP.',
      });
      return;
    }
    const layout = discreteLayout(message.channels);
    const source = layout.ok
      ? describedSource(message.description, layout.value, dsp.dsp, {
          processing: this.#host.processing,
          quality: message.quality.settings,
          start: ProcessedStart.Canonical,
          ...(this.#previews === undefined ? {} : { cached: this.#previews }),
        })
      : layout;
    if (!source.ok) {
      this.#post({
        kind: FromSpectrogramWorkerKind.Failed,
        job: message.job,
        reason: source.failures[0].summary,
      });
      return;
    }
    this.#jobs.set(message.job, {
      name: message.job,
      identity: message.identity,
      revision: message.revision,
      source: source.value,
      dsp,
      geometries: new Map(),
      focus: 0,
      waiting: new Map(),
    });
  }

  #focus(name: string, centre: number): void {
    const job = this.#jobs.get(name);
    if (job === undefined) return;
    job.focus = centre;
    this.#order = [name, ...this.#order.filter((each) => each !== name)];
  }

  #geometryOf(job: Job, want: Want): SpectrogramGeometry {
    const name = configText(want.config);
    const kept = job.geometries.get(name);
    if (kept !== undefined) return kept;
    const made = spectrogramGeometry(
      want.config,
      job.source.length ?? 0,
      job.source.layout.roles.length,
    );
    job.geometries.set(name, made);
    return made;
  }

  #want(want: Want): void {
    const job = this.#jobs.get(want.job);
    if (job === undefined) return;
    const geometry = this.#geometryOf(job, want);
    const level = geometry.levels[want.level];
    if (level === undefined || want.index >= level.tiles || want.channel >= geometry.channels) {
      this.#fail(
        job.name,
        `The page asked for a tile the sound does not have: channel ${String(want.channel)}, level ${String(want.level)}, tile ${String(want.index)}.`,
      );
      return;
    }
    const key = wantedKey(job.identity, job.revision, want);
    let refusedCache: string | undefined;
    if (want.cached !== undefined) {
      const checked = decodeTile(
        want.cached,
        { key, columns: tileSpan(level, want.index).columns, bins: geometry.bins },
        true,
      );
      if (checked.ok) {
        this.#post({
          kind: FromSpectrogramWorkerKind.Tile,
          job: job.name,
          request: want.request,
          bytes: want.cached,
          adopted: true,
          refusedCache: undefined,
        });
        return;
      }
      refusedCache = checked.failures[0].summary;
    }
    const place = `${configText(want.config)}/${String(want.level)}/${String(want.index)}`;
    job.waiting.set(want.request, { want, geometry, level, place, refusedCache });
    if (!this.#order.includes(job.name)) this.#order.push(job.name);
    void this.#pump();
  }

  #cancel(name: string, request: number): void {
    this.#jobs.get(name)?.waiting.delete(request);
    const making = this.#making;
    if (making?.job.name !== name) return;
    making.wants.delete(request);
    if (making.wants.size === 0) making.cancel.cancel();
  }

  /** The wants at the place nearest the focus of the job focused last that has any. */
  #next(): Making | undefined {
    for (const name of this.#order) {
      const job = this.#jobs.get(name);
      if (job === undefined || job.waiting.size === 0) continue;
      const wants = takeNearestPlace(job.waiting, job.focus);
      if (wants !== undefined) return { job, wants, cancel: createCancellationSource() };
    }
    return undefined;
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      // A turn first, so the wants and focus that came with this one are read
      // and every channel wanted at a place is made in one pass.
      await this.#host.yieldToHost();
      for (let making = this.#next(); making !== undefined; making = this.#next()) {
        this.#making = making;
        await this.#make(making);
        this.#making = undefined;
        await this.#host.yieldToHost();
      }
    } finally {
      this.#making = undefined;
      this.#pumping = false;
    }
  }

  /** Makes the tiles of every channel wanted at one place, and sends each still wanted. */
  async #make(making: Making): Promise<void> {
    const [first] = making.wants.values();
    if (first === undefined) return;
    const channels = [...new Set([...making.wants.values()].map((one) => one.want.channel))];
    const { geometry } = first;
    try {
      const tiles = await analyseTiles(
        { geometry, level: first.want.level, index: first.want.index, channels },
        {
          source: making.job.source,
          dsp: making.job.dsp.dsp,
          yieldToHost: this.#host.yieldToHost,
          signal: making.cancel.signal,
        },
      );
      if (this.#jobs.get(making.job.name) !== making.job) return;
      for (const answer of answers(making.wants, { channels, tiles }, making.job)) {
        this.#post({
          kind: FromSpectrogramWorkerKind.Tile,
          job: making.job.name,
          adopted: false,
          ...answer,
        });
      }
    } catch (error) {
      // Work no want waits on any longer was stopped, and is answered with
      // nothing: the page stopped waiting when it cancelled the last of them.
      if (making.cancel.signal.aborted || this.#jobs.get(making.job.name) !== making.job) return;
      this.#fail(making.job.name, `The audio could not be analysed: ${messageOf(error)}`);
    }
  }

  #close(name: string): void {
    const job = this.#jobs.get(name);
    if (job === undefined) return;
    this.#jobs.delete(name);
    this.#order = this.#order.filter((each) => each !== name);
    if (this.#making?.job === job) this.#making.cancel.cancel();
    job.source.release();
  }
}
