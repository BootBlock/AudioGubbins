import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  QualityLevel,
  createCancellationSource,
  fail,
  failure,
  type DomainResult,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { LocalInferenceSupport, ModelPackManifest } from '@audiogubbins/model-packs';
import { PINNED_RUNTIME_SHA256 } from '@audiogubbins/processors';
import type { ModelFileRead } from '@audiogubbins/ml-runtime';

import { buildShellContext } from '../testing/shell-context.js';
import { projectWorld } from '../testing/project-context.js';
import { installedModelFiles } from './installed-model-files.js';
import { createModelAvailabilityStore } from './model-availability.js';

/**
 * The model library on the installed packs (ADR-0062): a thread asking for a
 * model's file is answered from what the storage worker's installer keeps,
 * with the bytes and the SHA-256 taken as they were read, or with which of
 * REQ-AUDIO-139's conditions holds: a required model unavailable where the
 * version is not kept, kept but not installed, or no longer matches its
 * manifest; incompatible where it needs another runtime; unavailable for the
 * device where the device, or a browser that keeps no packs, runs none.
 */

const RUNTIME = {
  name: 'onnxruntime-web',
  version: '1.30.0',
  webAssemblySha256: PINNED_RUNTIME_SHA256,
};

const CAPABLE_DEVICE: LocalInferenceSupport = {
  status: 'full',
  explanation: '',
  missingRequired: [],
  missingPreferred: [],
};

const NO_SIMD: LocalInferenceSupport = {
  status: 'unavailable',
  explanation: 'This browser cannot run WebAssembly SIMD, which local inference needs.',
  missingRequired: [{ key: 'webassembly-simd', reason: 'No SIMD.' }],
  missingPreferred: [],
};

/** The bytes of the model's one file, and the SHA-256 they have. */
const MODEL_BYTES = new Uint8Array(Array.from({ length: 300 }, (_, index) => (index * 7) % 251));
const MODEL_SHA256 = createHash('sha256').update(MODEL_BYTES).digest('hex');

function manifest(id: string, options: { readonly runtimeBelow?: string } = {}): ModelPackManifest {
  return {
    id,
    name: `Pack ${id}`,
    purpose: 'Removes noise from a test signal.',
    version: '1.0.0',
    downloadBytes: MODEL_BYTES.length,
    installedBytes: MODEL_BYTES.length,
    files: [{ path: 'model.onnx', bytes: MODEL_BYTES.length, sha256: MODEL_SHA256 }],
    licence: { code: 'MIT', weights: 'Apache-2.0' },
    runtime: {
      name: 'onnxruntime-web',
      minimum: '1.0.0',
      below: options.runtimeBelow ?? '2.0.0',
      capabilities: ['webassembly-simd'],
    },
    tiers: [QualityLevel.Standard],
    serves: { processors: [id], detectors: [] },
  };
}

/** How a version is kept before the page first asks: sealed whole, part-received, or with other bytes. */
type Kept = 'installed' | 'paused' | 'altered';

/**
 * A page's library over a storage worker whose store keeps `packs`, as the
 * installer learns them on the page's first question, on a device `device`
 * describes; `context` stands in for the availability store's own reading
 * where a test makes it fail.
 */
async function library(
  packs: readonly (readonly [ModelPackManifest, Kept])[],
  options: {
    readonly device?: LocalInferenceSupport;
    readonly context?: 'unreadable';
  } = {},
) {
  const world = projectWorld();
  for (const [pack, kept] of packs) {
    const ref = { id: pack.id, version: pack.version };
    expectSuccess(await world.storage.packs.stage(pack));
    const sink = expectSuccess(await world.storage.packs.append(ref, 0));
    const bytes = kept === 'altered' ? MODEL_BYTES.map((byte) => 255 - byte) : MODEL_BYTES;
    await sink.write(kept === 'paused' ? bytes.subarray(0, 100) : bytes);
    await sink.close();
    if (kept !== 'paused') expectSuccess(await world.storage.packs.seal(ref));
  }
  const { client } = world.page(buildShellContext().context);
  const availability = createModelAvailabilityStore({
    packs: client.packs,
    runtime: () => Promise.resolve(RUNTIME),
    device: () => options.device ?? CAPABLE_DEVICE,
    unknown: () => undefined,
  });
  return installedModelFiles({
    files: client.packs,
    context:
      options.context === 'unreadable'
        ? () =>
            Promise.resolve(
              fail(failure('test.unreadable', FailureKind.Retryable, 'The worker did not answer.')),
            )
        : availability.current,
  });
}

