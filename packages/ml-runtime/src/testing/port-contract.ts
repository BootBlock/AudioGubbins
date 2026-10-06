/**
 * The inference port's contract, as tests every implementation is held to:
 * the fake, the worker's client over a worker serving the fake, the adapter
 * over the real runtime, and the client over a worker serving that adapter.
 * Each runs the `Add` model (`add-model.ts`), so one set of expectations
 * holds all four to the same answers.
 */

import { describe, expect, it } from 'vitest';

import { createCancellationSource, type DomainResult } from '@audiogubbins/domain';

import {
  GraphOptimisation,
  InferenceMode,
  PreviewAcceleratorKind,
  type InferenceCapabilities,
  type InferenceOptions,
} from '../inference-options.js';
import type { InferencePort, InferenceSession, ModelBytes } from '../inference-port.js';
import type { Tensor } from '../tensor.js';
import { EVERY_CAPABILITY } from './fake-inference.js';

/** An implementation under test: a port on a device that offers `capabilities`, and the model's bytes. */
export interface ContractSubject {
  readonly port: (capabilities: InferenceCapabilities) => InferencePort;
  readonly model: () => ModelBytes;
  /** The longest a test may take, where the implementation starts a real runtime. */
  readonly timeout?: number;
}

export const PINNED: InferenceOptions = {
  kind: InferenceMode.Pinned,
  graphOptimisation: GraphOptimisation.Extended,
};

/** A failure's codes, or the value where there is none. */
function codesOf<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((one) => one.code);
}

/** The value of a result that must have succeeded. */
export function valueOf<TValue>(result: DomainResult<TValue>): TValue {
  if (!result.ok) throw new Error(result.failures.map((one) => one.summary).join(' '));
  return result.value;
}

/** A vector tensor of `values`. */
export function vector(values: readonly number[]): Tensor {
  return { data: new Float32Array(values), dims: [values.length] };
}

function sums(): ReadonlyMap<string, Tensor> {
  return new Map([
    ['a', vector([1, 2, 3, 0.5])],
    ['b', vector([10, 20, 30, 0.25])],
  ]);
}

/** Holds `name` to the inference port's contract. */
export function portContract(name: string, subject: ContractSubject): void {
  const open = async (
    options: InferenceOptions = PINNED,
    capabilities: InferenceCapabilities = EVERY_CAPABILITY,
  ): Promise<InferenceSession> =>
    valueOf(await subject.port(capabilities).open(subject.model(), options));

  const budget = subject.timeout === undefined ? {} : { timeout: subject.timeout };
  describe(`${name} keeps the inference port's contract`, budget, () => {
    it("opens a session that names the model's inputs and outputs and says it is pinned", async () => {
      const session = await open();
      expect(session.inputs).toEqual([
        { name: 'a', dims: ['n'] },
        { name: 'b', dims: ['n'] },
      ]);
      expect(session.outputs).toEqual([{ name: 'c', dims: ['n'] }]);
      expect(session.execution.options).toEqual(PINNED);
      session.release();
    });

    it('runs the model', async () => {
      const session = await open();
      const outputs = valueOf(await session.run(sums()));
      expect([...outputs.keys()]).toEqual(['c']);
      expect(outputs.get('c')?.dims).toEqual([4]);
      expect([...(outputs.get('c')?.data ?? [])]).toEqual([11, 22, 33, 0.75]);
      session.release();
    });

    it('says a preview is a preview, with the accelerator it runs on', async () => {
      const preview: InferenceOptions = {
        kind: InferenceMode.Preview,
        graphOptimisation: GraphOptimisation.All,
        accelerator: { kind: PreviewAcceleratorKind.Threads, threads: 1 },
      };
      const session = await open(preview);
      expect(session.execution.options).toEqual(preview);
      session.release();
    });

    it('refuses a pinned session where fixed-width SIMD is missing, rather than run it another way', async () => {
      const port = subject.port({ ...EVERY_CAPABILITY, fixedWidthSimd: false });
      expect(codesOf(await port.open(subject.model(), PINNED))).toEqual([
        'inference.capability-missing',
      ]);
    });

    it('refuses a WebGPU preview where there is no WebGPU, and a preview on more threads than are offered', async () => {
      const port = subject.port({ ...EVERY_CAPABILITY, webGpu: false, threads: 1 });
      const webGpu: InferenceOptions = {
        kind: InferenceMode.Preview,
        graphOptimisation: GraphOptimisation.All,
        accelerator: { kind: PreviewAcceleratorKind.WebGpu },
      };
      const threads: InferenceOptions = {
        kind: InferenceMode.Preview,
        graphOptimisation: GraphOptimisation.All,
        accelerator: { kind: PreviewAcceleratorKind.Threads, threads: 2 },
      };
      expect(codesOf(await port.open(subject.model(), webGpu))).toEqual([
        'inference.capability-missing',
      ]);
      expect(codesOf(await port.open(subject.model(), threads))).toEqual([
        'inference.capability-missing',
      ]);
    });

    it('refuses inputs that do not fit the model, naming each misfit', async () => {
      const session = await open();
      const missing = await session.run(new Map([['a', vector([1])]]));
      expect(codesOf(missing)).toEqual(['inference.input-mismatch']);
      const extra = await session.run(new Map([...sums(), ['d', vector([1])]]));
      expect(codesOf(extra)).toEqual(['inference.input-mismatch']);
      const matrix: Tensor = { data: new Float32Array(4), dims: [2, 2] };
      const rank = await session.run(
        new Map([
          ['a', matrix],
          ['b', vector([1, 2, 3, 4])],
        ]),
      );
      expect(codesOf(rank)).toEqual(['inference.input-mismatch']);
      session.release();
    });

    it('answers a cancelled open and a cancelled run as cancelled', async () => {
      const port = subject.port(EVERY_CAPABILITY);
      const gone = createCancellationSource();
      gone.cancel();
      expect(codesOf(await port.open(subject.model(), PINNED, gone.signal))).toEqual([
        'inference.cancelled',
      ]);
      const session = valueOf(await port.open(subject.model(), PINNED));
      expect(codesOf(await session.run(sums(), gone.signal))).toEqual(['inference.cancelled']);
      session.release();
    });

    it('answers a run on a released session as released, and releases twice without complaint', async () => {
      const session = await open();
      session.release();
      session.release();
      expect(codesOf(await session.run(sums()))).toEqual(['inference.session-released']);
    });
  });
}
