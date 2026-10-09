/**
 * The cached preview producer (ADR-0061): renders a processed stream once,
 * from its own start, and lets every reader that asks for the same sound read
 * that render (`cached-streams.ts`).
 *
 * A render is kept under what decides its sound (`cached-stream-key.ts`), so
 * playback started twice, a waveform drawn out of order and an analysis all
 * read one render, and a chain's whole passes are measured once for it rather
 * than at every start. It is made in order, a chunk at a time, and read as far
 * as it has reached while it is made. Renders are made a bounded number at a
 * time, the rest waiting their turn in the order they were asked for, and the
 * renders kept are bounded in bytes (`render-cache.ts`). A render nobody holds
 * any more goes on being made, since playback stopped and started again will
 * want it, until another render waits for its place, as one for a changed
 * parameter does: the one nobody listens to is then given up for it. A made
 * render stays until the bound needs its room.
 *
 * It holds no thread of its own: the preview worker runs it, and a test runs
 * it in place, so what it does is tested without a worker.
 */

import {
  FailureKind,
  createCancellationSource,
  derivedSampleCount,
  fail,
  failure,
  sourceStreams,
  streamLength,
  succeed,
  throwIfCancelled,
  type CancellationSource,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import type { CachedStream, CachedStreamRequest, CachedStreams } from '../pcm/cached-streams.js';
import type { ChainProcessing } from '../pcm/chain-processing.js';
import { processedStreamSource } from '../pcm/edited-source.js';
import { allocateBlock, blockView } from '../pcm/frame-block.js';
import { MediaReadFailure } from '../pcm/plan-content.js';
import { ProcessedStart } from '../pcm/processed-content.js';
import { cachedStreamKey } from './cached-stream-key.js';
import { RenderCache, type Kept } from './render-cache.js';
import { RENDER_GIVEN_UP, RenderPhase, RenderedStream } from './rendered-stream.js';

/** What a render is read for, which the page shows beside its progress. */
export const CachePurpose = {
  Playback: 'playback',
  Waveform: 'waveform',
  Analysis: 'analysis',
} as const;

/** What a render is read for. */
export type CachePurpose = (typeof CachePurpose)[keyof typeof CachePurpose];

/** Frames rendered at a time, which bounds the scratch memory and changes no bit of the render. */
const RENDER_CHUNK = 16_384;

/** How far one render has come, for the page to show. */
export interface RenderReport {
  /** A name for the render, the same for its life and never another's. */
  readonly id: number;
  readonly phase: RenderPhase;
  readonly reached: number;
  readonly length: number;
  /** What its readers read it for, each once, while any holds it. */
  readonly purposes: readonly CachePurpose[];
  /** Why playback hears it rather than the chain, where playback asked for it. */
  readonly reason: string | undefined;
  /** Why it failed, where it did. */
  readonly failure: string | undefined;
}

/** What the producer is made with. */
export interface PreviewProducerOptions {
  readonly processing: ChainProcessing;
  readonly dsp: CanonicalDsp;
  /** The most bytes the renders kept may take. */
  readonly bound: number;
  /** The most renders made at once. */
  readonly concurrency: number;
  /** Hears that a render was asked for, moved on, was made, failed or was given up. */
  readonly changed?: () => void;
}

/** One render, kept by the cache, and who reads it for what. */
class Render implements Kept {
  readonly id: number;
  readonly key: string;
  readonly request: CachedStreamRequest;
  readonly stream: RenderedStream;
  readonly purposes = new Map<CachePurpose, number>();
  readonly lifetime: CancellationSource = createCancellationSource();
  reason: string | undefined;
  /** What the whole passes of its chains hold while it is made, and nothing once it is. */
  #making: number;

  constructor(
    id: number,
    key: string,
    request: CachedStreamRequest,
    stream: RenderedStream,
    making: number,
  ) {
    this.id = id;
    this.key = key;
    this.request = request;
    this.stream = stream;
    this.reason = request.reason;
    this.#making = making;
  }

  /** Its samples, and while it is made what its making holds besides. */
  get bytes(): number {
    return this.stream.bytes + this.#making;
  }

  /** Its making has let go of what it held. */
  made(): void {
    this.#making = 0;
  }

  discard(): void {
    this.lifetime.cancel();
    this.stream.fail(RENDER_GIVEN_UP);
  }

  report(): RenderReport {
    return {
      id: this.id,
      phase: this.stream.phase,
      reached: this.stream.reached,
      length: this.stream.length,
      purposes: [...this.purposes.keys()],
      reason: this.reason,
      failure: this.stream.failure?.summary,
    };
  }
}

/** A failure a read threw that is not a media failure: a fault, worded as one. */
function faultOf(error: unknown): DomainFailure {
  return failure(
    'preview.render-fault',
    FailureKind.Unrecoverable,
    `The preview could not be made: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** A stream the cache declined to keep, saying why, from which nothing is read. */
function declinedStream(problem: DomainFailure): CachedStream {
  return {
    ready: Promise.resolve(fail(problem)),
    read: () => Promise.reject(new MediaReadFailure(problem)),
    release: () => undefined,
  };
}

/** Renders processed streams once each and keeps them for every reader. */
export class PreviewProducer {
  readonly #options: PreviewProducerOptions;
  readonly #cache: RenderCache<Render>;
  readonly #queue: Render[] = [];
  #making = 0;
  #begun = 0;
  #ids = 0;

  constructor(options: PreviewProducerOptions) {
    this.#options = options;
    this.#cache = new RenderCache(options.bound);
  }

  /** How many renders were begun, each one pass of every whole-pass processor it runs. */
  get rendersBegun(): number {
    return this.#begun;
  }

  /** How far each render kept has come, the least recently used first. */
  reports(): readonly RenderReport[] {
    return this.#cache.values().map((render) => render.report());
  }

  /** The renders as a reader reading them for `purpose` opens them. */
  streams(purpose: CachePurpose): CachedStreams {
    return { open: (request) => this.#open(request, purpose) };
  }

  #open(request: CachedStreamRequest, purpose: CachePurpose): CachedStream {
    const key = cachedStreamKey(request);
    let render = this.#cache.hold(key);
    if (render === undefined) {
      const made = this.#admitted(key, request);
      if (!made.ok) return declinedStream(made.failures[0]);
      render = made.value;
      this.#queue.push(render);
      this.#next();
      this.#giveUpUnheard();
    }
    const held = render;
    held.purposes.set(purpose, (held.purposes.get(purpose) ?? 0) + 1);
    held.reason ??= request.reason;
    this.#changed();
    let released = false;
    return {
      ready: Promise.resolve(succeed(undefined)),
      read: (start, frames, into, signal) => held.stream.read(start, frames, into, signal),
      release: () => {
        if (released) return;
        released = true;
        const count = (held.purposes.get(purpose) ?? 1) - 1;
        if (count === 0) held.purposes.delete(purpose);
        else held.purposes.set(purpose, count);
        this.#cache.release(key, held);
        this.#giveUpUnheard();
        this.#changed();
      },
    };
  }

  /** A render of `request` admitted to the cache, or why the cache declines it. */
  #admitted(key: string, request: CachedStreamRequest): DomainResult<Render> {
    const stream = request.plan.streams[request.place];
    if (stream === undefined) {
      return fail(
        failure(
          'preview.stream-absent',
          FailureKind.Rejected,
          `The plan has no stream at place ${String(request.place)}.`,
        ),
      );
    }
    const making = this.#measurementBytes(request);
    if (!making.ok) return making;
    const frames = streamLength(stream);
    this.#ids += 1;
    const render = new Render(
      this.#ids,
      key,
      request,
      new RenderedStream(stream.layout.roles.length, frames),
      making.value,
    );
    const admitted = this.#cache.admit(key, render);
    return admitted.ok ? succeed(render) : admitted;
  }

  /**
   * What the whole passes hold while `request`'s stream is rendered: those of
   * its own chain and of every later stream's it reads, each run once by the
   * render and each kept until it ends, so they add. A model's pass holds its
   * output over the whole stream, so a render that fits as samples may not fit
   * while it is made; counting this against the bound before it starts is what
   * keeps the bound a bound on the worker's memory.
   */
  #measurementBytes(request: CachedStreamRequest): DomainResult<number> {
    const { plan, quality } = request;
    const seen = new Set<number>([request.place]);
    const waiting = [request.place];
    let bytes = 0;
    for (let place = waiting.pop(); place !== undefined; place = waiting.pop()) {
      const stream = plan.streams[place];
      if (stream === undefined) continue;
      const { processing } = stream;
      if (processing?.kind === 'chain') {
        const held = this.#options.processing.measurementBytes({
          chain: processing.chain,
          input: processing.input,
          sampleRate: stream.sampleRate,
          quality,
          length: streamLength(stream),
        });
        if (!held.ok) return held;
        bytes += held.value;
      }
      for (const segment of stream.segments) {
        for (const read of sourceStreams(segment.source)) {
          if (seen.has(read)) continue;
          seen.add(read);
          waiting.push(read);
        }
      }
    }
    return succeed(bytes);
  }

  /**
   * Gives up every render being made that nobody holds, where another waits
   * for a place among those being made: it would only hold that one back.
   */
  #giveUpUnheard(): void {
    if (this.#queue.length === 0) return;
    for (const render of this.#cache.values()) {
      if (render.purposes.size === 0 && render.stream.phase === RenderPhase.Making) {
        this.#cache.evict(render.key, render);
      }
    }
  }

  /** Starts the renders waiting, as many as the bound on renders made at once allows. */
  #next(): void {
    while (this.#making < this.#options.concurrency) {
      const render = this.#queue.shift();
      if (render === undefined) return;
      // Given up while it waited, as nothing held it any more.
      if (render.lifetime.signal.aborted) continue;
      this.#making += 1;
      void this.#render(render).finally(() => {
        this.#making -= 1;
        this.#changed();
        this.#next();
      });
    }
  }

  /** Makes `render`, a chunk at a time, until it is made, fails or is given up. */
  async #render(render: Render): Promise<void> {
    const { request, stream } = render;
    const signal = render.lifetime.signal;
    this.#begun += 1;
    stream.begin();
    this.#changed();
    const source = processedStreamSource(
      request.plan,
      request.media,
      request.place,
      this.#options.dsp,
      {
        processing: this.#options.processing,
        quality: request.quality,
        start: ProcessedStart.Canonical,
      },
    );
    if (!source.ok) {
      this.#failed(render, source.failures[0]);
      return;
    }
    const block = allocateBlock(source.value.layout, source.value.sampleRate, RENDER_CHUNK);
    try {
      while (stream.reached < stream.length) {
        throwIfCancelled(signal);
        const frames = Math.min(RENDER_CHUNK, stream.length - stream.reached);
        const read = await source.value.read(
          derivedSampleCount(stream.reached),
          blockView(block, 0, frames),
          signal,
        );
        stream.append(block.channels, read);
        this.#changed();
        if (read < frames) {
          this.#failed(render, faultOf(new Error('The stream ended before its length.')));
          return;
        }
      }
    } catch (error) {
      // Given up by the cache, which has already failed its reads.
      if (signal.aborted) return;
      this.#failed(render, error instanceof MediaReadFailure ? error.failure : faultOf(error));
    } finally {
      source.value.release();
      // The chains' runs, and the measurements they held, are let go.
      render.made();
      this.#cache.recount(render.key, render);
    }
  }

  /** Ends `render` with `problem`, giving it up so the next reader asks for it afresh. */
  #failed(render: Render, problem: DomainFailure): void {
    render.stream.fail(problem);
    this.#cache.evict(render.key, render);
    this.#changed();
  }

  #changed(): void {
    this.#options.changed?.();
  }
}
