import { describe, expect, it } from 'vitest';

import { encodeUtf8 } from '@audiogubbins/project-format';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { CheckedRecords } from './checked-records.js';
import { newestHead, type ProjectHead } from './project-heads.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectSession } from './project-session.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';
import { epochOfSegment, segmentName } from './storage-layout.js';

/**
 * A history's nodes are written once, in segments of their own, so what each
 * checkpoint writes grows with what changed since the last, never with the
 * whole history (F-14).
 */

/** No checkpoint but those a test asks for. */
const ON_REQUEST = { checkpointAfter: 1_000_000, keepStateEvery: 64 };

async function changedUntil(session: ProjectSession, nodes: number): Promise<void> {
  while (session.getSnapshot().model.history.nodes.size < nodes) {
    const size = session.getSnapshot().model.history.nodes.size;
    expectSuccess(await session.run(setName(`Name ${String(size)}`)));
  }
}

async function headOf(files: ProjectFiles): Promise<ProjectHead> {
  const head = await newestHead(files.records, files.paths);
  if (head === undefined) throw new Error('A checkpoint names a head.');
  return head;
}

async function opened(nodes: number) {
  const test = harness();
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), header.id);
  const session = await openToWrite(test, tree, header.id, { cadence: ON_REQUEST });
  await changedUntil(session, nodes);
  expectSuccess(await session.checkpoint());
  return { tree, files, session };
}

describe('a checkpoint of a growing history', () => {
  it('stays the same size however many changes the history holds', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), header.id);
    const session = await openToWrite(test, tree, header.id, { cadence: ON_REQUEST });

    const sizes: number[] = [];
    for (const nodes of [40, 400]) {
      await changedUntil(session, nodes);
      expectSuccess(await session.checkpoint());
      const head = await newestHead(files.records, files.paths);
      if (head === undefined) throw new Error('A checkpoint names a head.');
      const file = await tree.openFile(files.paths.checkpoint(head.epoch, head.checkpoint));
      sizes.push(file?.size ?? 0);
    }
    const [few = 0, many = 0] = sizes;
    expect(few).toBeGreaterThan(0);
    // Six more states are kept whole along the way, each named once.
    expect(many).toBeLessThan(few + 1_000);
  });
});

describe('the segments a checkpoint names', () => {
  it('make a checkpoint whose segment is missing invalid, not a shorter history', async () => {
    const { tree, files } = await opened(20);
    const [segment] = await tree.list(files.paths.segments);
    if (segment === undefined) throw new Error('A checkpoint writes a segment.');
    await tree.remove(`${files.paths.segments}/${segment.name}`);
    const head = await headOf(files);
    const read = await files.readCheckpoint(head.epoch, head.checkpoint);
    if (read.kind !== 'invalid' || read.fault.kind !== 'malformed') {
      throw new Error('A checkpoint missing a segment is malformed.');
    }
    expect(read.fault.failures.map((failure) => failure.code)).toEqual([
      'checkpoint.segment-missing',
    ]);
  });

  it('are all that is left once a checkpoint is confirmed, save a later window’s', async () => {
    const { tree, files, session } = await opened(20);
    const head = await headOf(files);
    // A segment a later window wrote, which this one must never remove.
    const later = `${files.paths.segments}/${String(head.epoch + 1).padStart(12, '0')}-0000aaaa.json`;
    await tree.writeFile(later, encodeUtf8('{}'));
    const stale = `${files.paths.segments}/${String(head.epoch).padStart(12, '0')}-0000bbbb.json`;
    await tree.writeFile(stale, encodeUtf8('{}'));

    await changedUntil(session, 30);
    expectSuccess(await session.checkpoint());
    const current = await headOf(files);
    const read = await files.readCheckpoint(current.epoch, current.checkpoint);
    if (read.kind !== 'valid') throw new Error('The checkpoint reads back.');
    const listed = (await tree.list(files.paths.segments)).map((entry) => entry.name);
    const named = read.value.segments.named.map((segment) => segmentName(segment.reference));
    expect(listed.filter((name) => epochOfSegment(name) === current.epoch).sort()).toEqual(
      [...named].sort(),
    );
    expect(listed).toContain(later.slice(later.lastIndexOf('/') + 1));
    expect(listed).not.toContain(stale.slice(stale.lastIndexOf('/') + 1));
  });
});
