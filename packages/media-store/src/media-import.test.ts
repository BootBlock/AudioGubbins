import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  contentIdOf,
  readProjectDocument,
  writeProjectDocument,
  type AssetSource,
  type ByteSource,
  type ProjectState,
} from '@audiogubbins/project-format';
import { withSources } from '@audiogubbins/project-format/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import type { ExternalFile } from './external-file.js';
import { importMedia, type ImportChoice, type ImportRequest } from './media-import.js';
import { MediaObjectStore } from './object-store.js';
import { sampleSource } from './source-sampling.js';
import {
  MemoryStorageTree,
  countedSharing,
  countingTokens,
  generatedBytes,
  generatedSource,
} from './testing/index.js';
import { nodeDigest } from './testing/node-digest.js';

const SIZE = 250_000;

function servicesOver(tree = new MemoryStorageTree()) {
  const store = new MediaObjectStore({
    tree,
    root: 'media',
    digest: nodeDigest,
    nextToken: countingTokens(),
    sharing: countedSharing(),
  });
  return {
    tree,
    store,
    services: { store, digest: nodeDigest, yieldToHost: () => Promise.resolve() },
  };
}

function requestFor(choice: ImportChoice, extra: Partial<ExternalFile> = {}): ImportRequest {
  const { project } = sampleProject();
  return {
    file: {
      source: generatedSource(SIZE, 7),
      fileName: 'Gravel footstep.wav',
      mediaType: '',
      lastModified: 1_780_000_000_000,
      handleKey: 'handle-0007',
      ...extra,
    },
    choice,
    projectId: project.id,
    importedAt: 1_790_000_000_000,
  };
}

/** The sample project with the imported source on every asset, read back as a document. */
function throughTheDocument(source: AssetSource): ProjectState {
  const state = withSources(sampleProject().project, () => source);
  return expectSuccess(readProjectDocument(writeProjectDocument(state)));
}

describe('importing by copy', () => {
  it('stores the bytes and records a managed source with its provenance', async () => {
    const { services, store } = servicesOver();
    const request = requestFor({ mode: 'copy' });

    const imported = expectSuccess(await importMedia(request, services));

    const { contentId } = expectSuccess(await contentIdOf(generatedSource(SIZE, 7), nodeDigest));
    expect(imported).toEqual({
      source: {
        media: {
          kind: 'managed',
          contentId,
          byteLength: SIZE,
          mediaType: 'application/octet-stream',
        },
        provenance: {
          originalFileName: 'Gravel footstep.wav',
          importedAt: 1_790_000_000_000,
          sourceContentId: contentId,
          byteLength: SIZE,
          mediaType: 'application/octet-stream',
          originProjectId: request.projectId,
        },
      },
      held: contentId,
    });
    expect(store.isHeld(contentId)).toBe(true);
    expect([...throughTheDocument(imported.source).sources.values()]).toContainEqual(
      imported.source,
    );
  });

  it('keeps identical bytes once, imported into two projects sharing the store', async () => {
    const { services, tree } = servicesOver();
    const other = sampleProject(99).project.id;

    const first = expectSuccess(await importMedia(requestFor({ mode: 'copy' }), services));
    const second = expectSuccess(
      await importMedia(
        { ...requestFor({ mode: 'copy' }, { fileName: 'Copy of footstep.wav' }), projectId: other },
        services,
      ),
    );

    expect(second.source.media).toEqual(first.source.media);
    expect(second.source.provenance?.originProjectId).toBe(other);
    expect(tree.paths()).toHaveLength(2);
  });
});

