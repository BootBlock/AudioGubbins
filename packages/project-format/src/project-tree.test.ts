import { describe, expect, it } from 'vitest';

import type { DomainResult } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { readProjectTree } from './project-tree-reading.js';
import { projectTree, type ProjectTreeFile } from './project-tree-writing.js';
import { nodeDigest } from './testing/node-digest.js';
import { referenceState } from './testing/project-states.js';
import { historyContent, listingOf } from './testing/project-trees.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

/**
 * Reading an unpacked tree refuses anything that is not a whole, valid project
 * of this build's schema (REQ-STOR-052, REQ-STOR-103, REQ-EXEC-136.12), and
 * reports every problem at the file it is in.
 */

async function sampleTree(): Promise<ProjectTreeFile[]> {
  return [
    ...expectSuccess(
      projectTree(await historyContent(referenceState(sampleProject()), 4, nodeDigest)),
    ),
  ];
}

type Json = Record<string, unknown>;

/** The files with the JSON of one changed by `edit`. */
function edited(
  files: readonly ProjectTreeFile[],
  path: string,
  edit: (value: Json) => unknown,
): ProjectTreeFile[] {
  return files.map((file) => {
    if (file.path !== path || file.body.kind !== 'text') return file;
    const value: Json = JSON.parse(expectSuccess(decodeUtf8(file.body.bytes)));
    return { path, body: { kind: 'text', bytes: encodeUtf8(JSON.stringify(edit(value))) } };
  });
}

function jsonOf(files: readonly ProjectTreeFile[], path: string): Json {
  const body = files.find((file) => file.path === path)?.body;
  if (body?.kind !== 'text') throw new Error(`No text at ${path}.`);
  const value: Json = JSON.parse(expectSuccess(decodeUtf8(body.bytes)));
  return value;
}

function renamedFile(files: readonly ProjectTreeFile[], from: string, to: string) {
  return files.map((file) => (file.path === from ? { ...file, path: to } : file));
}

function pathOf(files: readonly ProjectTreeFile[], prefix: string): string {
  const found = files.find(({ path }) => path.startsWith(prefix))?.path;
  if (found === undefined) throw new Error(`No file under ${prefix}.`);
  return found;
}

async function problemsOf(files: readonly ProjectTreeFile[]) {
  const read: DomainResult<unknown> = await readProjectTree(listingOf(files), nodeDigest);
  if (read.ok) throw new Error('The tree was read.');
  return read.failures.map(({ code, details }) => [code, details?.['file']]);
}

