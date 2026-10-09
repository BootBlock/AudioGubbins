/**
 * The loopback calibration's known signal, as the transport plays it
 * (`REQ-REC-095`, `ADR-0070`).
 *
 * The burst is the recording package's, sample for sample, played as given on
 * every channel of a stereo output, through a graph of an input and an output
 * alone, so nothing between them changes a sample. It plays through playback,
 * in the context the capture runs in, so the transport's clock anchor names the
 * context frame its first frame left the engine at: the frame the round trip
 * is measured from.
 */

import {
  StandardLayouts,
  flatMapResult,
  mapResult,
  sampleRate,
  type DomainResult,
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
import { calibrationSignal } from '@audiogubbins/recording';

import type { Programme } from '../audio/programme.js';

/** The calibration's programme key, which the transport is asked about while it plays. */
export const CALIBRATION_PROGRAMME_KEY = 'latency-calibration';

const STEREO = StandardLayouts.stereo;

function node(
  id: NodeId,
  type: BuiltInNodeType,
  ports: { readonly inputs: readonly string[]; readonly outputs: readonly string[] },
): ProcessingNodeDescriptor {
  return {
    kind: 'processing',
    id,
    type,
    inputs: ports.inputs.map((name) => ({ name, layout: STEREO })),
    outputs: ports.outputs.map((name) => ({ name, layout: STEREO })),
    settings: {},
  };
}

/** The graph, built once: the burst's input straight to the output. */
const GRAPH: DomainResult<{ readonly graph: GraphDescriptor; readonly input: NodeId }> =
  flatMapResult(nodeId('calibration-signal'), (input) =>
    mapResult(nodeId('output'), (output) => ({
      input,
      graph: {
        version: GRAPH_DESCRIPTOR_VERSION,
        nodes: [
          node(input, BuiltInNodeType.GraphInput, { inputs: [], outputs: ['out'] }),
          node(output, BuiltInNodeType.Output, { inputs: ['in'], outputs: [] }),
        ],
        edges: [{ from: { node: input, port: 'out' }, to: { node: output, port: 'in' } }],
      },
    })),
  );

/**
 * The burst to play at `contextRate`. Its arrays are made for each request,
 * since loading one transfers them to the feeder.
 */
function calibrationPlayback(
  contextRate: number,
  quality: PlaybackRequest['quality'],
): DomainResult<PlaybackRequest> {
  return flatMapResult(GRAPH, ({ graph, input }) =>
    mapResult(sampleRate(contextRate), (rate) => ({
      graph,
      sources: [
        {
          node: input,
          kind: PcmDescriptionKind.Pcm,
          sampleRate: rate,
          channels: [calibrationSignal(), calibrationSignal()],
        },
      ],
      quality,
    })),
  );
}

/** The burst as the transport plays it, at whatever rate the context runs at. */
export const CALIBRATION_PROGRAMME: Programme = {
  key: CALIBRATION_PROGRAMME_KEY,
  rate: undefined,
  request: calibrationPlayback,
  playing: 'The calibration signal is playing.',
};