describe('importing by link', () => {
  it('records the whole identity with the prompting policy, and stores nothing', async () => {
    const { services, tree } = servicesOver();

    const imported = expectSuccess(
      await importMedia(requestFor({ mode: 'link', keepProtectedCopy: false }), services),
    );

    const sample = expectSuccess(await sampleSource(generatedSource(SIZE, 7), nodeDigest));
    const { contentId } = expectSuccess(await contentIdOf(generatedSource(SIZE, 7), nodeDigest));
    expect(imported).toEqual({
      source: {
        media: {
          kind: 'external',
          identity: {
            handleKey: 'handle-0007',
            fileName: 'Gravel footstep.wav',
            byteLength: SIZE,
            lastModified: 1_780_000_000_000,
            mediaType: 'application/octet-stream',
            signature: sample.signature,
            fastFingerprint: sample.fastFingerprint,
            contentId,
          },
          policy: 'prompt',
        },
        provenance: {
          originalFileName: 'Gravel footstep.wav',
          importedAt: 1_790_000_000_000,
          sourceFingerprint: sample.fastFingerprint,
          sourceContentId: contentId,
          byteLength: SIZE,
          mediaType: 'application/octet-stream',
          originProjectId: sampleProject().project.id,
        },
      },
    });
    expect(tree.paths()).toEqual([]);
    expect([...throughTheDocument(imported.source).sources.values()]).toContainEqual(
      imported.source,
    );
  });

  it('keeps a protected copy on request, which completes the identity', async () => {
    const { services, store } = servicesOver();

    const imported = expectSuccess(
      await importMedia(requestFor({ mode: 'link', keepProtectedCopy: true }), services),
    );

    const { contentId } = expectSuccess(await contentIdOf(generatedSource(SIZE, 7), nodeDigest));
    expect(imported.held).toBe(contentId);
    expect(imported.source.media).toMatchObject({
      kind: 'external',
      retainedCopy: contentId,
      identity: { contentId },
    });
    expect(imported.source.provenance).toMatchObject({ sourceContentId: contentId });
    expect(store.isHeld(contentId)).toBe(true);
    expect([...throughTheDocument(imported.source).sources.values()]).toContainEqual(
      imported.source,
    );
  });

  it('records the policy the person chose for what happens when the file changes', async () => {
    const { services } = servicesOver();

    const adopting = expectSuccess(
      await importMedia(
        requestFor({ mode: 'link', keepProtectedCopy: false, policy: 'adopt' }),
        services,
      ),
    );
    const freezing = expectSuccess(
      await importMedia(
        requestFor({ mode: 'link', keepProtectedCopy: true, policy: 'freeze' }),
        services,
      ),
    );

    expect(adopting.source.media).toMatchObject({ kind: 'external', policy: 'adopt' });
    expect(freezing.source.media).toMatchObject({ kind: 'external', policy: 'freeze' });
    expect([...throughTheDocument(freezing.source).sources.values()]).toContainEqual(
      freezing.source,
    );
  });

  it('refuses a file that changes while its copy is kept, and holds nothing', async () => {
    const { services, store } = servicesOver();
    let reads = 0;
    const changing: ByteSource = {
      size: SIZE,
      read: (offset, length) => {
        reads += 1;
        // Three reads sample the file and one stores it; then it is edited.
        return Promise.resolve(generatedBytes(offset, length, reads > 4 ? 8 : 7));
      },
    };

    const refused = await importMedia(
      requestFor({ mode: 'link', keepProtectedCopy: true }, { source: changing }),
      services,
    );

    expect(expectFailureCode(refused)).toBe('media.source-changed');
    const { contentId } = expectSuccess(await contentIdOf(generatedSource(SIZE, 7), nodeDigest));
    expect(store.isHeld(contentId)).toBe(false);
  });

  it('refuses a file whose signals cannot be recorded', async () => {
    const { services } = servicesOver();

    const refused = await importMedia(
      requestFor({ mode: 'link', keepProtectedCopy: false }, { relativePath: '../x.wav' }),
      services,
    );

    expect(expectFailureCode(refused)).toBe('media.relative-path-malformed');
  });
});

describe('any import', () => {
  it('keeps nothing when aborted', async () => {
    const { services, tree } = servicesOver();
    const controller = new AbortController();
    controller.abort(new Error('stopped'));

    await expect(
      importMedia(requestFor({ mode: 'copy' }), services, { signal: controller.signal }),
    ).rejects.toThrow('stopped');
    expect(tree.paths()).toEqual([]);
  });

  it('refuses a time that is not whole milliseconds as a programmer error', async () => {
    const { services } = servicesOver();

    await expect(
      importMedia({ ...requestFor({ mode: 'copy' }), importedAt: 1.5 }, services),
    ).rejects.toThrow(RangeError);
  });
});
