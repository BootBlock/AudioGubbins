/**
 * Golden outputs of the spectral edits the engine realises itself (ADR-0081):
 * `attenuate` at nothing, which removes, and at a quarter, `isolate` and
 * `heal`, over a mask of each shape kind, of four channels with and without a
 * channel scope, at the default resolution, a finer and a coarser one, and at
 * the render's quality and a preview's (`testing/spectral-golden.ts`). Both
 * DSP paths give the pinned bits, and every sample no changed frame reaches
 * is its input, bit for bit. A pinned value may change only with a change of
 * the canonical arithmetic or of the realisation the ADR states, which that
 * change justifies.
 *
 * The `process` operation runs a chain of the rack's processors, so its
 * goldens are the effect rack's (`spectral-process.spectral-golden.test.ts`).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  maskProblem,
  type PlannedSpectralEdit,
  type PlannedSpectralOperation,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { wasmDsp } from '../dsp/wasm/wasm-dsp.js';
import { dspModuleExports } from '../testing/dsp-module.js';
import { NO_CHAIN_PROCESSING } from '../testing/plan-processing.js';
import {
  GOLDEN_LENGTH,
  GOLDEN_MASKS,
  GOLDEN_RATE,
  GOLDEN_SETTINGS,
  changedReach,
  expectSpectralGolden,
} from '../testing/spectral-golden.js';

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

/** The operations the engine realises itself. */
const OPERATIONS: readonly (readonly [string, PlannedSpectralOperation])[] = [
  ['remove', { kind: 'attenuate', gain: 0 }],
  ['attenuate', { kind: 'attenuate', gain: 0.25 }],
  ['isolate', { kind: 'isolate', gain: 0.1 }],
  ['heal', { kind: 'heal' }],
];

/** Each case's fingerprint, recorded from the reference path, which the WebAssembly DSP matched. */
const GOLDENS: Readonly<Record<string, bigint>> = {
  'remove over the rectangle, default at maximum': 0x7b3c2a03eabaa923n,
  'remove over the rectangle, 512 at maximum': 0x42d5538c3c8035f2n,
  'remove over the rectangle, 8192 at draft': 0x7dcd4d31a20eb17en,
  'attenuate over the rectangle, default at maximum': 0xcfadef2accf33289n,
  'attenuate over the rectangle, 512 at maximum': 0x1bb6c9106e8085d4n,
  'attenuate over the rectangle, 8192 at draft': 0xca84a6a7dc3dcf3dn,
  'isolate over the rectangle, default at maximum': 0x15c0b3f7acbe71c7n,
  'isolate over the rectangle, 512 at maximum': 0x249872c2865e82c5n,
  'isolate over the rectangle, 8192 at draft': 0x152edff8da63d7abn,
  'heal over the rectangle, default at maximum': 0xed4c67d9af07679bn,
  'heal over the rectangle, 512 at maximum': 0x0c41cdc9adf0b498n,
  'heal over the rectangle, 8192 at draft': 0x16aa0a7934e34996n,
  'remove over the polygon, default at maximum': 0x1c51d52c078b4fcfn,
  'remove over the polygon, 512 at maximum': 0x96c3dcb269ffa4f3n,
  'remove over the polygon, 8192 at draft': 0x0f10c761224e6dacn,
  'attenuate over the polygon, default at maximum': 0x64586d43f87b0e04n,
  'attenuate over the polygon, 512 at maximum': 0x9d40e7680ccb3300n,
  'attenuate over the polygon, 8192 at draft': 0x748c42117e56f5ben,
  'isolate over the polygon, default at maximum': 0xa007b032d9b9a0b1n,
  'isolate over the polygon, 512 at maximum': 0xc3f17be6827284a9n,
  'isolate over the polygon, 8192 at draft': 0x701256c3fff8fde5n,
  'heal over the polygon, default at maximum': 0xfe68a9bea481de3bn,
  'heal over the polygon, 512 at maximum': 0x2d24861b251f0468n,
  'heal over the polygon, 8192 at draft': 0x378b0fc13c70c545n,
  'remove over the stroke, default at maximum': 0xac3ce8153ce21165n,
  'remove over the stroke, 512 at maximum': 0x4c0b655a0b1e2d6en,
  'remove over the stroke, 8192 at draft': 0x5ec8546e6b781d6cn,
  'attenuate over the stroke, default at maximum': 0xcdefee5b26ebf229n,
  'attenuate over the stroke, 512 at maximum': 0x15016f2d501e6dc6n,
  'attenuate over the stroke, 8192 at draft': 0x8cd33c9c014f93c9n,
  'isolate over the stroke, default at maximum': 0x3e105084c40034e4n,
  'isolate over the stroke, 512 at maximum': 0x37f5f115ed6bfbebn,
  'isolate over the stroke, 8192 at draft': 0xeeff99997a3b959bn,
  'heal over the stroke, default at maximum': 0x9f29edceb97ce2f2n,
  'heal over the stroke, 512 at maximum': 0xcffb6dc6176bafdfn,
  'heal over the stroke, 8192 at draft': 0x6b645bf863c1c6ddn,
  'remove over the subtract, default at maximum': 0xc52b0a4d601fb7a6n,
  'remove over the subtract, 512 at maximum': 0x2353f03c96b83379n,
  'remove over the subtract, 8192 at draft': 0x99b3097e7891d9den,
  'attenuate over the subtract, default at maximum': 0xc197789b289a7474n,
  'attenuate over the subtract, 512 at maximum': 0x553666842feff74dn,
  'attenuate over the subtract, 8192 at draft': 0x39124d986c07c5acn,
  'isolate over the subtract, default at maximum': 0x86f3e4f752b335een,
  'isolate over the subtract, 512 at maximum': 0x55e87ac05e95488en,
  'isolate over the subtract, 8192 at draft': 0x9ea552e27bcfe510n,
  'heal over the subtract, default at maximum': 0x25d55e0baf29bdbcn,
  'heal over the subtract, 512 at maximum': 0x4bbd9d59613dbf99n,
  'heal over the subtract, 8192 at draft': 0x9850ec8790039f6cn,
  'remove over the feather, default at maximum': 0xbeed99d2f6e17514n,
  'remove over the feather, 512 at maximum': 0xd46ae3ccb37b70c1n,
  'remove over the feather, 8192 at draft': 0xc00e1d17f364a1ccn,
  'attenuate over the feather, default at maximum': 0x2706f67edf6b9c65n,
  'attenuate over the feather, 512 at maximum': 0xf78a2ceada964948n,
  'attenuate over the feather, 8192 at draft': 0x37b3cae81728b2edn,
  'isolate over the feather, default at maximum': 0x27532e228c14d597n,
  'isolate over the feather, 512 at maximum': 0xcb509d0f01fc9fdfn,
  'isolate over the feather, 8192 at draft': 0xdd100d0cb1ca4851n,
  'heal over the feather, default at maximum': 0x0bdf037972c833c6n,
  'heal over the feather, 512 at maximum': 0xb3e77014617987cdn,
  'heal over the feather, 8192 at draft': 0xbf88ee9c273f303fn,
};

