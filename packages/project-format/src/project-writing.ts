/**
 * Writing a project state as the body of its document (REQ-STOR-026).
 *
 * Every entity list is written sorted by identifier and every map as a list
 * sorted by its key, so the same state always gives the same value and so the
 * same canonical text, whatever order its maps were built in. An optional
 * member that is absent is left out rather than written as `null`, so the
 * written form of a value has one shape. The writers of one asset, one source
 * entry, one media source and one identity are offered alone as well, so a
 * value a command carries is written exactly as the document writes it.
 */

import type {
  Asset,
  AssetId,
  Bus,
  ChannelLayout,
  Clip,
  EffectChain,
  Marker,
  ProcessorInstance,
  Project,
  Region,
  RoutingTarget,
  Track,
} from '@audiogubbins/domain';

import type { JsonArray, JsonObject } from './canonical-json.js';
import { presentMembers, sortedBy } from './document-writing.js';
import type {
  AssetProvenance,
  AssetSource,
  ExternalSourceIdentity,
  MediaSource,
} from './project-state.js';

/** Writes the domain project. */
export function writeProject(project: Project): JsonObject {
  const byId = (entity: { readonly id: string }): string => entity.id;
  return {
    id: project.id,
    displayName: project.displayName,
    settings: {
      sampleRate: project.settings.sampleRate,
      channelLayout: writeLayout(project.settings.channelLayout),
    },
    assets: sortedBy(project.assets.values(), byId, writeAsset),
    tracks: sortedBy(project.tracks.values(), byId, writeTrack),
    buses: sortedBy(project.buses.values(), byId, writeBus),
    clips: sortedBy(project.clips.values(), byId, writeClip),
    regions: sortedBy(project.regions.values(), byId, writeRegion),
    markers: sortedBy(project.markers.values(), byId, writeMarker),
    effectChains: sortedBy(project.effectChains.values(), byId, writeEffectChain),
    trackOrder: [...project.trackOrder],
  };
}

function writeLayout(layout: ChannelLayout): JsonArray {
  return [...layout.roles];
}

/** Writes one asset, as the project's list of assets holds it. */
export function writeAsset(asset: Asset): JsonObject {
  return {
    id: asset.id,
    displayName: asset.displayName,
    origin: asset.origin,
    sampleRate: asset.sampleRate,
    channelLayout: writeLayout(asset.channelLayout),
    length: asset.length,
    storageKey: asset.storageKey,
  };
}

function writeTarget(target: RoutingTarget): JsonObject {
  return target.kind === 'bus' ? { kind: 'bus', busId: target.busId } : { kind: 'main-output' };
}

function writeTrack(track: Track): JsonObject {
  return presentMembers({
    id: track.id,
    displayName: track.displayName,
    channelLayout: writeLayout(track.channelLayout),
    gain: track.gain,
    pan: track.pan,
    muted: track.muted,
    soloed: track.soloed,
    output: writeTarget(track.output),
    effectChainId: track.effectChainId,
    paletteKey: track.paletteKey,
  });
}

function writeBus(bus: Bus): JsonObject {
  return presentMembers({
    id: bus.id,
    displayName: bus.displayName,
    channelLayout: writeLayout(bus.channelLayout),
    gain: bus.gain,
    muted: bus.muted,
    output: bus.output === undefined ? undefined : writeTarget(bus.output),
    effectChainId: bus.effectChainId,
  });
}

function writeClip(clip: Clip): JsonObject {
  return {
    id: clip.id,
    trackId: clip.trackId,
    displayName: clip.displayName,
    source: { assetId: clip.source.assetId, start: clip.source.start, length: clip.source.length },
    timelineStart: clip.timelineStart,
    timelineLength: clip.timelineLength,
    gain: clip.gain,
    fadeInLength: clip.fadeInLength,
    fadeOutLength: clip.fadeOutLength,
    muted: clip.muted,
  };
}

function writeRegion(region: Region): JsonObject {
  return presentMembers({
    id: region.id,
    displayName: region.displayName,
    start: region.start,
    length: region.length,
    loop:
      region.loop === undefined
        ? undefined
        : {
            loopStart: region.loop.loopStart,
            loopEnd: region.loop.loopEnd,
            crossfadeLength: region.loop.crossfadeLength,
          },
    tags: [...region.tags],
  });
}

function writeMarker(marker: Marker): JsonObject {
  return presentMembers({
    id: marker.id,
    displayName: marker.displayName,
    position: marker.position,
    paletteKey: marker.paletteKey,
  });
}

function writeEffectChain(chain: EffectChain): JsonObject {
  return { id: chain.id, processors: chain.processors.map(writeProcessor) };
}

function writeProcessor(processor: ProcessorInstance): JsonObject {
  return {
    id: processor.id,
    typeKey: processor.typeKey,
    enabled: processor.enabled,
    soloed: processor.soloed,
    values: sortedBy(
      processor.values,
      ([parameter]) => parameter,
      ([parameter, value]) => ({ parameter, value }),
    ),
  };
}

/** Writes the sources, one entry per asset, sorted by asset. */
export function writeSources(sources: ReadonlyMap<AssetId, AssetSource>): JsonArray {
  return sortedBy(
    sources,
    ([assetId]) => assetId,
    ([assetId, source]) => writeSourceEntry(assetId, source),
  );
}

/** Writes one asset's source, as the list of sources holds it. */
export function writeSourceEntry(assetId: AssetId, source: AssetSource): JsonObject {
  return presentMembers({
    assetId,
    media: writeMediaSource(source.media),
    provenance: source.provenance === undefined ? undefined : writeProvenance(source.provenance),
  });
}

/** Writes where an asset's bytes are kept. */
export function writeMediaSource(media: MediaSource): JsonObject {
  if (media.kind === 'managed') {
    return {
      kind: 'managed',
      contentId: media.contentId,
      byteLength: media.byteLength,
      mediaType: media.mediaType,
    };
  }
  return presentMembers({
    kind: 'external',
    identity: writeExternalIdentity(media.identity),
    policy: media.policy,
    retainedCopy: media.retainedCopy,
  });
}

/** Writes what an external file was known by when it was last seen. */
export function writeExternalIdentity(identity: ExternalSourceIdentity): JsonObject {
  return presentMembers({
    handleKey: identity.handleKey,
    fileName: identity.fileName,
    relativePath: identity.relativePath,
    byteLength: identity.byteLength,
    lastModified: identity.lastModified,
    mediaType: identity.mediaType,
    signature: identity.signature,
    fastFingerprint: identity.fastFingerprint,
    contentId: identity.contentId,
  });
}

function writeProvenance(provenance: AssetProvenance): JsonObject {
  return presentMembers({
    originalFileName: provenance.originalFileName,
    importedAt: provenance.importedAt,
    sourceContentId: provenance.sourceContentId,
    sourceFingerprint: provenance.sourceFingerprint,
    byteLength: provenance.byteLength,
    mediaType: provenance.mediaType,
    originProjectId: provenance.originProjectId,
    bitDepth: provenance.bitDepth,
  });
}
