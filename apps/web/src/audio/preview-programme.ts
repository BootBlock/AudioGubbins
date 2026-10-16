/**
 * The programme of a game preview (ADR-0104): a preview plan played as the
 * transport plays every edited sound, through a graph of its sound in the
 * project's layout to a meter and the output, at the project's rate, and
 * going on from the programme playing where it continues one. Its content is
 * a version the run counts, so the transport tells a running change of its
 * values (a still emitter moved, a bus fader) from the plan before.
 */

import {
  StandardLayouts,
  flatMapResult,
  layoutsMatch,
  mapResult,
  type ChannelLayout,
  type DomainResult,
  type QualityMode,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  GRAPH_DESCRIPTOR_VERSION,
  nodeId,
  type GraphDescriptor,
  type NodeId,
  type ProcessingNodeDescriptor,
} from '@audiogubbins/audio-graph';
import { BuiltInNodeType, PcmDescriptionKind } from '@audiogubbins/audio-engine';
import type { PlaybackRequest } from '@audiogubbins/audio-runtime';
import type { PreviewPlan } from '@audiogubbins/game-audio';

import type { PreviewSetup } from './preview-setup.js';
import type { Programme } from './programme.js';

function processingNode(
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

/** The graph a preview plays through: its sound, in the project's layout, to a meter and the output. */
function previewGraph(
  layout: ChannelLayout,
  input: NodeId,
  meter: NodeId,
  output: NodeId,
): GraphDescriptor {
  const stereo = layoutsMatch(layout, StandardLayouts.stereo);
  return {
    version: GRAPH_DESCRIPTOR_VERSION,
    nodes: [
      processingNode(input, BuiltInNodeType.GraphInput, layout, { inputs: [], outputs: ['out'] }),
      processingNode(
        meter,
        BuiltInNodeType.Meter,
        layout,
        { inputs: ['in'], outputs: [] },
        stereo ? { correlate: [0, 1] } : {},
      ),
      processingNode(output, BuiltInNodeType.Output, layout, { inputs: ['in'], outputs: [] }),
    ],
    edges: [
      { from: { node: input, port: 'out' }, to: { node: meter, port: 'in' } },
      { from: { node: input, port: 'out' }, to: { node: output, port: 'in' } },
    ],
  };
}

/**
 * The programme that plays `plan` of `setup` under `key`, its `version` its
 * content, going on from the programme of `key` from `from` where given.
 */
export function previewProgramme(
  setup: PreviewSetup,
  key: string,
  version: number,
  plan: PreviewPlan['plan'],
  from?: SampleCount,
): Programme {
  const request = (quality: QualityMode): DomainResult<PlaybackRequest> =>
    flatMapResult(nodeId('preview'), (input) =>
      flatMapResult(nodeId('meter'), (meter) =>
        mapResult(nodeId('output'), (output) => ({
          graph: previewGraph(setup.layout, input, meter, output),
          sources: [
            {
              node: input,
              kind: PcmDescriptionKind.Edited,
              sampleRate: setup.rate,
              plan,
              media: setup.media,
            },
          ],
          quality,
        })),
      ),
    );
  return {
    key,
    rate: setup.rate,
    playing: `The preview of ${setup.scenario.name} is playing.`,
    content: `${key}#${String(version)}`,
    plan,
    request: (_contextRate, quality) => request(quality),
    ...(from === undefined ? {} : { continues: { key, from } }),
  };
}
