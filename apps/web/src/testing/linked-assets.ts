/**
 * Assets linked to files outside the storage, as a test makes them: the file
 * the person linked, as the page lends one to its storage worker, read through
 * the page, and the asset added to the project open in a window with its
 * identity recorded (REQ-STOR-104).
 */

import { expect } from 'vitest';

import { StandardLayouts, sampleCount, sampleRate, type AssetId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { memorySource, observeFile } from '@audiogubbins/media-store/testing';
import { addAssetInvocation } from '@audiogubbins/project-commands';
import {
  SourceChangePolicy,
  storageKeyOf,
  type ByteSource,
  type ContentId,
  type MediaSource,
} from '@audiogubbins/project-format';
import type { PageFile } from '@audiogubbins/storage-runtime';

import type { ProjectWindow } from './project-context.js';

/** A file the person linked, its handle kept under `key`, of 256 bytes of `fill`. */
export function linkedFile(name: string, key: string, fill = 1): PageFile {
  return {
    bytes: { kind: 'source', source: memorySource(new Uint8Array(256).fill(fill)) },
    fileName: name,
    mediaType: 'audio/wav',
    lastModified: 5,
    handleKey: key,
  };
}

/** The bytes of a linked file a test made, which the page reads for its worker. */
export function sourceOf(file: PageFile): ByteSource {
  if (file.bytes.kind !== 'source') throw new Error('The test made a file the page holds.');
  return file.bytes.source;
}

/**
 * Adds to the project open in `window` an asset named `name` linked to `file`
 * under `policy`, with `retainedCopy` where one was kept of its content.
 */
export async function addLinkedAsset(
  window: ProjectWindow,
  file: PageFile,
  options: {
    readonly name?: string;
    readonly policy?: SourceChangePolicy;
    readonly retainedCopy?: ContentId;
  } = {},
): Promise<AssetId> {
  const session = window.projects.project.session();
  if (session === undefined) throw new Error('No project is open to change.');
  const { bytes: _lent, ...described } = file;
  const observed = await observeFile(
    { ...described, source: sourceOf(file) },
    window.services.digest,
  );
  const identity = expectSuccess(observed);
  const asset = window.storage.ids.next<'AssetId'>();
  const media: MediaSource = {
    kind: 'external',
    identity:
      options.retainedCopy === undefined
        ? identity
        : { ...identity, contentId: options.retainedCopy },
    policy: options.policy ?? SourceChangePolicy.Prompt,
    ...(options.retainedCopy === undefined ? {} : { retainedCopy: options.retainedCopy }),
  };
  const added = await session.run(
    addAssetInvocation(
      {
        id: asset,
        displayName: options.name ?? 'Kick',
        origin: 'imported',
        sampleRate: expectSuccess(sampleRate(48_000)),
        channelLayout: StandardLayouts.mono,
        length: expectSuccess(sampleCount(4_800)),
        storageKey: storageKeyOf(asset, media),
      },
      { media },
    ),
  );
  expect(added).toMatchObject({ ok: true, value: { kind: 'applied' } });
  return asset;
}
