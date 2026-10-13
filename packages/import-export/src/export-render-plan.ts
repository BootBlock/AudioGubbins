/**
 * The graph an export renders through, and the render's rate and range
 * (ADR-0060, ADR-0092).
 *
 * An export renders through the canonical engine like any other render: the
 * span's audio, with its racks, is bound to the graph's input, and the
 * engine converts it to the export's rate at the quality's resampling grade.
 * The channel conversion is a node of the graph, a matrix or a channel map
 * from `layoutConversion`, so a downmix is the engine's arithmetic and not
 * the encoder's. The range is the span's, its ends placed at the export's
 * rate by the domain's one rounding rule for a change of rate, the rule the
 * file's loop and cue positions are placed by.
 *
 * What the caller binds: the span's audio as a `PcmSource` to `input`, at its
 * own rate, and the encoder's sink to `output`; the dither and quantisation
 * (`Quantiser`) take the sink's blocks before an integer encoder.
 */

import {
  addSamples,
  convertSampleRate,
  flatMapResult,
  mapResult,
  subtractSamples,
  type ChannelLayout,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  GRAPH_DESCRIPTOR_VERSION,
  nodeId,
  type GraphDescriptor,
  type NodeId,
  type ProcessingNodeDescriptor,
} from '@audiogubbins/audio-graph';
import { BuiltInNodeType, type RenderRange } from '@audiogubbins/audio-engine';

import type { ExportSpan } from './export-range.js';
import type { ChannelConversion } from './export-settings.js';
import { layoutConversion, type LayoutConversion } from './layout-conversion.js';

/** What an export's render is made of, beside the audio and the sink the caller binds. */
export interface ExportRenderPlan {
  readonly graph: GraphDescriptor;

  /** The node the span's audio is bound to. */
  readonly input: NodeId;

  /** The node whose audio the encoder is given. */
  readonly output: NodeId;
  readonly sampleRate: SampleRate;
  readonly range: RenderRange;

  /** The layout of the rendered audio, which the file states. */
  readonly layout: ChannelLayout;
}

/** Node identifiers, made once: they are constant, so a failure here is a fault. */
function constantId(value: string): NodeId {
  const made = nodeId(value);
  if (!made.ok) throw new Error(`"${value}" is not a node identifier.`);
  return made.value;
}

const INPUT = constantId('export-source');
const CONVERSION = constantId('export-conversion');
const OUTPUT = constantId('export-output');

function node(
  id: NodeId,
  type: BuiltInNodeType,
  ports: { readonly from?: ChannelLayout; readonly to?: ChannelLayout },
  settings: ProcessingNodeDescriptor['settings'] = {},
): ProcessingNodeDescriptor {
  return {
    kind: 'processing',
    id,
    type,
    inputs: ports.from === undefined ? [] : [{ name: 'in', layout: ports.from }],
    outputs: ports.to === undefined ? [] : [{ name: 'out', layout: ports.to }],
    settings,
  };
}

/** The node that converts `from` as the conversion asks, or none where it keeps the channels. */
function conversionNode(
  from: ChannelLayout,
  conversion: LayoutConversion,
): ProcessingNodeDescriptor | undefined {
  const ports = { from, to: conversion.to };
  switch (conversion.kind) {
    case 'none':
      return undefined;
    case 'map':
      return node(CONVERSION, BuiltInNodeType.ChannelMap, ports, { map: conversion.channels });
    case 'matrix':
      return node(
        CONVERSION,
        BuiltInNodeType.Matrix,
        ports,
        conversion.weights.kind === 'named'
          ? { named: conversion.weights.matrix }
          : { coefficients: conversion.weights.rows.flat() },
      );
  }
}

function graphOf(from: ChannelLayout, conversion: LayoutConversion): GraphDescriptor {
  const converting = conversionNode(from, conversion);
  const source = node(INPUT, BuiltInNodeType.GraphInput, { to: from });
  const sink = node(OUTPUT, BuiltInNodeType.Output, { from: conversion.to });
  const out = (id: NodeId): { node: NodeId; port: string } => ({ node: id, port: 'out' });
  const into = (id: NodeId): { node: NodeId; port: string } => ({ node: id, port: 'in' });
  return converting === undefined
    ? {
        version: GRAPH_DESCRIPTOR_VERSION,
        nodes: [source, sink],
        edges: [{ from: out(INPUT), to: into(OUTPUT) }],
      }
    : {
        version: GRAPH_DESCRIPTOR_VERSION,
        nodes: [source, converting, sink],
        edges: [
          { from: out(INPUT), to: into(CONVERSION) },
          { from: out(CONVERSION), to: into(OUTPUT) },
        ],
      };
}

/** The range of `span` at `rate`, its two ends placed by the rule for a change of rate. */
function rangeAt(span: ExportSpan, rate: SampleRate): DomainResult<RenderRange> {
  const from = span.audio.sampleRate;
  return flatMapResult(convertSampleRate(span.start, from, rate), (start) =>
    flatMapResult(addSamples(span.start, span.length), (sourceEnd) =>
      flatMapResult(convertSampleRate(sourceEnd, from, rate), (end) =>
        mapResult(subtractSamples(end, start), (length) => ({ start, length })),
      ),
    ),
  );
}

/** The render of one span of an export at `sampleRate` with `channels`, or why it cannot be made. */
export function exportRenderPlan(
  span: ExportSpan,
  sampleRate: SampleRate,
  channels: ChannelConversion,
): DomainResult<ExportRenderPlan> {
  const from = span.audio.layout;
  return flatMapResult(layoutConversion(from, channels), (conversion) =>
    mapResult(rangeAt(span, sampleRate), (range) => ({
      graph: graphOf(from, conversion),
      input: INPUT,
      output: OUTPUT,
      sampleRate,
      range,
      layout: conversion.to,
    })),
  );
}
