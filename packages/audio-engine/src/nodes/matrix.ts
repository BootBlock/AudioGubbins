/**
 * Matrix: each output channel a weighted sum of every input channel.
 *
 * The general conversion between layouts, a downmix, an upmix or an encoding
 * such as mid and side, which a channel map's plain copies cannot express. Its
 * weights are given either as `coefficients`, row-major with a row for each
 * output channel and a column for each input channel, or by naming one of the
 * matrices `named-matrices.ts` defines, which places its weights by what each
 * channel carries. Each output sample is summed in f64 from zero, input channel
 * by input channel in layout order, and stored once as f32 (ADR-0032).
 *
 * The kernel runs that order a whole input channel at a time: an output
 * channel's sums are a block of f64 it adds each input channel into, in turn,
 * so each input channel is read once, in order, per output channel. Every
 * sample still receives its terms in layout order, so the bits are those of
 * summing one sample at a time.
 */

import { channelCount, succeed, type DomainResult } from '@audiogubbins/domain';
import { NodeRole } from '@audiogubbins/audio-graph';

import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { channelAt, portAt } from './kernel-ports.js';
import { namedCoefficients } from './named-matrices.js';
import { unknownParameter } from './node-parameters.js';
import type { NodeImplementation, NodeKernel } from './node-implementation.js';
import {
  accepted,
  kernelRefusal,
  onlyPort,
  plannedShape,
  problemsOf,
  refused,
  type NodeProblem,
  type NodeReading,
  type NodeShape,
} from './node-shape.js';
import { finiteNumbers, optionalSetting, refuseOtherSettings, TEXT } from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

const COEFFICIENTS = 'coefficients';

/** The setting that names a defined matrix instead of giving weights. */
const NAMED = 'named';

const TAKES: ReadonlySet<string> = new Set([COEFFICIENTS, NAMED]);

/** A matrix's weights, row-major by output channel, and how many input channels each row spans. */
interface MatrixWeights {
  readonly coefficients: readonly number[];
  readonly columns: number;
}

/** The weights of a matrix node, or every problem with the node. */
function readMatrix(shape: NodeShape): NodeReading<MatrixWeights> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const input = onlyPort(shape, 'inputs', problems);
  const output = onlyPort(shape, 'outputs', problems);
  if (input === undefined || output === undefined) return refused(problems);
  const rows = channelCount(output.layout);
  const columns = channelCount(input.layout);
  const rule = finiteNumbers(
    rows * columns,
    'pair of output and input channel, a row for each output channel',
  );
  const given = optionalSetting(shape, COEFFICIENTS, rule, problems);
  const name = optionalSetting(shape, NAMED, TEXT, problems);
  const hasCoefficients = COEFFICIENTS in shape.settings;
  const hasName = NAMED in shape.settings;
  if (hasCoefficients === hasName) {
    problems.push({
      code: 'node-settings-invalid',
      message: hasName
        ? `Node ${shape.id} is a matrix node with both "${COEFFICIENTS}" and "${NAMED}", which give its weights twice. Remove one of them.`
        : `Node ${shape.id} is a matrix node without weights. Give its "${COEFFICIENTS}", or name a matrix in "${NAMED}".`,
      node: shape.id,
    });
  }
  const coefficients =
    name === undefined ? given : namedCoefficients(shape, name, input, output, problems);
  return coefficients === undefined || problems.length > 0
    ? refused(problems)
    : accepted({ coefficients, columns });
}

class MatrixKernel implements NodeKernel {
  /** The weights, row-major: output channel `row` takes input channel `column` at `row * columns + column`. */
  readonly #coefficients: Float64Array;
  readonly #columns: number;

  /** The f64 sums of the output channel being written, one per frame of a block. */
  readonly #sums: Float64Array;

  constructor({ coefficients, columns }: MatrixWeights, blockFrames: number) {
    this.#coefficients = Float64Array.from(coefficients);
    this.#columns = columns;
    this.#sums = new Float64Array(blockFrames);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    const coefficients = this.#coefficients;
    const columns = this.#columns;
    const sums = this.#sums;
    for (let row = 0; row < output.channels.length; row += 1) {
      sums.fill(0, 0, frames);
      for (let column = 0; column < columns; column += 1) {
        const from = channelAt(input, column);
        const weight = coefficients[row * columns + column] ?? 0;
        for (let frame = 0; frame < frames; frame += 1) {
          sums[frame] = (sums[frame] ?? 0) + (from[frame] ?? 0) * weight;
        }
      }
      const to = channelAt(output, row);
      for (let frame = 0; frame < frames; frame += 1) to[frame] = sums[frame] ?? 0;
    }
  }

  setParameter(name: string): DomainResult<void> {
    return unknownParameter(BuiltInNodeType.Matrix, name);
  }

  release(): void {
    // Holds only its own arrays, which are collected with it.
  }
}

/** Each output channel a weighted sum of the input channels, by `coefficients` or a `named` matrix. */
export const MATRIX_NODE: NodeImplementation = {
  type: BuiltInNodeType.Matrix,
  role: NodeRole.Processor,
  check: (node) => problemsOf(readMatrix(node)),
  latency: () => ZERO_LATENCY,
  createKernel: (step, context) => {
    const shape = plannedShape(step);
    const reading = readMatrix(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    return succeed(new MatrixKernel(reading.value, context.blockFrames));
  },
};