const CASES = GOLDEN_MASKS.flatMap(({ name: maskName, mask, channels }) =>
  OPERATIONS.flatMap(([operationName, operation]) =>
    GOLDEN_SETTINGS.map(({ name: settingsName, resolution, quality }) => {
      const edit: PlannedSpectralEdit = {
        mask,
        resolution,
        operation,
        ...(channels === undefined ? {} : { channels }),
      };
      return [`${operationName} over the ${maskName}, ${settingsName}`, edit, quality] as const;
    }),
  ),
);

describe('the masks of the spectral goldens', () => {
  it.each(GOLDEN_MASKS)('$name stands over the sound', ({ mask }) => {
    expect(maskProblem(mask, GOLDEN_LENGTH)).toBeUndefined();
  });

  it('leave a span of whole frames unchanged within the subtracting mask', () => {
    const subtracting = GOLDEN_MASKS.find(({ name }) => name === 'subtract');
    if (subtracting === undefined) throw new Error('A golden mask subtracts.');
    const reach = changedReach(
      { mask: subtracting.mask, resolution: 512, operation: { kind: 'heal' } },
      GOLDEN_RATE,
      MAXIMUM_QUALITY.settings.spectralOverlap,
      GOLDEN_LENGTH,
    );
    expect(reach.subarray(18_300, 27_700).every((reached) => reached === 0)).toBe(true);
    expect(reach.subarray(10_000, 17_000).every((reached) => reached === 1)).toBe(true);
  });
});

describe('a spectral edit the engine realises', () => {
  it.each(CASES)(
    '%s gives the same pinned bits on either DSP, and its input where no changed frame reaches',
    async (name, edit, quality) => {
      await expectSpectralGolden({
        edit,
        quality,
        processing: NO_CHAIN_PROCESSING,
        wasm,
        golden: GOLDENS[name],
      });
    },
  );
});
