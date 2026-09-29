import { describe, expect, it } from 'vitest';

import { emptyProject, sampleProject } from '@audiogubbins/test-fixtures';

import {
  DEFAULT_SOURCE_CHANGE_POLICY,
  SourceChangePolicy,
  emptyProjectState,
  storageKeyOf,
} from './project-state.js';
import { contentIdOfDigit } from './testing/project-states.js';

describe('storageKeyOf', () => {
  const assetId = sampleProject().assets.footstep.id;

  it('keys managed media by content, so assets with the same bytes share a key', () => {
    const media = {
      kind: 'managed',
      contentId: contentIdOfDigit('d'),
      byteLength: 4,
      mediaType: 'audio/wav',
    } as const;
    expect(storageKeyOf(assetId, media)).toBe(`content:c1-${'d'.repeat(64)}`);
    expect(storageKeyOf(sampleProject().assets.ambience.id, media)).toBe(
      storageKeyOf(assetId, media),
    );
  });

  it('keys external media by the asset, whose bytes the store cannot share', () => {
    const media = {
      kind: 'external',
      identity: {
        byteLength: 4,
        lastModified: 0,
        mediaType: 'audio/wav',
        signature: '52494646',
        fastFingerprint: 'e'.repeat(64),
      },
      policy: SourceChangePolicy.Prompt,
    } as const;
    expect(storageKeyOf(assetId, media)).toBe(`external:${assetId}`);
  });
});

describe('source change policy', () => {
  it('asks by default, since silent adoption must not be the default', () => {
    expect(DEFAULT_SOURCE_CHANGE_POLICY).toBe('prompt');
    expect(Object.values(SourceChangePolicy)).toEqual(['prompt', 'adopt', 'freeze']);
  });
});

describe('emptyProjectState', () => {
  it('holds the project and no sources', () => {
    const project = emptyProject();
    expect(emptyProjectState(project)).toEqual({ project, sources: new Map() });
  });

  it('throws for a project that has assets, which would have no source', () => {
    expect(() => emptyProjectState(sampleProject().project)).toThrow('no assets');
  });
});
