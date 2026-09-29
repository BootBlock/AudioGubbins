import { beforeAll, describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { SettingValue } from '@audiogubbins/audio-graph';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { wasmDsp } from '../dsp/wasm/wasm-dsp.js';
import { dspModuleExports } from '../testing/dsp-module.js';
import {
  GENERIC_LAYOUTS,
  RATE,
  kernelContext,
  kernelOf,
  nodeOf,
  port,
  runInCalls,
  stepOf,
} from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { TONE_NODE } from './tone.js';

function tone(
  settings: Readonly<Record<string, SettingValue>>,
  layout: ChannelLayout = StandardLayouts.stereo,
) {
  return nodeOf(BuiltInNodeType.Tone, { outputs: [port('out', layout)], settings });
}

function codes(node: ReturnType<typeof tone>) {
  return TONE_NODE.check(node).map((one) => one.code);
}

/** The canonical oscillator's own output, rendered in one call. */
function canonical(dsp: CanonicalDsp, frequency: number, amplitude: number, frames: number) {
  const oscillator = expectSuccess(
    dsp.createOscillator({ frequency, sampleRate: RATE, startPhase: 0, amplitude }),
  );
  const samples = new Float32Array(frames);
  oscillator.render(samples);
  oscillator.release();
  return samples;
}

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe('the tone node', () => {
  it('accepts a positive frequency, with or without an amplitude, of no latency', () => {
    expect(TONE_NODE.check(tone({ frequency: 440 }))).toEqual([]);
    expect(TONE_NODE.check(tone({ frequency: 997, amplitude: 1 }))).toEqual([]);
    expect(TONE_NODE.latency(tone({ frequency: 440 }), RATE)).toEqual({
      kind: 'known',
      frames: ZERO_SAMPLES,
    });
  });

  it('reports each malformed shape with its own code', () => {
    expect(codes(tone({}))).toEqual(['node-settings-invalid']);
    expect(codes(tone({ frequency: 0 }))).toEqual(['node-settings-invalid']);
    expect(codes(tone({ frequency: 'a4' }))).toEqual(['node-settings-invalid']);
    expect(codes(tone({ frequency: 440, amplitude: 1.5 }))).toEqual(['node-settings-invalid']);
    expect(codes(tone({ frequency: 440, amplitude: -0.1 }))).toEqual(['node-settings-invalid']);
    expect(codes(tone({ frequency: 440, phase: 0 }))).toEqual(['node-settings-invalid']);
    expect(
      codes(
        nodeOf(BuiltInNodeType.Tone, {
          outputs: [port('out', StandardLayouts.mono), port('also', StandardLayouts.mono)],
          settings: { frequency: 440 },
        }),
      ),
    ).toEqual(['role-ports-invalid']);
  });

  it('is refused at a rate whose half is below its frequency, which only the kernel knows', () => {
    expect(
      expectFailureCode(
        TONE_NODE.createKernel(stepOf(tone({ frequency: 30_000 })), kernelContext()),
      ),
    ).toBe('dsp.oscillator-frequency-out-of-range');
  });

  for (const [dspName, dsp] of [
    ['the WebAssembly module', () => wasm],
    ['the reference path', () => REFERENCE_DSP],
  ] as const) {
    for (const [name, layout] of GENERIC_LAYOUTS) {
      it(`is the canonical oscillator's output on every ${name} channel, on ${dspName}`, () => {
        const frames = 1000;
        const kernel = kernelOf(
          TONE_NODE,
          tone({ frequency: 997 }, layout),
          kernelContext({ dsp: dsp() }),
        );
        const [out] = runInCalls(kernel, [], [layout], frames, [128, 1, 77]);
        const expected = canonical(dsp(), 997, 0.5, frames);
        expect(out).toEqual(layout.roles.map(() => expected));
        kernel.release();
      });
    }
  }

  it('releases its oscillator with the kernel', () => {
    let released = 0;
    const counting: CanonicalDsp = {
      ...REFERENCE_DSP,
      createOscillator: (settings) => {
        const made = REFERENCE_DSP.createOscillator(settings);
        return made.ok
          ? {
              ok: true,
              value: {
                render: (into) => {
                  made.value.render(into);
                },
                release: () => {
                  released += 1;
                },
              },
            }
          : made;
      },
    };
    const kernel = kernelOf(TONE_NODE, tone({ frequency: 440 }), kernelContext({ dsp: counting }));
    kernel.release();
    expect(released).toBe(1);
    expect(expectFailureCode(kernel.setParameter('frequency', 880))).toBe('node.parameter-unknown');
  });
});
