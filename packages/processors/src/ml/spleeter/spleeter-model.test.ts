import { describe, expect, it } from 'vitest';

import { modelHashOf } from '@audiogubbins/domain';

import { packDefinition, textSha256 } from '../../testing/pack-definitions.js';
import { SPLEETER_2_STEMS_DESCRIPTOR, SPLEETER_4_STEMS_DESCRIPTOR } from './spleeter.js';
import {
  SPLEETER_2_STEMS_MODEL,
  SPLEETER_4_STEMS_MODEL,
  SPLEETER_GRAPH,
} from './spleeter-model.js';

describe.each([
  { model: SPLEETER_2_STEMS_MODEL, descriptor: SPLEETER_2_STEMS_DESCRIPTOR },
  { model: SPLEETER_4_STEMS_MODEL, descriptor: SPLEETER_4_STEMS_DESCRIPTOR },
])('the model of $descriptor.label, as this build names it', ({ model, descriptor }) => {
  const { definition } = model;
  const pack = packDefinition(definition.identity.pack);

  it("is the pack's version, and the graph it runs is the pack's, by hash", () => {
    expect([definition.identity.pack, definition.identity.version]).toEqual([
      pack.id,
      pack.version,
    ]);
    expect(definition.files.map((file) => file.path)).toEqual([SPLEETER_GRAPH]);
    for (const file of definition.files) {
      expect(pack.files.find((one) => one.path === file.path)?.sha256, file.path).toBe(file.sha256);
    }
  });

  it("is named by the listing of every file of the pack's definition, licence and notice too", () => {
    expect(pack.files.map((file) => file.path).sort()).toEqual(['LICENSE', 'NOTICE', 'model.onnx']);
    expect(definition.identity.modelHash).toBe(modelHashOf(pack.files, textSha256));
  });

  it('is the processor the pack serves, and the identity its instances persist', () => {
    expect(pack.serves.processors).toEqual([descriptor.typeKey]);
    expect(descriptor.version.model).toBe(definition.identity);
  });

  it('separates as many stems as the graph was exported with', () => {
    const exported = pack.files.find((file) => file.path === SPLEETER_GRAPH)?.make.export;
    const given = exported?.arguments ?? [];
    expect(model.stems).toHaveLength(Number(given[given.indexOf('--stems') + 1]));
  });
});
