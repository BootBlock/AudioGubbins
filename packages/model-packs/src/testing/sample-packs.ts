/**
 * Manifests for tests, valid as the reader holds them, built from a few values
 * and named files.
 */

import { QualityLevel } from '@audiogubbins/domain';

import type { ModelPackManifest, PackFile } from '../manifest.js';

/** A hash for a file whose bytes no test checks. */
export const ANY_SHA256 = '0'.repeat(64);

/** What a sample manifest may be given beside its defaults. */
export interface SampleOptions {
  readonly id?: string;
  readonly version?: string;
  readonly files?: readonly PackFile[];
  readonly processors?: readonly string[];
  readonly detectors?: readonly string[];
  readonly runtime?: Partial<ModelPackManifest['runtime']>;
}

/**
 * A manifest of `options`, by default `sample-pack` 1.0.0 serving the processor
 * `sample-denoise` on ONNX Runtime Web 1.30 and on, below 2.0, with two files
 * whose hashes no test checks. Its download size is its files' sum.
 */
export function sampleManifest(options: SampleOptions = {}): ModelPackManifest {
  const files = options.files ?? [
    { path: 'encoder.onnx', bytes: 5, sha256: ANY_SHA256 },
    { path: 'models/decoder.onnx', bytes: 3, sha256: ANY_SHA256 },
  ];
  const downloadBytes = files.reduce((total, file) => total + file.bytes, 0);
  return {
    id: options.id ?? 'sample-pack',
    name: 'Sample pack',
    purpose: 'Removes noise from a test signal.',
    version: options.version ?? '1.0.0',
    downloadBytes,
    installedBytes: downloadBytes,
    files,
    licence: { code: 'MIT', weights: 'Apache-2.0' },
    runtime: {
      name: 'onnxruntime-web',
      minimum: '1.30.0',
      below: '2.0.0',
      capabilities: ['webassembly-simd'],
      ...options.runtime,
    },
    tiers: [QualityLevel.Standard, QualityLevel.High],
    serves: {
      processors: options.processors ?? ['sample-denoise'],
      detectors: options.detectors ?? [],
    },
  };
}
