/**
 * The node types the engine is built with, by type.
 *
 * One map serves as both halves of ADR-0030: the catalogue the graph checks a
 * descriptor against, and the implementations the executor makes kernels
 * from, so a node the graph accepts is a node the engine can run. It is made
 * once, and holds only stateless implementations, so every graph and every
 * executor shares it.
 */

import { CHANNEL_MAP_NODE } from './channel-map.js';
import { DELAY_NODE } from './delay.js';
import { GAIN_NODE } from './gain.js';
import { GRAPH_INPUT_NODE } from './graph-input.js';
import { MATRIX_NODE } from './matrix.js';
import { METER_NODE } from './meter.js';
import { MIX_NODE } from './mix.js';
import type { NodeImplementations } from './node-implementation.js';
import { OUTPUT_NODE } from './output.js';
import { TONE_NODE } from './tone.js';

/** Every built-in node type, keyed by its type. */
export const BUILT_IN_NODES: NodeImplementations = new Map(
  [
    GRAPH_INPUT_NODE,
    OUTPUT_NODE,
    GAIN_NODE,
    MIX_NODE,
    CHANNEL_MAP_NODE,
    MATRIX_NODE,
    DELAY_NODE,
    TONE_NODE,
    METER_NODE,
  ].map((implementation) => [implementation.type, implementation]),
);
