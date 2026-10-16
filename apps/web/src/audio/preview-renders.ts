/**
 * The renders a game preview's members are heard from, made before a run
 * (ADR-0104, ADR-0061 amended): a member whose sound runs a chain that cannot
 * be run as it is heard, as a loudness normaliser that measures its whole input
 * first cannot, is played from the preview worker's render of it, and a voice
 * that reached a render still being made would wait for it. So the preview asks
 * for each such render while the scenario is set up, holds it while the
 * scenario is, and runs only once every one is made.
 *
 * A render is kept under what decides its sound, not under its place in a plan
 * (`cached-stream-key.ts`), so the render of a member's own stream is the one
 * each voice's copy of it reads. A render the cache declines is not waited for:
 * the voice runs the chain itself, and the reason is said.
 */

import {
  Cancelled,
  chainListening,
  channelCount,
  createCancellationSource,
  streamLength,
  type EditPlan,
  type ProcessorCatalogue,
  type QualitySettings,
} from '@audiogubbins/domain';
import type { CachedStream, CachedStreams, MediaEntry } from '@audiogubbins/audio-engine';

/** One render a member is heard from: its plan and the place of its stream. */
export interface RenderRequest {
  readonly plan: EditPlan;
  readonly place: number;
  readonly reason: string;
}

/** How far the renders have come: how many are needed, made, and why any is not kept. */
export interface RenderProgress {
  readonly needed: number;
  readonly made: number;
  readonly declined: readonly string[];
}

/** No render needed. */
const NO_RENDERS: RenderProgress = { needed: 0, made: 0, declined: [] };

/** Every stream of `members` heard from a render at `quality`, with why. */
export function renderRequests(
  members: Iterable<EditPlan>,
  catalogue: ProcessorCatalogue,
  quality: QualitySettings,
): readonly RenderRequest[] {
  const requests: RenderRequest[] = [];
  for (const plan of members) {
    for (const [place, stream] of plan.streams.entries()) {
      const processing = stream.processing;
      if (processing?.kind !== 'chain') continue;
      const listening = chainListening(processing.chain, catalogue, {
        sampleRate: stream.sampleRate,
        quality,
      });
      if (listening.kind === 'rendered') requests.push({ plan, place, reason: listening.reason });
    }
  }
  return requests;
}

/** The last frame of the stream at `place` in `plan`, which a render makes last, and its channels. */
function lastFrame(
  plan: EditPlan,
  place: number,
): { readonly at: number; readonly channels: number } {
  const stream = plan.streams[place];
  return stream === undefined
    ? { at: 0, channels: 1 }
    : { at: Math.max(0, streamLength(stream) - 1), channels: channelCount(stream.layout) };
}

/** The renders a set-up scenario's members are heard from, asked for and held. */
export class RenderPreparation {
  readonly #held: CachedStream[] = [];
  /** Gives up the reads waiting on renders once the preparation is let go. */
  readonly #cancel = createCancellationSource();
  #progress: RenderProgress;

  /**
   * Asks `renders` for each of `requests` at `quality`, reading `media`, and
   * tells `progressed` as each is made or declined.
   */
  constructor(
    renders: CachedStreams,
    work: {
      readonly requests: readonly RenderRequest[];
      readonly media: readonly MediaEntry[];
      readonly quality: QualitySettings;
    },
    progressed: (progress: RenderProgress) => void,
  ) {
    this.#progress = { needed: work.requests.length, made: 0, declined: [] };
    for (const request of work.requests) {
      const stream = renders.open({
        plan: request.plan,
        place: request.place,
        media: work.media,
        quality: work.quality,
        reason: request.reason,
      });
      this.#held.push(stream);
      void this.#made(stream, lastFrame(request.plan, request.place)).then((declined) => {
        if (this.#cancel.signal.aborted) return;
        const { made, needed } = this.#progress;
        this.#progress = {
          needed,
          made: made + 1,
          declined:
            declined === undefined
              ? this.#progress.declined
              : [...this.#progress.declined, declined],
        };
        progressed(this.#progress);
      });
    }
  }

  get progress(): RenderProgress {
    return this.#progress;
  }

  /**
   * Settles once `stream` is made to its `last` frame, with why it was declined
   * or failed where it was, and with nothing once let go.
   */
  async #made(
    stream: CachedStream,
    last: { readonly at: number; readonly channels: number },
  ): Promise<string | undefined> {
    const ready = await stream.ready;
    if (!ready.ok) return ready.failures[0].summary;
    const into = Array.from({ length: last.channels }, () => new Float32Array(1));
    try {
      // A read past a render's progress waits for it, so a read of its last
      // frame settles once the render is whole.
      await stream.read(last.at, 1, into, this.#cancel.signal);
      return undefined;
    } catch (error) {
      // Let go meanwhile, or the render failed, which a voice would read
      // too: the reason is said, and the voice runs the chain itself.
      if (error instanceof Cancelled) return undefined;
      if (error instanceof Error) return error.message;
      throw error;
    }
  }

  /** Lets every render go, which the cache may then give up. */
  release(): void {
    this.#cancel.cancel();
    for (const stream of this.#held) stream.release();
    this.#held.length = 0;
  }
}

/** Whether two lists of requests ask for the same renders: the same plans' same streams. */
function sameRequests(left: readonly RenderRequest[], right: readonly RenderRequest[]): boolean {
  return (
    left.length === right.length &&
    left.every((one, index) => one.plan === right[index]?.plan && one.place === right[index].place)
  );
}

/**
 * The renders held for the scenario set up now: those of the last requests
 * given, kept while the same requests are given again and let go for new ones.
 */
export class HeldRenders {
  readonly #renders: () => CachedStreams;
  readonly #progressed: (progress: RenderProgress) => void;
  #held:
    { readonly requests: readonly RenderRequest[]; readonly work: RenderPreparation } | undefined;

  /** Holds renders opened through `renders`, made on first use, telling `progressed` how far they have come. */
  constructor(renders: () => CachedStreams, progressed: (progress: RenderProgress) => void) {
    this.#renders = renders;
    this.#progressed = progressed;
  }

  /** Holds the renders `requests` ask for at `quality`, reading `media`. */
  hold(
    requests: readonly RenderRequest[],
    media: readonly MediaEntry[],
    quality: QualitySettings,
  ): void {
    if (this.#held !== undefined && sameRequests(this.#held.requests, requests)) return;
    this.release();
    if (requests.length === 0) return;
    const work = new RenderPreparation(
      this.#renders(),
      { requests, media, quality },
      this.#progressed,
    );
    this.#held = { requests, work };
    this.#progressed(work.progress);
  }

  /** Lets every render held go. */
  release(): void {
    this.#held?.work.release();
    this.#held = undefined;
    this.#progressed(NO_RENDERS);
  }
}
