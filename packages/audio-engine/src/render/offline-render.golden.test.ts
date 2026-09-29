/**
 * Golden renders: a job renders the same bits on either DSP path and in any
 * chunks, and those bits are pinned (ADR-0032, REQ-ARCH-049).
 *
 * The graph uses every canonical primitive a render can reach: the oscillator
 * of a tone node, a source converted from another rate at maximum quality, a
 * weighted mix, the ITU-R BS.775 downmix and a gain. The pinned hash may only
 * change with a change of canonical arithmetic, which `REQ-EXEC-180` requires
 * to be justified and reviewed.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { StandardLayouts, sampleCount, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { wasmDsp } from '../dsp/wasm/wasm-dsp.js';
import { BUILT_IN_NODES } from '../nodes/built-in-nodes.js';
import { BuiltInNodeType } from '../nodes/built-in-node-type.js';
import { toneSource } from '../pcm/tone-source.js';
import { dspModuleExports } from '../testing/dsp-module.js';
import { fingerprint } from '../testing/pcm-fingerprint.js';
import { collectingSink, graphOf, jobOf, named, nodeOf, wire } from '../testing/render-harness.js';
import { renderOffline } from './offline-renderer.js';

const SURROUND = StandardLayouts.surround5_1;
const STEREO = StandardLayouts.stereo;
const FRAMES = 9_600;

/**
 * The pinned fingerprint of the golden render, left channel then right.
 *
 * Was 0x797fca5300be6765 before each resampling quality's filter was designed
 * from its passband edge and stopband floor (REQ-EXEC-180): the old cutoff put
 * the transition band across the lower Nyquist frequency, so the promised
 * stopband did not hold. The WebAssembly module and the reference path, each
 * in several chunk sizes, agreed on every bit of the new value.
 */
const GOLDEN = 0x6b1d7f884c8844a1n;

const GRAPH = graphOf(
  [
    nodeOf(
      'tone',
      BuiltInNodeType.Tone,
      SURROUND,
      { outputs: ['out'] },
      {
        frequency: 997,
        amplitude: 0.5,
      },
    ),
    nodeOf('recording', BuiltInNodeType.GraphInput, SURROUND, { outputs: ['out'] }),
    nodeOf(
      'sum',
      BuiltInNodeType.Mix,
      SURROUND,
      { inputs: ['a', 'b'], outputs: ['out'] },
      {
        gains: [0.5, 1],
      },
    ),
    {
      kind: 'processing',
      id: named('down'),
      type: BuiltInNodeType.Matrix,
      inputs: [{ name: 'in', layout: SURROUND }],
      outputs: [{ name: 'out', layout: STEREO }],
      settings: { named: 'itu-bs775-5.1-to-stereo' },
    },
    nodeOf(
      'level',
      BuiltInNodeType.Gain,
      STEREO,
      { inputs: ['in'], outputs: ['out'] },
      {
        gain: 0.9,
      },
    ),
    nodeOf('out', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
  ],
  [
    wire('tone.out', 'sum.a'),
    wire('recording.out', 'sum.b'),
    wire('sum.out', 'down.in'),
    wire('down.out', 'level.in'),
    wire('level.out', 'out.in'),
  ],
);

/**
 * Renders the golden graph with `dsp` in chunks of `chunkFrames`, each
 * conversion given `coefficientBudgetBytes` for its table, and its fingerprint.
 */
async function goldenRender(
  dsp: CanonicalDsp,
  chunkFrames: number,
  coefficientBudgetBytes?: number,
): Promise<bigint> {
  const recording = expectSuccess(
    toneSource(dsp, {
      layout: SURROUND,
      sampleRate: expectSuccess(sampleRate(44_100)),
      frequency: 440,
      amplitude: 0.25,
      length: expectSuccess(sampleCount(8_820)),
    }),
  );
  const out = collectingSink();
  const summary = expectSuccess(
    await renderOffline(
      {
        ...jobOf(GRAPH, {
          sources: { recording },
          sinks: { out },
          length: FRAMES,
          chunkFrames,
        }),
        ...(coefficientBudgetBytes === undefined ? {} : { coefficientBudgetBytes }),
      },
      dsp,
      BUILT_IN_NODES,
    ),
  );
  recording.release();
  expect(summary.conversions).toHaveLength(1);
  const [left = new Float32Array(), right = new Float32Array()] = out.channels();
  expect(left.length + right.length).toBe(2 * FRAMES);
  // Agreement is only worth something if there is audio to agree on.
  expect(Math.max(...left.map(Math.abs))).toBeGreaterThan(0.25);
  expect(Math.max(...right.map(Math.abs))).toBeGreaterThan(0.25);
  const both = new Float32Array(2 * FRAMES);
  both.set(left);
  both.set(right, FRAMES);
  return fingerprint(both);
}

describe('golden offline renders', () => {
  let wasm: CanonicalDsp = REFERENCE_DSP;

  beforeAll(async () => {
    wasm = expectSuccess(wasmDsp(await dspModuleExports()));
  });

  it('renders the same bits on the WebAssembly module and the reference path, in any chunks', async () => {
    const hash = await goldenRender(wasm, 4_800);
    expect(await goldenRender(wasm, 1_000)).toBe(hash);
    expect(await goldenRender(wasm, 333)).toBe(hash);
    expect(await goldenRender(REFERENCE_DSP, 4_800)).toBe(hash);
    expect(await goldenRender(REFERENCE_DSP, 777)).toBe(hash);
    // With no memory for a table, each conversion computes its taps: slower,
    // and the same bits.
    expect(await goldenRender(wasm, 4_800, 0)).toBe(hash);
    expect(await goldenRender(REFERENCE_DSP, 4_800, 0)).toBe(hash);
    expect(`0x${hash.toString(16).padStart(16, '0')}`).toBe(
      `0x${GOLDEN.toString(16).padStart(16, '0')}`,
    );
  });
});
