import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { compileGraph } from '@audiogubbins/audio-graph';

import { ProcessingPurpose } from '../profiles/processing-mode.js';
import { graphOf, named, nodeOf, wire } from '../testing/graph-builders.js';
import { Accelerator } from './accelerator.js';
import { PathReason, selectNodePaths } from './accelerated-paths.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { BUILT_IN_NODES } from './built-in-nodes.js';
import type { NodeImplementation, NodeImplementations } from './node-implementation.js';

const STEREO = StandardLayouts.stereo;
const RATE = expectSuccess(sampleRate(48_000));

/** A gain whose type says it has a GPU path beside its kernel, as a later processor may. */
const GPU_GAIN = 'test.gpu-gain';

function withGpuGain(): NodeImplementations {
  const gain = BUILT_IN_NODES.get(BuiltInNodeType.Gain);
  if (gain === undefined) throw new Error('The built-in gain is missing.');
  const declaring: NodeImplementation = { ...gain, accelerators: [Accelerator.Gpu] };
  return new Map([...BUILT_IN_NODES, [GPU_GAIN, declaring]]);
}

/** Input, a GPU-declaring gain and a built-in gain in a row, to an output. */
function plan(implementations: NodeImplementations) {
  const graph = graphOf(
    [
      nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] }),
      nodeOf('fast', GPU_GAIN, STEREO, { inputs: ['in'], outputs: ['out'] }, { gain: 0.5 }),
      nodeOf('plain', BuiltInNodeType.Gain, STEREO, { inputs: ['in'], outputs: ['out'] }),
      nodeOf('out', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
    ],
    [wire('in.out', 'fast.in'), wire('fast.out', 'plain.in'), wire('plain.out', 'out.in')],
  );
  const compiled = compileGraph(graph, implementations, RATE);
  if (!compiled.ok) throw new Error('The test graph does not compile.');
  return compiled.plan;
}

describe('choosing each node’s path', () => {
  const implementations = withGpuGain();
  const steps = plan(implementations);
  const pathOf = (available: { readonly gpu: boolean }, purpose: ProcessingPurpose, node: string) =>
    selectNodePaths(steps, implementations, available, purpose).find(
      (one) => one.node === named(node),
    );

  it('runs a node’s GPU path where the GPU is offered and the purpose allows it', () => {
    expect(pathOf({ gpu: true }, ProcessingPurpose.Monitor, 'fast')).toEqual({
      node: named('fast'),
      accelerator: Accelerator.Gpu,
      reason: PathReason.Accelerated,
    });
  });

  it('runs the canonical kernel where the GPU is not offered, and says so', () => {
    expect(pathOf({ gpu: false }, ProcessingPurpose.Monitor, 'fast')).toEqual({
      node: named('fast'),
      accelerator: undefined,
      reason: PathReason.Unavailable,
    });
  });

  it('runs the canonical kernel of a node that declares no accelerated path, GPU or not', () => {
    for (const gpu of [true, false]) {
      expect(pathOf({ gpu }, ProcessingPurpose.Monitor, 'plain')).toEqual({
        node: named('plain'),
        accelerator: undefined,
        reason: PathReason.NoneDeclared,
      });
    }
  });

  it('never runs an accelerated path in a final render, which is held to the canonical bits', () => {
    const paths = selectNodePaths(
      steps,
      implementations,
      { gpu: true },
      ProcessingPurpose.FinalRender,
    );

    expect(paths.every((path) => path.accelerator === undefined)).toBe(true);
    expect(paths.find((path) => path.node === named('fast'))?.reason).toBe(
      PathReason.CanonicalOutput,
    );
  });

  it('finds no built-in node type with an accelerated path, so every built-in runs canonically', () => {
    for (const [type, implementation] of BUILT_IN_NODES) {
      expect([type, implementation.accelerators]).toEqual([type, undefined]);
    }
  });
});
