import { describe, expect, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import { createDeterministicIdGenerator } from '@audiogubbins/domain';
import {
  NESTED_ARGUMENT_LIMITS,
  canonicalJson,
  isJsonObject,
  parseJson,
  storageKeyOf,
  type JsonObject,
  type JsonValue,
} from '@audiogubbins/project-format';
import { randomAssetRecord, seededRandom } from '@audiogubbins/project-format/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { ProjectCommandId } from './project-command.js';
import { addAssetInvocation } from './project-invocations.js';
import {
  appliedOf,
  assertReadsBack,
  entryOf,
  projectBus,
  refusalCodeOf,
  unchangedCodeOf,
} from './testing/bus-runs.js';
import { referenceState } from './testing/reference-state.js';

const bus = projectBus();
const { state, assets } = referenceState(sampleProject());

/** A new asset and source, not yet in the reference state. */
function newRecord(seed: number) {
  return randomAssetRecord(
    seededRandom(seed),
    createDeterministicIdGenerator(1_000 + seed),
    state.project.id,
  );
}

function addAsset(asset: string | number): CommandInvocation {
  return { commandId: ProjectCommandId.AddAsset, arguments: { asset } };
}

function removeAsset(assetId: string): CommandInvocation {
  return { commandId: ProjectCommandId.RemoveAsset, arguments: { assetId } };
}

function renameAsset(assetId: string, name: string): CommandInvocation {
  return { commandId: ProjectCommandId.RenameAsset, arguments: { assetId, name } };
}

/** The record argument of an asset, edited as JSON. */
function editedRecord(edit: (record: JsonObject) => JsonValue): string {
  const { asset, source } = newRecord(1);
  const text = addAssetInvocation(asset, source).arguments?.['asset'];
  const parsed = typeof text === 'string' ? parseJson(text, NESTED_ARGUMENT_LIMITS) : undefined;
  if (parsed?.ok !== true || !isJsonObject(parsed.value)) throw new Error('No record to edit.');
  return canonicalJson(edit(parsed.value));
}

describe('project.add-asset', () => {
  it('adds the asset with its source, undone by removing it', () => {
    const { asset, source } = newRecord(2);
    const result = bus.execute(state, addAssetInvocation(asset, source));
    const { next } = appliedOf(result);

    expect(next.project.assets.get(asset.id)).toEqual(asset);
    expect(next.sources.get(asset.id)).toEqual(source);
    assertReadsBack(next);
    expect(entryOf(result).description).toBe(`Add asset “${asset.displayName}”`);
    expect(entryOf(result).inverse).toEqual([removeAsset(asset.id)]);
    expect(appliedOf(bus.execute(next, entryOf(result).inverse[0])).next).toEqual(state);
  });

  it('carries the record as compact canonical JSON of the document’s own shapes', () => {
    const { asset, source } = newRecord(3);
    const text = addAssetInvocation(asset, source).arguments?.['asset'];

    expect(typeof text).toBe('string');
    const parsed = parseJson(String(text), NESTED_ARGUMENT_LIMITS);
    expect(parsed.ok && canonicalJson(parsed.value)).toBe(text);
    expect(parsed.ok && isJsonObject(parsed.value) && Object.keys(parsed.value).sort()).toEqual([
      'asset',
      'source',
    ]);
  });

  it('refuses an asset whose identifier the project already has', () => {
    const { asset, source } = newRecord(4);
    const id = assets.forest.id;
    const clash = { ...asset, id, storageKey: storageKeyOf(id, source.media) };

    expect(refusalCodeOf(bus.execute(state, addAssetInvocation(clash, source)))).toBe(
      'asset.duplicate-id',
    );
  });

  it('refuses a storage key its source does not give, by the format’s own rule', () => {
    const { asset, source } = newRecord(5);
    const miskeyed = addAssetInvocation({ ...asset, storageKey: 'fixture:elsewhere' }, source);
    expect(refusalCodeOf(bus.execute(state, miskeyed))).toBe('source.storage-key-mismatch');
  });

  it('refuses text that is not JSON, a record of another shape, and a malformed asset', () => {
    expect(refusalCodeOf(bus.execute(state, addAsset('{"asset":')))).toMatch(/^json\./u);
    expect(refusalCodeOf(bus.execute(state, addAsset('[]')))).toBe('schema.not-an-object');
    expect(
      refusalCodeOf(
        bus.execute(state, addAsset(editedRecord((record) => ({ ...record, extra: 1 })))),
      ),
    ).toBe('schema.unknown-member');
    const unsourced = editedRecord(({ asset }) => ({ asset: asset ?? null }));
    expect(refusalCodeOf(bus.execute(state, addAsset(unsourced)))).toBe('schema.missing-member');
    expect(refusalCodeOf(bus.execute(state, addAsset(7)))).toBe('argument.not-text');
  });

  it('refuses a source that belongs to another asset, by the format’s own rule', () => {
    const other = newRecord(6).asset.id;
    const orphaned = editedRecord((record) => {
      const entry = record['source'];
      return {
        ...record,
        source: entry !== undefined && isJsonObject(entry) ? { ...entry, assetId: other } : null,
      };
    });

    expect(refusalCodeOf(bus.execute(state, addAsset(orphaned)))).toBe('source.unknown-asset');
  });

  it('names where in the record a problem lies', () => {
    const result = bus.execute(
      state,
      addAsset(
        editedRecord((record) => {
          const asset = record['asset'];
          return {
            ...record,
            asset: asset !== undefined && isJsonObject(asset) ? { ...asset, length: -1 } : null,
          };
        }),
      ),
    );

    expect(result.kind === 'refused' ? result.failures[0].summary : '').toContain('“asset.length”');
  });
});

describe('project.remove-asset', () => {
  it('removes an asset no clip uses, undone by adding back the whole record', () => {
    const result = bus.execute(state, removeAsset(assets.forest.id));
    const { next } = appliedOf(result);

    expect(next.project.assets.has(assets.forest.id)).toBe(false);
    expect(next.sources.has(assets.forest.id)).toBe(false);
    assertReadsBack(next);
    expect(entryOf(result).description).toBe('Remove asset “Forest ambience”');
    expect(appliedOf(bus.execute(next, entryOf(result).inverse[0])).next).toEqual(state);
  });

  it('refuses while clips, regions or markers use the asset, saying how many', () => {
    const result = bus.execute(state, removeAsset(assets.footstep.id));

    expect(refusalCodeOf(result)).toBe('asset.in-use');
    expect(result.kind === 'refused' ? result.failures[0].summary : '').toBe(
      '“Gravel footstep” still has 2 clips that play it, 1 region and 1 marker. Remove them first.',
    );
  });

  it('refuses an identifier the project lacks, and one of the wrong shape', () => {
    expect(refusalCodeOf(bus.execute(state, removeAsset('0123456789abcdef')))).toBe(
      'asset.unknown',
    );
    expect(refusalCodeOf(bus.execute(state, removeAsset('Gravel footstep')))).toBe(
      'asset.id-malformed',
    );
  });

  it('is unavailable in a project without assets', () => {
    let empty = state;
    for (const assetId of [assets.forest.id, assets.rain.id]) {
      empty = appliedOf(bus.execute(empty, removeAsset(assetId))).next;
    }
    empty = {
      ...empty,
      project: { ...empty.project, clips: new Map(), regions: new Map(), markers: new Map() },
    };
    empty = appliedOf(bus.execute(empty, removeAsset(assets.footstep.id))).next;

    expect(bus.availability(empty, ProjectCommandId.RemoveAsset).available).toBe(false);
    expect(refusalCodeOf(bus.execute(empty, removeAsset(assets.footstep.id)))).toBe(
      'command.unavailable',
    );
  });
});

describe('project.rename-asset and project.set-asset-name', () => {
  it('renames with the name trimmed, undone by setting the old name exactly', () => {
    const result = bus.execute(state, renameAsset(assets.rain.id, '  Heavy rain '));
    const { next } = appliedOf(result);

    expect(next.project.assets.get(assets.rain.id)?.displayName).toBe('Heavy rain');
    assertReadsBack(next);
    expect(entryOf(result).description).toBe('Rename asset “Rain” to “Heavy rain”');
    expect(entryOf(result).inverse).toEqual([
      {
        commandId: ProjectCommandId.SetAssetName,
        arguments: { assetId: assets.rain.id, name: 'Rain' },
      },
    ]);
    expect(appliedOf(bus.execute(next, entryOf(result).inverse[0])).next).toEqual(state);
  });

  it('refuses a blank name and one past the bound, and changes nothing for the same name', () => {
    expect(refusalCodeOf(bus.execute(state, renameAsset(assets.rain.id, '   ')))).toBe(
      'asset.name-blank',
    );
    expect(refusalCodeOf(bus.execute(state, renameAsset(assets.rain.id, '\u200B')))).toBe(
      'asset.name-blank',
    );
    expect(refusalCodeOf(bus.execute(state, renameAsset(assets.rain.id, 'r'.repeat(1_025))))).toBe(
      'asset.name-too-long',
    );
    expect(unchangedCodeOf(bus.execute(state, renameAsset(assets.rain.id, 'Rain ')))).toBe(
      'asset.name-unchanged',
    );
  });

  it('sets a padded name exactly', () => {
    const invocation = {
      commandId: ProjectCommandId.SetAssetName,
      arguments: { assetId: assets.rain.id, name: ' Rain\n' },
    };
    const { next } = appliedOf(bus.execute(state, invocation));

    expect(next.project.assets.get(assets.rain.id)?.displayName).toBe(' Rain\n');
    assertReadsBack(next);
  });
});