/** Asks `read` for the model file of version 1.0.0 of `pack`. */
async function asked(
  read: Awaited<ReturnType<typeof library>>,
  pack: string,
): Promise<DomainResult<ModelFileRead>> {
  return await read(pack, '1.0.0', 'model.onnx', createCancellationSource().signal);
}

/** The condition a refusal names, its code, and the code of the reason beneath it. */
function refusal(read: DomainResult<ModelFileRead>) {
  if (read.ok) return 'read';
  const [first] = read.failures;
  return {
    code: first.code,
    condition: first.details?.['condition'],
    cause: first.cause?.code,
  };
}

describe('the model library on the installed packs (REQ-AUDIO-139)', () => {
  it('gives an installed file its bytes, with the SHA-256 taken as they were read', async () => {
    const read = await library([[manifest('denoise'), 'installed']]);

    const file = expectSuccess(await asked(read, 'denoise'));

    expect([...file.bytes]).toEqual([...MODEL_BYTES]);
    expect(file.sha256).toBe(MODEL_SHA256);
  });

  it('says a required model is unavailable where the version is not kept', async () => {
    const read = await library([[manifest('denoise'), 'installed']]);

    expect(refusal(await asked(read, 'separate'))).toEqual({
      code: 'model.unavailable',
      condition: 'required-unavailable',
      cause: 'model-pack.not-installed',
    });
  });

  it('says a required model is unavailable where the version is kept but not installed', async () => {
    const read = await library([[manifest('denoise'), 'paused']]);

    expect(refusal(await asked(read, 'denoise'))).toEqual({
      code: 'model.unavailable',
      condition: 'required-unavailable',
      cause: 'model-pack.not-ready',
    });
  });

  it('says a required model is unavailable where the file no longer matches its manifest', async () => {
    const read = await library([[manifest('denoise'), 'altered']]);

    expect(refusal(await asked(read, 'denoise'))).toEqual({
      code: 'model.unavailable',
      condition: 'required-unavailable',
      cause: 'model-pack.file-hash-mismatch',
    });
  });

  it('says a required model is unavailable where what is installed cannot be read', async () => {
    const read = await library([[manifest('denoise'), 'installed']], { context: 'unreadable' });

    expect(refusal(await asked(read, 'denoise'))).toEqual({
      code: 'model.unavailable',
      condition: 'required-unavailable',
      cause: 'test.unreadable',
    });
  });

  it('says the model is incompatible where the installed version needs another runtime', async () => {
    const read = await library([[manifest('denoise', { runtimeBelow: '1.20.0' }), 'installed']]);

    expect(refusal(await asked(read, 'denoise'))).toEqual({
      code: 'model.unavailable',
      condition: 'incompatible',
      cause: 'model-pack.runtime-incompatible',
    });
  });

  it('says the device cannot run it where local inference is unavailable here, kept or not', async () => {
    const read = await library([[manifest('denoise'), 'installed']], { device: NO_SIMD });

    for (const pack of ['denoise', 'separate']) {
      expect(refusal(await asked(read, pack))).toEqual({
        code: 'model.unavailable',
        condition: 'device-unavailable',
        cause: 'model-pack.device-unsupported',
      });
    }
  });

  it('says the device cannot run it where the browser keeps no packs, as availability says', async () => {
    const availability = createModelAvailabilityStore({
      packs: undefined,
      runtime: () => Promise.resolve(RUNTIME),
      device: () => CAPABLE_DEVICE,
      unknown: () => undefined,
    });
    const read = installedModelFiles({ files: undefined, context: availability.current });

    const answered = await read(
      'denoise',
      '1.0.0',
      'model.onnx',
      createCancellationSource().signal,
    );

    expect(refusal(answered)).toEqual({
      code: 'model.unavailable',
      condition: 'device-unavailable',
      cause: 'model-pack.device-unsupported',
    });
    const context = expectSuccess(await availability.current());
    expect(context.device.status).toBe('unavailable');
    expect(answered.ok ? undefined : answered.failures[0].cause?.summary).toBe(
      context.device.explanation,
    );
  });
});
