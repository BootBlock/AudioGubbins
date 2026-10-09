/**
 * The model the port's tests run: `c = a + b` over float32 vectors of any one
 * length `n`, as ONNX bytes for the real runtime and as arithmetic for the
 * fake.
 *
 * The bytes are written here, field by field, rather than kept as a file: the
 * repository holds no model (REQ-REPO-191), and a graph of one `Add` node is
 * small enough to state. They are an ONNX `ModelProto` (IR version 8, the
 * default operator set at version 17) in protocol buffer encoding: a field is
 * its number and wire type as a varint, then a varint, or a varint length and
 * that many bytes.
 */

import { succeed } from '@audiogubbins/domain';

import type { ModelBytes, ModelSource } from '../inference-port.js';
import type { Tensor, TensorInfo } from '../tensor.js';
import type { FakeModel } from './fake-inference.js';

const encoder = new TextEncoder();

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
}

/** A field whose value is a varint (wire type 0). */
function numberField(field: number, value: number): number[] {
  return [...varint(field * 8), ...varint(value)];
}

/** A field whose value is length-delimited (wire type 2). */
function bytesField(field: number, bytes: readonly number[]): number[] {
  return [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
}

function textField(field: number, text: string): number[] {
  return bytesField(field, [...encoder.encode(text)]);
}

/** ONNX's element type for 32-bit floats. */
const FLOAT = 1;

/** A `ValueInfoProto`: a float32 tensor of one dimension named `n`. */
function vectorInfo(name: string): number[] {
  const dimension = bytesField(1, textField(2, 'n'));
  const shape = bytesField(2, dimension);
  const tensorType = bytesField(1, [...numberField(1, FLOAT), ...shape]);
  return [...textField(1, name), ...bytesField(2, tensorType)];
}

/** The `Add` model's ONNX bytes, in memory of their own. */
export function addModelBytes(): ModelBytes {
  const node = [
    ...textField(1, 'a'),
    ...textField(1, 'b'),
    ...textField(2, 'c'),
    ...textField(3, 'add'),
    ...textField(4, 'Add'),
  ];
  const graph = [
    ...bytesField(1, node),
    ...textField(2, 'add'),
    ...bytesField(11, vectorInfo('a')),
    ...bytesField(11, vectorInfo('b')),
    ...bytesField(12, vectorInfo('c')),
  ];
  const operatorSet = [...textField(1, ''), ...numberField(2, 17)];
  return new Uint8Array([
    ...numberField(1, 8),
    ...bytesField(7, graph),
    ...bytesField(8, operatorSet),
  ]);
}

/** The SHA-256 of {@link addModelBytes}, which the package's tests hold to the bytes. */
export const ADD_MODEL_SHA256 = '66658651a1438f79433a7f0fd023e42592342fb9a103d62ac73bbf644f36a3fb';

/** The `Add` model's file, whose bytes are made afresh at each read. */
export function addModel(): ModelSource {
  return { sha256: ADD_MODEL_SHA256, read: () => Promise.resolve(succeed(addModelBytes())) };
}

const VECTOR: TensorInfo['dims'] = ['n'];

/** The `Add` model's arithmetic, for the fake. */
export const FAKE_ADD: FakeModel = {
  inputs: [
    { name: 'a', dims: VECTOR },
    { name: 'b', dims: VECTOR },
  ],
  outputs: [{ name: 'c', dims: VECTOR }],
  run: (inputs) => {
    const a = inputs.get('a');
    const b = inputs.get('b');
    if (a === undefined || b === undefined) throw new Error('The fake was run without its inputs.');
    const sum: Tensor = {
      data: a.data.map((one, index) => one + (b.data[index] ?? Number.NaN)),
      dims: a.dims,
    };
    return new Map([['c', sum]]);
  },
};
