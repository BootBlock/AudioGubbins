import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { contentIdOfDigit, referenceState } from './testing/project-states.js';
import { randomState } from './testing/random-states.js';
import { ExportDestinationKind, ExportStatus, type ExportRecord } from './export-provenance.js';
import {
  readProjectDocument,
  serialiseProjectDocument,
  writeProjectDocument,
} from './project-json.js';
import {
  ProvenanceLevel,
  stripAssetProvenance,
  stripExportRecords,
} from './provenance-stripping.js';
import type { ProjectState } from './project-state.js';
import { stateFingerprintFrom } from './content-identity.js';
import { unsafeBrandId } from '@audiogubbins/domain';

const REFERENCE = referenceState(sampleProject());

/** The state as a document reads it back, which must succeed. */
function roundTrip(state: ProjectState): ProjectState {
  return expectSuccess(readProjectDocument(writeProjectDocument(state)));
}

/** Every name, path and handle the state's text holds for a file. */
const PRIVATE_TEXT = ['Gravel footstep.wav', 'Forest ambience.flac', 'Ambience/', 'handle-0001'];

describe('stripAssetProvenance', () => {
  it('keeps everything at full', () => {
    expect(stripAssetProvenance(REFERENCE, ProvenanceLevel.Full)).toBe(REFERENCE);
  });

  it.each([ProvenanceLevel.Minimal, ProvenanceLevel.None])(
    'gives a state the document reader accepts at %s, for every random state',
    (level) => {
      for (let seed = 1; seed <= 100; seed += 1) {
        const stripped = stripAssetProvenance(randomState(seed), level);
        expect(roundTrip(stripped)).toEqual(stripped);
      }
    },
  );

  it.each([ProvenanceLevel.Minimal, ProvenanceLevel.None])(
    'leaves no file name, path or handle in the written project at %s',
    (level) => {
      const before = serialiseProjectDocument(REFERENCE);
      for (const text of PRIVATE_TEXT) expect(before).toContain(text);

      const after = serialiseProjectDocument(stripAssetProvenance(REFERENCE, level));
      for (const text of PRIVATE_TEXT) expect(after).not.toContain(text);
    },
  );

  it('keeps content identity, time and origin at minimal, and drops the file name', () => {
    const stripped = stripAssetProvenance(REFERENCE, ProvenanceLevel.Minimal);
    for (const [assetId, source] of REFERENCE.sources) {
      const { originalFileName: _dropped, ...kept } = source.provenance ?? { importedAt: 0 };
      expect(stripped.sources.get(assetId)?.provenance).toEqual(kept);
    }
  });

  it('drops provenance whole at none', () => {
    const stripped = stripAssetProvenance(REFERENCE, ProvenanceLevel.None);
    for (const source of stripped.sources.values()) expect(source.provenance).toBeUndefined();
  });

  it('keeps what recognises an external file again at every level', () => {
    for (const level of [ProvenanceLevel.Minimal, ProvenanceLevel.None]) {
      for (const [assetId, source] of stripAssetProvenance(REFERENCE, level).sources) {
        const original = REFERENCE.sources.get(assetId)?.media;
        if (source.media.kind !== 'external' || original?.kind !== 'external') continue;
        const { handleKey: _h, fileName: _f, relativePath: _r, ...identity } = original.identity;
        expect(source.media).toEqual({ ...original, identity });
      }
    }
  });

  it('changes neither the project nor managed media', () => {
    const stripped = stripAssetProvenance(REFERENCE, ProvenanceLevel.None);
    expect(stripped.project).toBe(REFERENCE.project);
    for (const [assetId, source] of stripped.sources) {
      if (source.media.kind === 'managed')
        expect(source.media).toBe(REFERENCE.sources.get(assetId)?.media);
    }
  });
});

describe('stripExportRecords', () => {
  const record: ExportRecord = {
    id: unsafeBrandId<'ExportRecordId'>('e0e0e0e0-00000001'),
    at: 1_790_000_000_000,
    stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'1'.repeat(64)}`)),
    historyNodeId: 'a1a1a1a1-00000002',
    recipe: { id: 'footsteps', version: 3 },
    engineVersions: new Map([['renderer', '1.2.0']]),
    output: {
      container: 'ogg',
      settings: new Map<string, string | number | boolean>([['quality', 0.6]]),
    },
    destination: { kind: ExportDestinationKind.GodotProject, label: 'My secret game' },
    outputContentId: contentIdOfDigit('9'),
    godot: { projectLabel: 'My secret game', resources: ['res://audio/step.ogg'] },
    status: ExportStatus.Partial,
    problems: ['Could not write res://audio/step_2.ogg'],
  };

  it('keeps everything at full', () => {
    expect(stripExportRecords([record], ProvenanceLevel.Full)).toEqual([record]);
  });

  it('keeps what was exported and how at minimal, and drops labels, Godot linkage and problems', () => {
    const { godot: _godot, ...kept } = record;
    expect(stripExportRecords([record], ProvenanceLevel.Minimal)).toEqual([
      { ...kept, destination: { kind: ExportDestinationKind.GodotProject }, problems: [] },
    ]);
  });

  it('keeps no record at none', () => {
    expect(stripExportRecords([record], ProvenanceLevel.None)).toEqual([]);
  });
});
