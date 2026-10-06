/**
 * A tensor as the inference port carries it: 32-bit floats and their
 * dimensions, row-major.
 *
 * Every first model pack takes and gives float32 alone (ADR-0062: DeepFilterNet
 * 3, MossFormer2 SE 48K and Spleeter), so no other element type is admitted
 * until a pack needs one. The data is held in memory of its own, never shared,
 * so it can be transferred to the worker that runs the model rather than
 * copied.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

/** A float32 tensor: its values, row-major, and the length of each dimension. */
export interface Tensor {
  readonly data: Float32Array<ArrayBuffer>;
  readonly dims: readonly number[];
}

/**
 * One dimension of a model's input or output, as the model declares it: a
 * fixed length, or the name of a dimension the caller chooses, such as the
 * frames of a chunk. An unnamed free dimension is the empty name.
 */
export type TensorDimension = number | string;

/** A model's input or output: its name and its declared dimensions. */
export interface TensorInfo {
  readonly name: string;
  readonly dims: readonly TensorDimension[];
}

/** The failure of a tensor whose dimensions do not describe its data. */
function shapeRefused(summary: string): DomainFailure {
  return failure('inference.tensor-shape', FailureKind.Rejected, summary);
}

/** Whether every dimension is a whole number, zero or more. */
function wholeDimensions(dims: readonly number[]): boolean {
  return dims.every((one) => Number.isSafeInteger(one) && one >= 0);
}

/** The values a tensor of these dimensions holds. */
function elementCount(dims: readonly number[]): number {
  return dims.reduce((product, one) => product * one, 1);
}

/**
 * A tensor of `data` in `dims`, or why it cannot be one: each dimension a whole
 * number, and as many values as the dimensions multiply to.
 */
export function tensor(
  data: Float32Array<ArrayBuffer>,
  dims: readonly number[],
): DomainResult<Tensor> {
  if (!wholeDimensions(dims)) {
    return fail(
      shapeRefused(`A tensor's dimensions must be whole numbers, not ${dims.join(', ')}.`),
    );
  }
  const count = elementCount(dims);
  if (count !== data.length) {
    return fail(
      shapeRefused(
        `A tensor of dimensions ${dims.join(' by ')} holds ${String(count)} values, not ${String(data.length)}.`,
      ),
    );
  }
  return succeed({ data, dims: [...dims] });
}