describe('reading a project tree (REQ-STOR-103)', () => {
  it('refuses a tree without its header', async () => {
    const files = (await sampleTree()).filter(({ path }) => path !== 'audiogubbins-project.json');
    expect(await problemsOf(files)).toEqual([['tree.missing-file', 'audiogubbins-project.json']]);
  });

  it('refuses a tree of another bundle schema, naming the version found', async () => {
    const files = edited(await sampleTree(), 'audiogubbins-project.json', (header) => ({
      ...header,
      schemaVersion: SCHEMA_VERSIONS.portableBundle + 1,
    }));
    const read = await readProjectTree(listingOf(files), nodeDigest);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.failures[0].code).toBe('format.schema-incompatible');
    expect(read.failures[0].details).toMatchObject({
      schema: 'portableBundle',
      found: SCHEMA_VERSIONS.portableBundle + 1,
    });
  });

  it('refuses a tree whose project files are of another schema', async () => {
    const files = edited(await sampleTree(), 'audiogubbins-project.json', (header) => ({
      ...header,
      projectDocumentSchemaVersion: SCHEMA_VERSIONS.projectDocument + 3,
    }));
    const read = await readProjectTree(listingOf(files), nodeDigest);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.failures[0].details).toMatchObject({
      schema: 'projectDocument',
      found: SCHEMA_VERSIONS.projectDocument + 3,
    });
  });

  it('refuses a history kept at less than full provenance', async () => {
    const files = edited(await sampleTree(), 'audiogubbins-project.json', (header) => ({
      ...header,
      provenance: 'minimal',
    }));
    expect((await problemsOf(files)).map(([code]) => code)).toContain(
      'tree.history-without-provenance',
    );
  });

  it('refuses a file no tree has, and reports every problem at its file', async () => {
    const files = await sampleTree();
    const track = pathOf(files, 'project/tracks/');
    const broken = [
      ...edited(files, track, (value) => ({ ...value, gain: 'loud' })),
      { path: 'project/notes.json', body: { kind: 'text', bytes: encodeUtf8('{}') } } as const,
    ];
    const problems = await problemsOf(broken);
    expect(problems).toContainEqual(['tree.unknown-file', 'project/notes.json']);
    expect(problems).toContainEqual(['schema.not-a-number', track]);
  });

  it('refuses an entity whose file names another', async () => {
    const files = await sampleTree();
    const track = pathOf(files, 'project/tracks/');
    const elsewhere = 'project/tracks/0123abcd-0123abcd-0123abcd-0123abcd.json';
    expect(await problemsOf(renamedFile(files, track, elsewhere))).toContainEqual([
      'tree.misnamed-file',
      elsewhere,
    ]);
  });

  it('refuses a kept state that is not the state its name promises', async () => {
    const files = await sampleTree();
    const state = pathOf(files, 'history/states/');
    const changed = edited(files, state, (value) => ({
      ...value,
      project: { ...(value['project'] as Json), displayName: 'Altered' },
    }));
    expect(await problemsOf(changed)).toContainEqual(['tree.state-mismatch', state]);
  });

  it('refuses a snapshot whose state the tree lacks', async () => {
    const files = await sampleTree();
    const snapshot = pathOf(files, 'history/snapshots/');
    const value = jsonOf(files, snapshot);
    const without = files.filter(
      ({ path }) => path !== `history/states/${String(value['stateFingerprint'])}.json`,
    );
    expect(await problemsOf(without)).toContainEqual(['tree.snapshot-state-missing', snapshot]);
  });

  it('refuses a history whose cursor names another state than the project’s', async () => {
    const files = edited(await sampleTree(), 'project/settings.json', (settings) => ({
      ...settings,
      sampleRate: 96_000,
    }));
    expect(await problemsOf(files)).toContainEqual([
      'tree.cursor-state-mismatch',
      'history/cursor.json',
    ]);
  });

  it('refuses history and caches the header says the tree does not hold', async () => {
    const files = edited(await sampleTree(), 'audiogubbins-project.json', (header) => ({
      ...header,
      includes: { history: false, caches: false },
    }));
    const problems = await problemsOf(files);
    expect(problems).toContainEqual(['tree.unexpected-file', 'history/cursor.json']);
    expect(problems.map(([, file]) => file)).toContain(pathOf(files, 'caches/'));
  });

  it('carries the backup policy and the open comparison, and refuses a tree without the policy', async () => {
    const files = await sampleTree();
    expect(jsonOf(files, 'project/backup-policy.json')).toMatchObject({ kind: 'automatic' });
    expect(jsonOf(files, 'history/comparison.json')).toMatchObject({ listening: 'b' });
    const without = files.filter(({ path }) => path !== 'project/backup-policy.json');
    expect(await problemsOf(without)).toContainEqual([
      'tree.missing-file',
      'project/backup-policy.json',
    ]);
  });

  it('refuses a comparison whose side the history does not hold', async () => {
    const files = edited(await sampleTree(), 'history/comparison.json', (choice) => ({
      ...choice,
      a: { kind: 'snapshot', snapshot: '0000000a-0000-4000-8000-000000000000' },
    }));
    expect(await problemsOf(files)).toContainEqual([
      'tree.comparison-unknown',
      'history/comparison.json',
    ]);
  });

  it('never reads a media file or a cache, which are the caller’s to stream', async () => {
    const files = await sampleTree();
    const read: string[] = [];
    expectSuccess(
      await readProjectTree(
        listingOf(files, (path) => read.push(path)),
        nodeDigest,
      ),
    );
    expect(read.filter((path) => path.startsWith('media/') || path.startsWith('caches/'))).toEqual(
      [],
    );
  });
});
