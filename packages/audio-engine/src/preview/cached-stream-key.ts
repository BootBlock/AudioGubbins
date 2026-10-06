/**
 * What decides the sound of a processed stream's render, as one text: the
 * key the cached preview producer keeps a render under (ADR-0061).
 *
 * A render is the stream's processed output from its own start, so its sound
 * is decided by the stream and everything it reads: its segments and stages;
 * its chain with every parameter value, its learned state and each
 * processor's versions, a model's identity among them (ADR-0062), but not
 * the identifiers of the chain and its slots, which a copy changes and the
 * sound does not; each later stream a segment reads, written in place of its
 * place in the plan, since a rack edit renumbers streams without changing
 * what they sound like; each file by what its content is known by, its rate,
 * channels and length, rather than by the asset that names it; the quality
 * the chains run at; and the version of the render itself, raised when the
 * engine's rendering changes. Nothing else is in it, so a change anywhere
 * else in the project finds the render again, and a change to any of these
 * makes another.
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

/** A stream as its sound is decided, with every stream it reads in place of its place. */
function streamValue(
  plan: EditPlan,
  place: number,
  media: ReadonlyMap<AssetId, MediaEntry>,
  known: Map<number, unknown>,
): unknown {
  const already = known.get(place);
  if (already !== undefined) return already;
  const stream: PlanStream | undefined = plan.streams[place];
  if (stream === undefined) throw new Error('A validated plan names only streams it has.');
  const value = {
    sampleRate: stream.sampleRate,
    layout: stream.layout,
    processing: processingValue(stream.processing),
    segments: stream.segments.map((segment: PlanSegment) => ({
      ...segment,
      source:
        segment.source.kind === 'media'
          ? fileValue(media, segment.source.asset)
          : { stream: streamValue(plan, segment.source.stream, media, known) },
    })),
  };
  known.set(place, value);
  return value;
}

/** A stream's processing as its sound is decided: a chain without its identifiers. */
function processingValue(processing: StreamProcessing | undefined): unknown {
  return processing?.kind === 'chain'
    ? {
        kind: processing.kind,
        input: processing.input,
        slots: processing.chain.slots.map(slotValue),
      }
    : processing;
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
  const media = new Map(request.media.map((entry) => [entry.asset, entry]));
  return canonicalText({
    render: CACHED_RENDER_VERSION,
    quality: request.quality,
    stream: streamValue(request.plan, request.place, media, new Map()),
  });
}
