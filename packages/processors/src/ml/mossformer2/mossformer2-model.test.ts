import { describe, expect, it } from 'vitest';

import { modelHashOf } from '@audiogubbins/domain';

import { packDefinition, textSha256 } from '../../testing/pack-definitions.js';
import { MOSSFORMER2_SE_48K_DESCRIPTOR } from './mossformer2.js';
import { MOSSFORMER2_GRAPH, MOSSFORMER2_SE_48K_MODEL } from './mossformer2-model.js';

/** The pack's definition, which the pack build makes the files from and checks them by. */
const DEFINITION = packDefinition('mossformer2-se-48k');

describe("MossFormer2 SE 48K's model, as this build names it", () => {
  it("is the pack's version, and the graph it runs is the pack's, by hash", () => {
    const { identity, files } = MOSSFORMER2_SE_48K_MODEL;
    expect([identity.pack, identity.version]).toEqual([DEFINITION.id, DEFINITION.version]);
    expect(files.map((file) => file.path)).toEqual([MOSSFORMER2_GRAPH]);
    for (const file of files) {
      expect(DEFINITION.files.find((one) => one.path === file.path)?.sha256, file.path).toBe(
        file.sha256,
      );
    }
  });

  it("is named by the listing of every file of the pack's definition, licence and notice too", () => {
    expect(DEFINITION.files.map((file) => file.path).sort()).toEqual([
      'LICENSE',
      'MODEL-CARD.md',
      'NOTICE',
      'model.onnx',
    ]);
    expect(MOSSFORMER2_SE_48K_MODEL.identity.modelHash).toBe(
      modelHashOf(DEFINITION.files, textSha256),
    );
  });

  it('is the processor the pack serves, and the identity its instances persist', () => {
    expect(DEFINITION.serves.processors).toEqual([MOSSFORMER2_SE_48K_DESCRIPTOR.typeKey]);
    expect(MOSSFORMER2_SE_48K_DESCRIPTOR.version.model).toBe(MOSSFORMER2_SE_48K_MODEL.identity);
  });
});
