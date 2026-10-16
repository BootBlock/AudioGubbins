/**
 * What of a playback request that continues the loaded one goes to the
 * feeder (ADR-0104).
 *
 * A continuation keeps the processor's graph and the feeder's sources as they
 * are, so it may change nothing either holds but the plans of its edited
 * sounds: the graph, the preview quality and every other source must be what
 * the loaded request has. A tone is compared by its recipe; recorded audio in
 * memory crossed to the feeder transferred, so the page no longer holds what
 * it was and a request holding some is loaded instead. What is left are the
 * edited sounds, whose new plans the feeder goes on into; a request with none
 * is the loaded one as it stands, and goes on at once.
 */

import { canonicalText, PcmDescriptionKind } from '@audiogubbins/audio-engine';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import type { SourceDescription } from '../protocol/source-descriptions.js';
import type { PlaybackRequest } from './playback-preparation.js';
import type { Continuation, RequestSources } from './request-sources.js';

function unmatched(summary: string): DomainResult<never> {
  return fail(failure('playback.continuation-unmatched', FailureKind.Rejected, summary));
}

/** Why `next` cannot go on from `loaded`'s source of the same graph input, or `undefined` where it can. */
function sourceRefusal(
  loaded: SourceDescription,
  next: SourceDescription,
): DomainResult<never> | undefined {
  if (loaded.kind !== next.kind) {
    return unmatched(`The audio of ${next.node} changed kind, so the programme is loaded again.`);
  }
  switch (next.kind) {
    case PcmDescriptionKind.Edited:
      return undefined;
    case PcmDescriptionKind.Signal:
      return canonicalText(loaded) === canonicalText(next)
        ? undefined
        : unmatched(`The tone of ${next.node} changed, so the programme is loaded again.`);
    case PcmDescriptionKind.Pcm:
      return unmatched(
        `Recorded audio in memory plays at ${next.node}, which cannot be compared once it has been sent, so the programme is loaded again.`,
      );
  }
}

/**
 * The edited sounds of `next`, which continues `loaded`, for the feeder to go
 * on into, or why `next` cannot go on from `loaded` and is loaded instead.
 */
function continuedSources(
  loaded: PlaybackRequest,
  next: PlaybackRequest,
): DomainResult<readonly SourceDescription[]> {
  if (canonicalText(loaded.graph) !== canonicalText(next.graph)) {
    return unmatched('The programme’s graph changed, so it is loaded again.');
  }
  if (canonicalText(loaded.quality) !== canonicalText(next.quality)) {
    return unmatched('The preview quality changed, so the programme is loaded again.');
  }
  const before = new Map(loaded.sources.map((source) => [source.node, source]));
  if (before.size !== next.sources.length) {
    return unmatched('The programme feeds other graph inputs, so it is loaded again.');
  }
  const edited: SourceDescription[] = [];
  const seen = new Set<string>();
  for (const source of next.sources) {
    const was = before.get(source.node);
    if (was === undefined || seen.has(source.node)) {
      return unmatched(`The programme feeds ${source.node} afresh, so it is loaded again.`);
    }
    seen.add(source.node);
    const refused = sourceRefusal(was, source);
    if (refused !== undefined) return refused;
    if (source.kind === PcmDescriptionKind.Edited) edited.push(source);
  }
  return succeed(edited);
}

/**
 * Goes on from `loaded`, the request loaded, into `next`, which continues it
 * from timeline frame `from` at the latest, through `sources`, the loaded
 * request's in the feeder, and settles with how it came out.
 */
export async function continueRequest(
  loaded: PlaybackRequest | undefined,
  next: PlaybackRequest,
  sources: Pick<RequestSources, 'continueWith'> | undefined,
  from: SampleCount,
): Promise<DomainResult<Continuation>> {
  if (loaded === undefined) {
    return fail(
      failure(
        'playback.continuation-unloaded',
        FailureKind.Conflict,
        'Nothing is loaded for the programme to go on from.',
      ),
    );
  }
  const edited = continuedSources(loaded, next);
  if (!edited.ok) return edited;
  if (edited.value.length === 0) return succeed({ kind: 'continued', frame: from });
  if (sources === undefined) {
    // A wiring mistake: a graph that feeds an edited sound has its sources in the feeder.
    throw new Error('A request with an edited sound has no sources in the feeder.');
  }
  return await sources.continueWith(next, edited.value, from);
}
