/**
 * A plan rendered whole from sources held in memory, for a test.
 *
 * Reads each segment's content the way the engine's edited source does,
 * forwards or backwards, and gives it to the domain's own stage arithmetic,
 * so a test comparing this with the edit oracle checks the plan's fold and
 * its arithmetic together. A stream another reads is rendered whole from its
 * own start, through its processing, which the test states as an
 * `OracleWorld` like the oracle's; the canonical resampler and the processors
 * are the engine's, so their own tests render them.
 */

import type { AssetId } from '../identity/branded-id.js';
import {
  convertedFrameCount,
  segmentsLayout,
  segmentsLength,
  type EditPlan,
  type PlanStream,
} from '../editing/plan.js';
import { applyStages, placeOf, sumInto } from '../editing/stage-arithmetic.js';
import type { OracleWorld, Samples } from './edit-oracle.js';

/** One stream of the plan, rendered whole, before any conversion to its reader's rate. */
function renderStream(
  plan: EditPlan,
  place: number,
  sources: ReadonlyMap<AssetId, Samples>,
  world: OracleWorld,
): Samples {
  const stream: PlanStream | undefined = plan.streams[place];
  if (stream === undefined) throw new Error(`The plan has no stream ${String(place)}.`);
  const total = segmentsLength(stream);
  const out = segmentsLayout(stream).roles.map(() => new Float32Array(total));
  let position = 0;
  for (const segment of stream.segments) {
    let content: Samples;
    if (segment.source.kind === 'silence') {
      content = Array.from(
        { length: segment.source.channels },
        () => new Float32Array(segment.start + segment.length),
      );
    } else if (segment.source.kind === 'media') {
      const source = sources.get(segment.source.asset);
      if (source === undefined) throw new Error(`No samples for ${segment.source.asset}.`);
      content = source;
    } else if (segment.source.kind === 'mix') {
      content = mixedContent(plan, segment.source.streams, sources, world);
    } else {
      const read = plan.streams[segment.source.stream];
      content = renderStream(plan, segment.source.stream, sources, world);
      if (read !== undefined && read.sampleRate !== stream.sampleRate) {
        content = (world.convert ?? missing('a conversion'))(
          content,
          read.sampleRate,
          stream.sampleRate,
          convertedFrameCount(content[0]?.length ?? 0, read.sampleRate, stream.sampleRate),
        );
      }
    }
    const place = placeOf(segment);
    const block = content.map((channel) =>
      Float32Array.from(
        { length: place.frames },
        (_, index) => channel[place.first + index * place.step] ?? 0,
      ),
    );
    const result = applyStages(segment.stages, place, block);
    result.forEach((channel, index) => out[index]?.set(channel, position));
    position += segment.length;
  }
  const { processing } = stream;
  if (processing === undefined) return out;
  if (processing.kind === 'stretch') {
    return (world.stretch ?? missing('a stretch'))(out, processing.length);
  }
  if (processing.kind === 'spectral') {
    const { mask, resolution, operation, channels } = processing.edit;
    return (world.spectral ?? missing('a spectral edit'))(
      {
        mask,
        resolution,
        operation:
          operation.kind === 'process' ? { kind: 'process', chain: operation.chain.id } : operation,
      },
      channels,
      out,
    );
  }
  return (world.chain ?? missing('a chain'))(processing.chain.id, out);
}

/** The streams `places` names, each rendered whole, summed in order by the plan's rule. */
function mixedContent(
  plan: EditPlan,
  places: readonly number[],
  sources: ReadonlyMap<AssetId, Samples>,
  world: OracleWorld,
): Samples {
  const [first, ...rest] = places.map((place) => renderStream(plan, place, sources, world));
  if (first === undefined) throw new Error('A mix sums two or more streams.');
  const sum = first.map((channel) => Float32Array.from(channel));
  for (const addend of rest)
    sumInto(sum, addend, Math.min(sum[0]?.length ?? 0, addend[0]?.length ?? 0));
  return sum;
}

function missing(what: string): never {
  throw new Error(`The test did not say what ${what} does.`);
}

/** The plan's first stream, rendered from `sources`, one array per channel. */
export function renderPlan(
  plan: EditPlan,
  sources: ReadonlyMap<AssetId, Samples>,
  world: OracleWorld = {},
): Samples {
  return renderStream(plan, 0, sources, world);
}
