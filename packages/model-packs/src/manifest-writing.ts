/**
 * The manifest as the document its reader reads: what the storage keeps of each
 * pack, and what a pack build writes (ADR-0062).
 */

import type { JsonObject } from '@audiogubbins/project-format';

import type { ModelPackManifest } from './manifest.js';

/** The manifest format this build reads and writes. */
export const MANIFEST_FORMAT = 1;

/** The manifest as the document the manifest reader reads. */
export function manifestJson(manifest: ModelPackManifest): JsonObject {
  return {
    format: MANIFEST_FORMAT,
    id: manifest.id,
    name: manifest.name,
    purpose: manifest.purpose,
    version: manifest.version,
    downloadBytes: manifest.downloadBytes,
    installedBytes: manifest.installedBytes,
    files: manifest.files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
    })),
    licence: { code: manifest.licence.code, weights: manifest.licence.weights },
    runtime: {
      name: manifest.runtime.name,
      minimum: manifest.runtime.minimum,
      below: manifest.runtime.below,
      capabilities: [...manifest.runtime.capabilities],
    },
    tier: manifest.tier,
    serves: {
      processors: [...manifest.serves.processors],
      detectors: [...manifest.serves.detectors],
    },
  };
}
