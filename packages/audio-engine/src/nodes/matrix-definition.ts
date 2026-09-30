/**
 * What a matrix a matrix node may name must do: place its weights between the
 * node's two ports.
 *
 * A named matrix is written by what channels carry, never by where they sit,
 * so only it can say whether a pair of layouts is one it converts and where
 * each weight falls in them (ADR-0033). Some are written for one pair of
 * layouts, and some, such as a change of ambisonic convention, for a family of
 * them; each is its own implementation of this contract.
 */

import type { NodeProblem, NodeShape, PortShape } from './node-shape.js';

/** One matrix a matrix node may name. */
export interface MatrixDefinition {
  /**
   * The weights between two ports, row-major with a row for each output
   * channel and a column for each input channel, or `undefined` with the
   * problem noted when the ports do not carry layouts this matrix converts.
   * A layout it is not written for is refused, because applying it to
   * channels that mean something else would be a silent wrong mix, not a
   * conversion (REQ-ARCH-157).
   */
  coefficientsBetween(
    shape: NodeShape,
    name: string,
    input: PortShape,
    output: PortShape,
    problems: NodeProblem[],
  ): readonly number[] | undefined;
}
