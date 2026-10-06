import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { runtimeWebAssembly } from '../testing/model-services.js';
import { PINNED_RUNTIME_SHA256 } from './model-definition.js';

describe('the runtime build every pinned session runs on', () => {
  it("is the installed onnxruntime-web's CPU WebAssembly, by hash", () => {
    expect(createHash('sha256').update(runtimeWebAssembly()).digest('hex')).toBe(
      PINNED_RUNTIME_SHA256,
    );
  });
});
