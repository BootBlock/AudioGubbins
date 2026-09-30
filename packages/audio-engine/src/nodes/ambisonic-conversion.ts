/**
 * The change of an ambisonic set's convention, as a named matrix.
 *
 * REQ-ARCH-157 asks for ambisonic ordering and normalisation utilities. Two
 * sets of one order carry the same spherical-harmonic components, so moving
 * between conventions reorders the channels (ACN or Furse-Malham) and rescales
 * each component (SN3D, N3D or Furse-Malham). Which component each channel
 * carries is the domain's to answer, from the layout's convention (ADR-0033),
 * so the weights are placed by component and never by position. Each weight is
 * one quotient of two square roots, basic IEEE-754 arithmetic (ADR-0032), so a
 * conversion is the same bits on every machine.
 *
 * The Furse-Malham convention is defined to the third order only, and a set
 * the domain would not build, that one of a higher order among them, is
 * refused with the domain's own reason rather than converted by a guess.
 */

import {
  AmbisonicNormalisation,
  ambisonicComponentOf,
  ambisonicLayout,
  layoutsMatch,
  type AmbisonicComponent,
  type ChannelLayout,
} from '@audiogubbins/domain';

import type { MatrixDefinition } from './matrix-definition.js';
import type { NodeProblem, NodeShape, PortShape } from './node-shape.js';

/**
 * Each component's Furse-Malham weight against SN3D, by ACN, to the third
 * order: W is 3 dB down, the first order is unchanged, and the higher ones are
 * scaled so that each reaches a peak of one (the "maxN" weights).
 */
const FUMA_AGAINST_SN3D: readonly number[] = [
  // W
  Math.sqrt(1 / 2),
  // Y Z X
  1,
  1,
  1,
  // V T R S U
  Math.sqrt(4 / 3),
  Math.sqrt(4 / 3),
  1,
  Math.sqrt(4 / 3),
  Math.sqrt(4 / 3),
  // Q O M K L N P
  Math.sqrt(8 / 5),
  Math.sqrt(9 / 5),
  Math.sqrt(45 / 32),
  1,
  Math.sqrt(45 / 32),
  Math.sqrt(9 / 5),
  Math.sqrt(8 / 5),
];

/** A component's weight in a normalisation, against its SN3D weight. */
function weightAgainstSn3d(
  normalisation: AmbisonicNormalisation,
  component: AmbisonicComponent,
): number {
  switch (normalisation) {
    case AmbisonicNormalisation.Sn3d:
      return 1;
    case AmbisonicNormalisation.N3d:
      return Math.sqrt(2 * component.degree + 1);
    case AmbisonicNormalisation.FuMa: {
      const weight = FUMA_AGAINST_SN3D[component.acn];
      if (weight === undefined) {
        throw new Error('A Furse-Malham set above the third order passed its layout check.');
      }
      return weight;
    }
  }
}

/**
 * Why a port's layout is not an ambisonic set this conversion can read, or
 * `undefined` when it is one: a full-sphere set the domain itself builds from
 * the layout's convention.
 */
function problemWithSet(layout: ChannelLayout): string | undefined {
  const convention = layout.ambisonic;
  if (convention === undefined) return 'it is not an ambisonic set';
  const built = ambisonicLayout(convention);
  if (!built.ok) {
    return `its convention describes no set: ${built.failures.map((one) => one.summary).join(' ')}`;
  }
  return layoutsMatch(built.value, layout)
    ? undefined
    : `it does not have the ${String(built.value.roles.length)} ambisonic channels its order holds`;
}

function refuse(shape: NodeShape, name: string, why: string, problems: NodeProblem[]): void {
  problems.push({
    code: 'layout-unsupported',
    message: `Node ${shape.id} uses the matrix "${name}", which converts an ambisonic set to another ordering or normalisation of the same order, but ${why}.`,
    node: shape.id,
  });
}

/** Converts an ambisonic set to the convention of the node's output port. */
export const AMBISONIC_CONVERSION: MatrixDefinition = {
  coefficientsBetween: (
    shape: NodeShape,
    name: string,
    input: PortShape,
    output: PortShape,
    problems: NodeProblem[],
  ) => {
    for (const port of [input, output]) {
      const problem = problemWithSet(port.layout);
      if (problem !== undefined) {
        refuse(shape, name, `on port "${port.name}" ${problem}`, problems);
        return undefined;
      }
    }
    const from = input.layout.ambisonic;
    const to = output.layout.ambisonic;
    if (from === undefined || to === undefined) {
      throw new Error('An ambisonic set passed its check without a convention.');
    }
    if (from.order !== to.order) {
      refuse(
        shape,
        name,
        `its ports carry orders ${String(from.order)} and ${String(to.order)}; changing the order is a decode or an encode, not a conversion`,
        problems,
      );
      return undefined;
    }

    const columns = input.layout.roles.length;
    const columnOf = new Map<number, number>();
    for (let column = 0; column < columns; column += 1) {
      const component = ambisonicComponentOf(input.layout, column);
      if (component !== undefined) columnOf.set(component.acn, column);
    }
    const coefficients = new Array<number>(output.layout.roles.length * columns).fill(0);
    for (let row = 0; row < output.layout.roles.length; row += 1) {
      const component = ambisonicComponentOf(output.layout, row);
      const column = component === undefined ? undefined : columnOf.get(component.acn);
      if (component === undefined || column === undefined) {
        throw new Error('Two ambisonic sets of one order do not carry the same components.');
      }
      coefficients[row * columns + column] =
        weightAgainstSn3d(to.normalisation, component) /
        weightAgainstSn3d(from.normalisation, component);
    }
    return coefficients;
  },
};
