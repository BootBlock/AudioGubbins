import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEEPFILTERNET_3_DESCRIPTOR } from './deepfilternet.js';
import { BINS, DEEPFILTERNET_3_MODEL, ERB_BANDS, ERB_WIDTHS } from './deepfilternet-model.js';

/** The pack's definition, which the pack build makes the files from and checks them by. */
const DEFINITION = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../../tools/model-packs/packs/deepfilternet-3.json', import.meta.url),
    ),
    'utf8',
  ),
) as {
  readonly id: string;
  readonly version: string;
  readonly serves: { readonly processors: readonly string[] };
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
};

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

describe("DeepFilterNet 3's model, as this build names it", () => {
  it("is the pack's version, and the files it runs are the pack's, by hash", () => {
    const { identity, files } = DEEPFILTERNET_3_MODEL;
    expect([identity.pack, identity.version]).toEqual([DEFINITION.id, DEFINITION.version]);
    for (const file of files) {
      expect(DEFINITION.files.find((one) => one.path === file.path)?.sha256, file.path).toBe(
        file.sha256,
      );
    }
    expect(files.map((file) => file.path).sort()).toEqual([
      'df_dec.onnx',
      'enc.onnx',
      'erb_dec.onnx',
    ]);
  });

  it('is named by the hash of the listing of the files it runs, sorted by path', () => {
    const listing = [...DEEPFILTERNET_3_MODEL.files]
      .sort((one, other) => (one.path < other.path ? -1 : one.path > other.path ? 1 : 0))
      .map((file) => `${file.sha256}  ${file.path}\n`)
      .join('');
    expect(DEEPFILTERNET_3_MODEL.identity.modelHash).toBe(sha256(listing));
  });

  it('is the processor the pack serves, and the identity its instances persist', () => {
    expect(DEFINITION.serves.processors).toEqual([DEEPFILTERNET_3_DESCRIPTOR.typeKey]);
    expect(DEEPFILTERNET_3_DESCRIPTOR.version.model).toBe(DEEPFILTERNET_3_MODEL.identity);
  });

  it('gives every bin to one ERB band', () => {
    expect(ERB_WIDTHS).toHaveLength(ERB_BANDS);
    expect(ERB_WIDTHS.reduce((sum, width) => sum + width, 0)).toBe(BINS);
  });
});
