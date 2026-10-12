/**
 * Playing an asset: the graph it plays through and the programme the
 * transport is given for it.
 *
 * The graph is the asset's own layout from its source to the output, with a
 * meter beside the output, `graph-input → meter + output`, so any number of
 * channels plays as it is: the output places each channel on the device by
 * its role, or refuses with the reason where the device cannot take them
 * (Phase 03's rule that nothing is downmixed or truncated at the device). The
 * meter correlates the first two channels of a stereo asset, which the
 * Transport panel shows.
 *
 * An asset a chain processes is played as it is processed, or as its
 * original, every chain bypassed, as the person chose (REQ-AUDIO-019). Either
 * is the programme of the asset, under its key, so switching is followed
 * where it plays, as any other change of its sound is.
 */

import {
  StandardLayouts,
  flatMapResult,
  layoutsMatch,
  mapResult,
  type ChannelLayout,
  type DomainResult,
  type QualityMode,
} from '@audiogubbins/domain';
import {
  GRAPH_DESCRIPTOR_VERSION,
  nodeId,
  type GraphDescriptor,
  type NodeId,
  type ProcessingNodeDescriptor,
} from '@audiogubbins/audio-graph';
import { BuiltInNodeType } from '@audiogubbins/audio-engine';
import type { PlaybackRequest } from '@audiogubbins/audio-runtime';

import type { EditorAsset } from '../assets/editor-asset.js';
import { Hearing } from '../state/hearing-store.js';
import type { Programme } from './programme.js';

function node(
  id: NodeId,
  type: BuiltInNodeType,
  layout: ChannelLayout,
  ports: { readonly inputs: readonly string[]; readonly outputs: readonly string[] },
  settings: ProcessingNodeDescriptor['settings'] = {},
): ProcessingNodeDescriptor {
  return {
    kind: 'processing',
    id,
    type,
    inputs: ports.inputs.map((name) => ({ name, layout })),
    outputs: ports.outputs.map((name) => ({ name, layout })),
    settings,
  };
}

function graphOf(
  layout: ChannelLayout,
  input: NodeId,
  meter: NodeId,
  output: NodeId,
): GraphDescriptor {
  const stereo = layoutsMatch(layout, StandardLayouts.stereo);
  return {
    version: GRAPH_DESCRIPTOR_VERSION,
    nodes: [
      node(input, BuiltInNodeType.GraphInput, layout, { inputs: [], outputs: ['out'] }),
      node(
        meter,
        BuiltInNodeType.Meter,
        layout,
        { inputs: ['in'], outputs: [] },
        stereo ? { correlate: [0, 1] } : {},
      ),
      node(output, BuiltInNodeType.Output, layout, { inputs: ['in'], outputs: [] }),
    ],
    edges: [
      { from: { node: input, port: 'out' }, to: { node: meter, port: 'in' } },
      { from: { node: input, port: 'out' }, to: { node: output, port: 'in' } },
    ],
  };
}

/** The programme that plays `asset` at its native rate, as `hearing` chooses it. */
export function assetProgramme(asset: EditorAsset, hearing: Hearing): Programme {
  const original = hearing === Hearing.Original ? asset.original : undefined;
  if (original !== undefined) {
    return {
      key: asset.id,
      rate: asset.sampleRate,
      playing: `${asset.name} is playing as its original, every chain and spectral edit bypassed.`,
      content: original.content,
      plan: original.plan,
      request: (_contextRate, quality) => requestOf(original.layout, original.describe, quality),
    };
  }
  return {
    key: asset.id,
    rate: asset.sampleRate,
    playing: `${asset.name} is playing.`,
    content: asset.content,
    ...(asset.owner.kind === 'project' ? { plan: asset.owner.plan } : {}),
    // The context's rate is not checked here: a context the browser made at
    // another rate is refused by the session, which says so, rather than the
    // asset being played at the wrong speed.
    request: (_contextRate, quality) => requestOf(asset.layout, asset.describe, quality),
  };
}

/** The request that plays audio of `layout`, described by `describe`, previewing at `quality`. */
function requestOf(
  layout: ChannelLayout,
  describe: EditorAsset['describe'],
  quality: QualityMode,
): DomainResult<PlaybackRequest> {
  return flatMapResult(nodeId('asset'), (input) =>
    flatMapResult(nodeId('meter'), (meter) =>
      mapResult(nodeId('output'), (output) => ({
        graph: graphOf(layout, input, meter, output),
        sources: [{ node: input, ...describe() }],
        quality,
      })),
    ),
  );
}
