/**
 * The check of a DSP module's exports (ADR-0031): a module of another ABI
 * version, or without a function the engine calls, or that is not exports at
 * all, is refused with a reason that names what is wrong, and a module that
 * refuses to make an object is reported as refusing. Each is held with a
 * hand-built exports object, so no module has to be built wrong to test it.
 */

import { describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { ResamplingQuality } from '../canonical-dsp.js';
import { readDspExports } from './dsp-exports.js';
import { wasmDsp } from './wasm-dsp.js';

/**
 * The ABI version the engine speaks, written here rather than read from the
 * binding, so a change of version is a change this test is made to agree to.
 */
const DSP_ABI_VERSION = 2;

/** Every function the engine calls, each answering 0 unless a test says otherwise. */
const FUNCTIONS = [
  'ag_abi_version',
  'ag_buffer_create',
  'ag_buffer_address',
  'ag_buffer_release',
  'ag_sine_of_turns',
  'ag_oscillator_create',
  'ag_oscillator_render',
  'ag_oscillator_release',
  'ag_resampler_create',
  'ag_resampler_lookahead',
  'ag_resampler_push',
  'ag_resampler_finish',
  'ag_resampler_pull',
  'ag_resampler_drained',
  'ag_resampler_seek',
  'ag_resampler_release',
] as const;

/** Exports that speak this engine's ABI, with `changes` laid over them. */
function exportsWith(changes: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const functions = Object.fromEntries(FUNCTIONS.map((name) => [name, () => 0]));
  return {
    memory: { buffer: new ArrayBuffer(64) },
    ...functions,
    ag_abi_version: () => DSP_ABI_VERSION,
    ...changes,
  };
}

function withoutExport(name: string): Record<string, unknown> {
  const exports = exportsWith();
  Reflect.deleteProperty(exports, name);
  return exports;
}

describe('readDspExports', () => {
  it('accepts exports that have every function and speak this ABI', () => {
    expect(readDspExports(exportsWith()).ok).toBe(true);
  });

  it('refuses another ABI version, naming both', () => {
    const read = readDspExports(exportsWith({ ag_abi_version: () => DSP_ABI_VERSION + 1 }));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    const [refusal] = read.failures;
    expect(refusal.code).toBe('dsp.module-abi-mismatch');
    expect(refusal.details).toEqual({ module: DSP_ABI_VERSION + 1, engine: DSP_ABI_VERSION });
    expect(refusal.summary).toBe(
      `The DSP module speaks version ${String(DSP_ABI_VERSION + 1)} of its ABI, and this engine speaks version ${String(DSP_ABI_VERSION)}.`,
    );
  });

  it.each(FUNCTIONS)('refuses exports without %s, naming it', (name) => {
    const read = readDspExports(withoutExport(name));

    expect(read.ok).toBe(false);
    if (read.ok) return;
    const [refusal] = read.failures;
    expect(refusal.code).toBe('dsp.module-exports-missing');
    expect(refusal.details).toEqual({ missing: name });
    expect(refusal.summary).toBe(`The DSP module lacks exports this engine calls: ${name}.`);
  });

  it('refuses exports without a memory, or with one of no buffer, naming it', () => {
    for (const exports of [withoutExport('memory'), exportsWith({ memory: {} })]) {
      const read = readDspExports(exports);
      expect(read.ok).toBe(false);
      if (!read.ok) {
        expect(read.failures[0].summary).toBe(
          'The DSP module lacks exports this engine calls: memory.',
        );
      }
    }
  });

  it('names every export that is missing, not only the first', () => {
    const exports = withoutExport('ag_resampler_seek');
    Reflect.deleteProperty(exports, 'ag_buffer_create');

    const read = readDspExports(exports);

    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.failures[0].details).toEqual({
        missing: 'ag_buffer_create, ag_resampler_seek',
      });
    }
  });

  it.each([undefined, null, 42, 'exports'])('refuses %s, which is not exports', (value) => {
    expect(expectFailureCode(readDspExports(value))).toBe('dsp.module-not-exports');
  });
});

describe('wasmDsp over a module that refuses to make an object', () => {
  // Every creation answers handle 0, as the module does when it cannot.
  const dsp = expectSuccess(wasmDsp(exportsWith()));

  it('reports the refusal of an oscillator', () => {
    const made = dsp.createOscillator({
      frequency: 440,
      sampleRate: expectSuccess(sampleRate(48_000)),
      startPhase: 0,
      amplitude: 1,
    });

    expect(expectFailureCode(made)).toBe('dsp.module-refused');
  });

  it('reports the refusal of a resampler', () => {
    const made = dsp.createResampler({
      from: expectSuccess(sampleRate(44_100)),
      to: expectSuccess(sampleRate(48_000)),
      channels: 2,
      quality: ResamplingQuality.Maximum,
    });

    expect(expectFailureCode(made)).toBe('dsp.module-refused');
  });
});
