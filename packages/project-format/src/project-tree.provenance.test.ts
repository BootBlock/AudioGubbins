import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { unsafeBrandId } from '@audiogubbins/domain';

import { isJsonObject, type JsonObject, type JsonValue } from './canonical-json.js';
import { stateFingerprintFrom } from './content-identity.js';
import { ExportDestinationKind, ExportStatus, type ExportRecord } from './export-provenance.js';
import { parseJson } from './json-parsing.js';
import { projectTree, type ProjectTreeContent } from './project-tree-writing.js';
import { ProvenanceLevel } from './provenance-stripping.js';
import { nodeDigest } from './testing/node-digest.js';
import { contentIdOfDigit, referenceState } from './testing/project-states.js';
import { historyContent, writtenFiles, type WrittenFile } from './testing/project-trees.js';
import { decodeUtf8 } from './utf8.js';

/**
 * What a tree of the state alone keeps of where its audio came from, at each
 * level a person may choose (REQ-STOR-166, REQ-STOR-197): every member of an
 * asset's provenance, a linked file's identity and an export record that
 * survives, named one by one, so a level keeps exactly what its words say and
 * a member added later must be placed in a level before any tree is written.
 */

/** The members each level keeps of an asset's provenance, a linked file's identity and an export. */
const KEPT = {
  full: {
    provenance: [
      'audio',
      'byteLength',
      'importedAt',
      'mediaType',
      'originProjectId',
      'originalFileName',
      'sourceContentId',
      'sourceFingerprint',
    ],
    identity: [
      'byteLength',
      'fastFingerprint',
      'fileName',
      'handleKey',
      'lastModified',
      'mediaType',
      'relativePath',
      'signature',
    ],
    exports: [
      'at',
      'destination',
      'destination.kind',
      'destination.label',
      'engineVersions',
      'godot',
      'historyNodeId',
      'id',
      'output',
      'outputContentId',
      'problems',
      'recipe',
      'stateFingerprint',
      'status',
    ],
  },
  minimal: {
    provenance: [
      'audio',
      'byteLength',
      'importedAt',
      'mediaType',
      'originProjectId',
      'sourceContentId',
      'sourceFingerprint',
    ],
    identity: ['byteLength', 'fastFingerprint', 'lastModified', 'mediaType', 'signature'],
    exports: [
      'at',
      'destination',
      'destination.kind',
      'engineVersions',
      'historyNodeId',
      'id',
      'output',
      'outputContentId',
      'problems',
      'recipe',
      'stateFingerprint',
      'status',
    ],
  },
  none: {
    provenance: [],
    identity: ['byteLength', 'fastFingerprint', 'lastModified', 'mediaType', 'signature'],
    exports: [],
  },
} as const;

/** An export record with every member it may hold. */
const EVERY_MEMBER: ExportRecord = {
  id: unsafeBrandId<'ExportRecordId'>('e0e0e0e0-00000001'),
  at: 1_790_000_000_000,
  stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'1'.repeat(64)}`)),
  historyNodeId: 'a1a1a1a1-00000002',
  recipe: { id: 'footsteps', version: 3 },
  engineVersions: new Map([['renderer', '1.2.0']]),
  output: { container: 'ogg', settings: new Map([['quality', 0.6]]) },
  destination: { kind: ExportDestinationKind.GodotProject, label: 'My secret game' },
  outputContentId: contentIdOfDigit('9'),
  godot: { projectLabel: 'My secret game', resources: ['res://audio/step.ogg'] },
  status: ExportStatus.Partial,
  problems: ['Could not write res://audio/step_2.ogg'],
};

function json(file: WrittenFile): JsonObject {
  if (file.body.kind !== 'text') throw new Error(`${file.path} is not text.`);
  const value = expectSuccess(
    parseJson(expectSuccess(decodeUtf8(file.body.bytes)), {
      maximumLength: 2 ** 20,
      maximumDepth: 16,
    }),
  );
  if (!isJsonObject(value)) throw new Error(`${file.path} holds no object.`);
  return value;
}

/** Every member of the objects, and of those nested one deep under `nested`, by name. */
function members(objects: readonly JsonValue[], nested: readonly string[] = []): string[] {
  const named = new Set<string>();
  for (const object of objects) {
    if (!isJsonObject(object)) continue;
    for (const [key, value] of Object.entries(object)) {
      named.add(key);
      if (nested.includes(key) && isJsonObject(value)) {
        for (const inner of Object.keys(value)) named.add(`${key}.${inner}`);
      }
    }
  }
  return [...named].sort();
}

/** The members a tree of the state alone at `provenance` keeps, by part. */
async function keptAt(provenance: ProvenanceLevel) {
  const full = await historyContent(referenceState(sampleProject()), 9, nodeDigest);
  const content: ProjectTreeContent = {
    ...full,
    scope: { kind: 'state', provenance },
    exports: [EVERY_MEMBER],
  };
  const files = expectSuccess(await writtenFiles(projectTree(content)));
  const sources = files.filter(({ path }) => path.endsWith('.source.json')).map(json);
  const identities = sources.flatMap((source) => {
    const media: JsonValue = source['media'] ?? null;
    return isJsonObject(media) && media['kind'] === 'external' ? [media['identity'] ?? null] : [];
  });
  const exports = files.filter(({ path }) => path.startsWith('exports/')).map(json);
  return {
    provenance: members(sources.map((source) => source['provenance'] ?? null)),
    identity: members(identities),
    exports: members(exports, ['destination']),
    sources,
  };
}

describe('the provenance a tree of the state alone keeps', () => {
  it.each([ProvenanceLevel.Full, ProvenanceLevel.Minimal, ProvenanceLevel.None])(
    'keeps exactly what %s keeps',
    async (level) => {
      const kept = await keptAt(level);

      expect(kept.sources.length).toBeGreaterThan(1);
      expect(kept.provenance).toEqual(KEPT[level].provenance);
      expect(kept.identity).toEqual(KEPT[level].identity);
      expect(kept.exports).toEqual(KEPT[level].exports);
    },
  );
});
