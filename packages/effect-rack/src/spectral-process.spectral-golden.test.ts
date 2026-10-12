/**
 * Golden outputs of a spectral `process` edit (ADR-0081): the masked part of a
 * chain's output in place of its input, the chain being the rack's own
 * processors run as the plan states them (ADR-0060), over the engine's golden
 * sound, masks and settings (`spectral-edit.spectral-golden.test.ts` holds the
 * other operations to them). The chain repairs the sound's clicks, through the
 * DSP's click detector, then filters it, so its output is a function of the DSP
 * the stream is read with and of where its run began, and both paths must give
 * the pinned bits and leave every sample no changed frame reaches as its input,
 * bit for bit.
 */

import { beforeAll, describe, it } from 'vitest';

import {
  GOLDEN_LAYOUT,
  GOLDEN_MASKS,
  GOLDEN_SETTINGS,
  dspModuleExports,
  expectSpectralGolden,
} from '@audiogubbins/audio-engine/testing';
import { wasmDsp, type CanonicalDsp } from '@audiogubbins/audio-engine';
import {
  createDeterministicIdGenerator,
  instantiateProcessor,
  type ChainSlot,
  type EffectChain,
  type PlannedSpectralEdit,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { processorValues } from '@audiogubbins/processors/testing';

import { chainProcessing } from './chain-run.js';

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

const ids = createDeterministicIdGenerator(808);
const PROCESSING = chainProcessing(PROCESSOR_TYPES_BY_KEY);

/** A slot of the processor `typeKey` with `values`. */
function slot(typeKey: string, values: Readonly<Record<string, number | string>>): ChainSlot {
  const type = PROCESSOR_TYPES_BY_KEY.get(typeKey);
  if (type === undefined) throw new Error(`The catalogue has a ${typeKey} processor.`);
  return {
    ...instantiateProcessor(ids.next(), type.descriptor),
    values: processorValues(type, values),
  };
}

/** A de-click of clicks up to 2 ms, then a 24 dB low-pass at 3 kHz. */
const CHAIN: EffectChain = {
  id: ids.next(),
  slots: [
    slot('de-click', { 'maximum-length': 2 }),
    slot('filter', { mode: 'low-pass', cutoff: 3_000, slope: '24-db' }),
  ],
};

/** Each case's fingerprint, recorded from the reference path, which the WebAssembly DSP matched. */
const GOLDENS: Readonly<Record<string, bigint>> = {
  'process over the rectangle, default at maximum': 0xb7e13d86cb1c3d5dn,
  'process over the rectangle, 512 at maximum': 0x5b0dded28e3ffdden,
  'process over the rectangle, 8192 at draft': 0x81ee849a523e3c7an,
  'process over the polygon, default at maximum': 0xd1f08c5fff3fd3c4n,
  'process over the polygon, 512 at maximum': 0xa6e521d24d9e07c9n,
  'process over the polygon, 8192 at draft': 0xcab4d46cb7b0404dn,
  'process over the stroke, default at maximum': 0xca7a3f1a48854e72n,
  'process over the stroke, 512 at maximum': 0x3ef73d98419f65a1n,
  'process over the stroke, 8192 at draft': 0xdf70da0bc56d69e6n,
  'process over the subtract, default at maximum': 0xd42fa7971f1cfc34n,
  'process over the subtract, 512 at maximum': 0x0be433690c84d873n,
  'process over the subtract, 8192 at draft': 0x34fff93b3852b948n,
  'process over the feather, default at maximum': 0x5e14fedaf0365e02n,
  'process over the feather, 512 at maximum': 0x11d40b6daa700e1fn,
  'process over the feather, 8192 at draft': 0xea06a23fe4058071n,
};

const CASES = GOLDEN_MASKS.flatMap(({ name: maskName, mask, channels }) =>
  GOLDEN_SETTINGS.map(({ name: settingsName, resolution, quality }) => {
    const edit: PlannedSpectralEdit = {
      mask,
      resolution,
      operation: { kind: 'process', chain: CHAIN, input: GOLDEN_LAYOUT },
      ...(channels === undefined ? {} : { channels }),
    };
    return [`process over the ${maskName}, ${settingsName}`, edit, quality] as const;
  }),
);

describe('a spectral edit that processes its area through a chain', () => {
  it.each(CASES)(
    '%s gives the same pinned bits on either DSP, and its input where no changed frame reaches',
    async (name, edit, quality) => {
      await expectSpectralGolden({
        edit,
        quality,
        processing: PROCESSING,
        wasm,
        golden: GOLDENS[name],
      });
    },
  );
});
