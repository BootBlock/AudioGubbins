import { describe, expect, it } from 'vitest';

import { modelHashOf } from '@audiogubbins/domain';

import { packDefinition, textSha256 } from '../../testing/pack-definitions.js';
import { DEEPFILTERNET_3_DESCRIPTOR } from './deepfilternet.js';
import { BINS, DEEPFILTERNET_3_MODEL, ERB_BANDS, ERB_WIDTHS } from './deepfilternet-model.js';

/** The pack's definition, which the pack build makes the files from and checks them by. */
const DEFINITION = packDefinition('deepfilternet-3');

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

  it("is named by the listing of every file of the pack's definition, licences and notice too", () => {
    expect(DEFINITION.files.map((file) => file.path).sort()).toEqual([
      'LICENSE-APACHE',
      'LICENSE-MIT',
      'NOTICE',
      'df_dec.onnx',
      'enc.onnx',
      'erb_dec.onnx',
    ]);
    expect(DEEPFILTERNET_3_MODEL.identity.modelHash).toBe(
      modelHashOf(DEFINITION.files, textSha256),
    );
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
