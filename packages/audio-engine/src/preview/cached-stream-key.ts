/**
 * What decides the sound of a processed stream's render, as one text: the
 * key the cached preview producer keeps a render under (ADR-0061).
 *
 * A render is the stream's processed output from its own start, so its sound is
 * decided by the stream and everything it reads: its segments and stages; its
 * chain with every parameter value, its learned state and each processor's
 * versions, a model's identity among them (ADR-0062), but not the identifiers
 * of the chain and its slots, which a copy changes and the sound does not; each
 * later stream a segment reads, alone or summed in a mix in the order the mix
 * states, written once and named by its index among them rather than by its
 * place in the plan, since a rack edit renumbers streams without changing what
 * they sound like; each file by what its content is known by, its rate,
 * channels and length, rather than by the asset that names it; the quality the
 * chains run at; and the version of the render itself, raised when the engine's
 * rendering changes. Nothing else is in it, so a change anywhere else in the
 * project finds the render again, and a change to any of these makes another.
 */

import type {
  AssetId,
  ChainSlot,
  EditPlan,
  PlanSegment,
  PlanStream,
  StreamProcessing,
} from '@audiogubbins/domain';

import type { CachedStreamRequest } from '../pcm/cached-streams.js';
import type { MediaEntry } from '../pcm/plan-content.js';
import { canonicalText } from './canonical-text.js';

/**
 * The version of how the engine renders a processed stream: the reading of
 * segments, their stages and conversions. Raised whenever that changes the
 * bits, so a cache kept across a change never answers with the old sound.
 */
const CACHED_RENDER_VERSION = 1;

/**
 * Each stream the requested one reads, once, in the order a walk from it
 * finishes them: a segment names the stream it reads by its index in that
 * list rather than by its place in the plan or by writing it out again. A
 * stream two segments read (a rack edit and a cut over it make two) would
 * otherwise be written once per reader, so the text doubled at every level
 * of nesting. Streams that sound alike share one index, whatever their
 * places, so a renumbering changes nothing.
 */
class StreamValues {
  readonly #plan: EditPlan;
  readonly #media: ReadonlyMap<AssetId, MediaEntry>;
  /** The index of each place's stream, once finished. */
  readonly #indices = new Map<number, number>();
  /** The index of each distinct stream, by its text. */
  readonly #byText = new Map<string, number>();
  readonly values: unknown[] = [];

  constructor(plan: EditPlan, media: ReadonlyMap<AssetId, MediaEntry>) {
    this.#plan = plan;
    this.#media = media;
  }

  /** The index of the stream at `place`, writing it and what it reads first. */
  indexOf(place: number): number {
    const already = this.#indices.get(place);
    if (already !== undefined) return already;
    const stream: PlanStream | undefined = this.#plan.streams[place];
    if (stream === undefined) throw new Error('A validated plan names only streams it has.');
    const value = {
      sampleRate: stream.sampleRate,
      layout: stream.layout,
      processing: processingValue(stream.processing),
      segments: stream.segments.map((segment: PlanSegment) => this.#segmentValue(segment)),
    };
    // A stream's text holds only the indices of what it reads, so it is as
    // long as the stream itself and the whole key stays linear in the plan.
    const text = canonicalText(value);
    let index = this.#byText.get(text);
    if (index === undefined) {
      index = this.values.length;
      this.values.push(value);
      this.#byText.set(text, index);
    }
    this.#indices.set(place, index);
    return index;
  }

  /**
   * A segment as its sound is decided: a file by its content, a stream by its
   * index, and silence by its channels alone, since where a segment starts in
   * silence changes nothing it makes.
   */
  #segmentValue(segment: PlanSegment): unknown {
    const { source } = segment;
    switch (source.kind) {
      case 'media':
        return { ...segment, source: fileValue(this.#media, source.asset) };
      case 'stream':
        return { ...segment, source: { stream: this.indexOf(source.stream) } };
      case 'silence':
        return { ...segment, start: 0, source: { silence: source.channels } };
      case 'mix':
        return { ...segment, source: { mix: source.streams.map((place) => this.indexOf(place)) } };
    }
  }
}

/**
 * A stream's processing as its sound is decided: a chain without its
 * identifiers, and a spectral edit's chain likewise.
 */
function processingValue(processing: StreamProcessing | undefined): unknown {
  if (processing?.kind === 'chain') {
    return {
      kind: processing.kind,
      input: processing.input,
      slots: processing.chain.slots.map(slotValue),
    };
  }
  if (processing?.kind === 'spectral') {
    const { operation } = processing.edit;
    return {
      kind: processing.kind,
      edit: {
        ...processing.edit,
        operation:
          operation.kind === 'process'
            ? {
                kind: operation.kind,
                input: operation.input,
                slots: operation.chain.slots.map(slotValue),
              }
            : operation,
      },
    };
  }
  return processing;
}

/** A slot without its identifier, and its branches' slots likewise. */
function slotValue(slot: ChainSlot): unknown {
  const { enabled, soloed, mix } = slot;
  if (slot.kind === 'processor') {
    const { typeKey, version, values, state } = slot;
    return { kind: slot.kind, enabled, soloed, mix, typeKey, version, values, state };
  }
  return {
    kind: slot.kind,
    enabled,
    soloed,
    mix,
    summing: slot.summing,
    branches: slot.branches.map((branch) => branch.slots.map(slotValue)),
  };
}

/** A file by what its content is known by and its shape, not by the asset that names it. */
function fileValue(media: ReadonlyMap<AssetId, MediaEntry>, asset: AssetId): unknown {
  const entry = media.get(asset);
  if (entry === undefined) throw new Error('A validated plan reads only the files it was given.');
  return {
    file: entry.identity,
    sampleRate: entry.sampleRate,
    channels: entry.channels,
    length: entry.length,
  };
}

/** The key a render of `request`'s stream is kept under (see the module comment). */
export function cachedStreamKey(request: CachedStreamRequest): string {
  const streams = new StreamValues(
    request.plan,
    new Map(request.media.map((entry) => [entry.asset, entry])),
  );
  const stream = streams.indexOf(request.place);
  return canonicalText({
    render: CACHED_RENDER_VERSION,
    quality: request.quality,
    stream,
    streams: streams.values,
  });
}
