/**
 * The mixing matrices a matrix node may name rather than spell out.
 *
 * Each is written as the channels it sums, by what they carry, never by where
 * they sit: a coefficient is placed by finding its channel's role or label in
 * the node's own port layouts (ADR-0033). A named matrix is refused unless both
 * ports carry exactly the layouts it was written for, because applying one to
 * channels that mean something else would be a silent wrong mix, not a
 * conversion (REQ-ARCH-157).
 */

import {
  channelIndexOf,
  ChannelRole,
  layoutsMatch,
  StandardLayouts,
  type ChannelLayout,
} from '@audiogubbins/domain';

import type { NodeProblem, NodeShape, PortShape } from './node-shape.js';

/** The matrices a matrix node may name. */
export const NamedMatrix = {
  /** ITU-R BS.775 downmix of 5.1 to stereo. */
  Bs775FiveOneToStereo: 'itu-bs775-5.1-to-stereo',

  /** Stereo to mid and side, halved so that decoding restores the level of the stereo. */
  MidSideEncode: 'mid-side-encode',

  /** Mid and side back to stereo. */
  MidSideDecode: 'mid-side-decode',
} as const;

/** A matrix a matrix node may name. */
export type NamedMatrix = (typeof NamedMatrix)[keyof typeof NamedMatrix];

/**
 * The layout of mid and side, as `labelledLayout(['mid', 'side'])` builds it:
 * two discrete channels, told apart by their labels.
 */
export const MID_SIDE: ChannelLayout = {
  roles: [ChannelRole.Discrete, ChannelRole.Discrete],
  labels: ['mid', 'side'],
};

/** A channel by what it carries: a positional role, or a custom map's label. */
type ChannelKey = { readonly role: ChannelRole } | { readonly label: string };

/** One input channel summed into an output channel, and its weight. */
interface MatrixTerm {
  readonly from: ChannelKey;
  readonly weight: number;
}

/** One output channel, and the input channels it sums, in the input layout's order. */
interface MatrixRow {
  readonly to: ChannelKey;
  readonly terms: readonly MatrixTerm[];
}

interface MatrixDefinition {
  readonly input: ChannelLayout;
  readonly output: ChannelLayout;

  /** The two layouts in words, for a message that refuses others. */
  readonly converts: string;
  readonly rows: readonly MatrixRow[];
}

const LEFT = { role: ChannelRole.Left } as const;
const RIGHT = { role: ChannelRole.Right } as const;
const MID = { label: 'mid' } as const;
const SIDE = { label: 'side' } as const;

const DEFINITIONS: Readonly<Record<NamedMatrix, MatrixDefinition>> = {
  [NamedMatrix.Bs775FiveOneToStereo]: {
    input: StandardLayouts.surround5_1,
    output: StandardLayouts.stereo,
    converts:
      'from 5.1 (left, right, centre, low-frequency, surround-left, surround-right) to stereo (left, right)',
    // ITU-R BS.775 leaves the low-frequency channel out of its downmix: it
    // carries effects meant for a subwoofer, which a stereo pair would play as
    // uncontrolled bass, so the matrix has no term for it.
    rows: [
      {
        to: LEFT,
        terms: [
          { from: LEFT, weight: 1 },
          { from: { role: ChannelRole.Centre }, weight: Math.SQRT1_2 },
          { from: { role: ChannelRole.SurroundLeft }, weight: Math.SQRT1_2 },
        ],
      },
      {
        to: RIGHT,
        terms: [
          { from: RIGHT, weight: 1 },
          { from: { role: ChannelRole.Centre }, weight: Math.SQRT1_2 },
          { from: { role: ChannelRole.SurroundRight }, weight: Math.SQRT1_2 },
        ],
      },
    ],
  },
  [NamedMatrix.MidSideEncode]: {
    input: StandardLayouts.stereo,
    output: MID_SIDE,
    converts: 'from stereo (left, right) to mid and side (labelled "mid", "side")',
    rows: [
      {
        to: MID,
        terms: [
          { from: LEFT, weight: 0.5 },
          { from: RIGHT, weight: 0.5 },
        ],
      },
      {
        to: SIDE,
        terms: [
          { from: LEFT, weight: 0.5 },
          { from: RIGHT, weight: -0.5 },
        ],
      },
    ],
  },
  [NamedMatrix.MidSideDecode]: {
    input: MID_SIDE,
    output: StandardLayouts.stereo,
    converts: 'from mid and side (labelled "mid", "side") to stereo (left, right)',
    rows: [
      {
        to: LEFT,
        terms: [
          { from: MID, weight: 1 },
          { from: SIDE, weight: 1 },
        ],
      },
      {
        to: RIGHT,
        terms: [
          { from: MID, weight: 1 },
          { from: SIDE, weight: -1 },
        ],
      },
    ],
  },
};

const NAMES: readonly string[] = Object.values(NamedMatrix);

function isNamedMatrix(name: string): name is NamedMatrix {
  return NAMES.includes(name);
}

/** Where a channel sits in a layout, found by its role or its label. */
function indexIn(layout: ChannelLayout, key: ChannelKey): number | undefined {
  if ('role' in key) return channelIndexOf(layout, key.role);
  const index = layout.labels?.indexOf(key.label) ?? -1;
  return index === -1 ? undefined : index;
}

/**
 * The coefficients of a named matrix between two ports, row-major by output
 * channel, or `undefined` with the problem noted when the name is unknown or
 * the ports are not the layouts it converts.
 */
export function namedCoefficients(
  shape: NodeShape,
  name: string,
  input: PortShape,
  output: PortShape,
  problems: NodeProblem[],
): readonly number[] | undefined {
  if (!isNamedMatrix(name)) {
    problems.push({
      code: 'node-settings-invalid',
      message: `Node ${shape.id} names the matrix "${name}", which is not one AudioGubbins defines. Name one of ${NAMES.map((one) => `"${one}"`).join(', ')}, or give its "coefficients" instead.`,
      node: shape.id,
    });
    return undefined;
  }
  const definition = DEFINITIONS[name];
  if (
    !layoutsMatch(input.layout, definition.input) ||
    !layoutsMatch(output.layout, definition.output)
  ) {
    problems.push({
      code: 'layout-unsupported',
      message: `Node ${shape.id} uses the matrix "${name}", which converts ${definition.converts}, but its ports "${input.name}" and "${output.name}" do not carry those layouts. Give the ports those layouts, or give the node its own "coefficients".`,
      node: shape.id,
    });
    return undefined;
  }
  const columns = definition.input.roles.length;
  const coefficients = new Array<number>(definition.output.roles.length * columns).fill(0);
  for (const row of definition.rows) {
    const to = indexIn(output.layout, row.to);
    for (const term of row.terms) {
      const from = indexIn(input.layout, term.from);
      if (to === undefined || from === undefined) {
        throw new Error(`The matrix "${name}" names a channel its own layouts do not have.`);
      }
      coefficients[to * columns + from] = term.weight;
    }
  }
  return coefficients;
}
