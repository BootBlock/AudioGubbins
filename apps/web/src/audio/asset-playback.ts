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
 */

import {
  StandardLayouts,
  flatMapResult,
  layoutsMatch,
  mapResult,
  type ChannelLayout,
} from '@audiogubbins/domain';
import {
  GRAPH_DESCRIPTOR_VERSION,
  nodeId,
  type GraphDescriptor,
  type NodeId,
  type ProcessingNodeDescriptor,
} from '@audiogubbins/audio-graph';
import { BuiltInNodeType } from '@audiogubbins/audio-engine';

import type { EditorAsset } from '../assets/editor-asset.js';
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

/** The programme that plays `asset` at its native rate. */
export function assetProgramme(asset: EditorAsset): Programme {
  return {
    key: asset.id,
    rate: asset.sampleRate,
    playing: `${asset.name} is playing.`,
    // The context's rate is not checked here: a context the browser made at
    // another rate is refused by the session, which says so, rather than the
    // asset being played at the wrong speed.
    request: () =>
      flatMapResult(nodeId('asset'), (input) =>
        flatMapResult(nodeId('meter'), (meter) =>
          mapResult(nodeId('output'), (output) => ({
            graph: graphOf(asset.layout, input, meter, output),
            sources: [{ node: input, ...asset.describe() }],
          })),
        ),
      ),
  };
}
