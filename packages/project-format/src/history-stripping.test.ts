import { describe, expect, it } from 'vitest';

import { createDeterministicIdGenerator, type AssetId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { canonicalJson } from './canonical-json.js';
import type { Digest } from './byte-ports.js';
import type { ChangeNodeRecord } from './history-record.js';
import { stripHistory, type HistoryProvenanceParts } from './history-stripping.js';
import type { ExternalMedia, ExternalSourceIdentity, ProjectState } from './project-state.js';
import { readProjectTree } from './project-tree-reading.js';
import { projectTree, type ProjectTreeContent } from './project-tree-writing.js';
import { writeExternalIdentity, writeMediaSource } from './project-writing.js';
import { ProvenanceLevel } from './provenance-stripping.js';
import { immediateTurns } from './testing/host-turns.js';
import { nodeDigest } from './testing/node-digest.js';
import { referenceState } from './testing/project-states.js';
import {
  historyContent,
  listingOf,
  writtenFiles,
  type WrittenFile,
} from './testing/project-trees.js';
import { TEST_INVOCATION_PROVENANCE, TREE_READING } from './testing/tree-reading.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';
import { Turns } from './work-turns.js';

/**
 * A whole history stripped to a level below full keeps no name, handle or path
 * of a file anywhere in its tree, stands one placeholder for each file in its
 * state and every change, names the stripped states its tree keeps, and is
 * read back, checked rather than stripped again, as the tree it was
 * (REQ-STOR-166, REQ-STOR-193). Learning the stripped states' fingerprints
 * holds one state at a time (REQ-EXEC-216).
 */

/** Every name, handle and path of a file the history below holds, and an export's words. */
const PRIVATE_TEXT = [
  'Gravel footstep.wav',
  'Forest ambience.flac',
  'Ambience/',
  'handle-0001',
  'handle-0002',
  'Moved/',
  'Sounds for the level',
  'One file was not written.',
  'A person',
];

const AFFECTS = {
  assets: [],
  tracks: [],
  buses: [],
  clips: [],
  regions: [],
  markers: [],
  effectChains: [],
  takeStacks: [],
  project: false,
};

/** The linked asset of a state, and its media. */
function linked(state: ProjectState): readonly [AssetId, ExternalMedia] {
  for (const [asset, { media }] of state.sources) {
    if (media.kind === 'external') return [asset, media];
  }
  throw new Error('The state has no linked asset.');
}

/**
 * A history for the reference state whose changes also relink its linked
 * file to a copy elsewhere, carrying the identity it is relinked to and,
 * to undo it, the media it had.
 */
async function namedHistory(): Promise<ProjectTreeContent> {
  const content = await historyContent(referenceState(sampleProject()), 7, nodeDigest);
  if (content.scope.kind !== 'history') throw new Error('The history was lost.');
  const [asset, media] = linked(content.state);
  const moved: ExternalSourceIdentity = {
    ...media.identity,
    handleKey: 'handle-0002',
    relativePath: 'Moved/Forest ambience.flac',
  };
  const { record } = content.scope.history;
  const relink: ChangeNodeRecord = {
    kind: 'change',
    id: createDeterministicIdGenerator(5_000).next<'HistoryNodeId'>(),
    parent: record.cursor,
    at: 1_790_000_000_500,
    description: 'Relink the forest',
    forward: [
      {
        commandId: 'test.relink',
        arguments: { assetId: asset, identity: canonicalJson(writeExternalIdentity(moved)) },
      },
    ],
    inverse: [
      {
        commandId: 'test.set-media',
        arguments: { assetId: asset, media: canonicalJson(writeMediaSource(media)) },
      },
    ],
    affects: { ...AFFECTS, assets: [asset] },
  };
  const history = {
    ...content.scope.history,
    record: { ...record, nodes: [...record.nodes, relink] },
  };
  return { ...content, scope: { ...content.scope, history } };
}

function partsOf(content: ProjectTreeContent): HistoryProvenanceParts {
  if (content.scope.kind !== 'history') throw new Error('The history was lost.');
  return { state: content.state, history: content.scope.history, exports: content.exports };
}

async function strippedTree(
  content: ProjectTreeContent,
  level: ProvenanceLevel,
  digest: Digest = nodeDigest,
): Promise<readonly WrittenFile[]> {
  const stripped = expectSuccess(
    await stripHistory(partsOf(content), level, {
      invocationProvenance: TEST_INVOCATION_PROVENANCE,
      digest,
      turns: new Turns(immediateTurns),
    }),
  );
  const tree = projectTree({
    ...content,
    state: stripped.state,
    scope: { kind: 'history', history: stripped.history, provenance: level },
    exports: stripped.exports,
  });
  return expectSuccess(await writtenFiles(tree));
}

function textOf(files: readonly WrittenFile[]): string {
  return files
    .flatMap(({ body }) => (body.kind === 'text' ? [expectSuccess(decodeUtf8(body.bytes))] : []))
    .join('\n');
}

/** A change as its file holds it, its arguments as text. */
interface StoredChange {
  readonly id: string;
  readonly forward: readonly [{ readonly arguments: Record<string, string> }];
  readonly inverse: readonly [{ readonly arguments: Record<string, string> }];
}

/** The text of a file of the tree. */
function textAt(files: readonly WrittenFile[], path: string): string {
  const body = files.find((file) => file.path === path)?.body;
  if (body?.kind !== 'text') throw new Error(`No text at ${path}.`);
  return expectSuccess(decodeUtf8(body.bytes));
}

/** The path of the relinking change of the history, as its tree holds it. */
function relinkPath(files: readonly WrittenFile[]): string {
  const node = files.find(
    ({ path, body }) =>
      path.startsWith('history/nodes/') &&
      body.kind === 'text' &&
      expectSuccess(decodeUtf8(body.bytes)).includes('test.relink'),
  );
  if (node === undefined) throw new Error('The relink was lost.');
  return node.path;
}

/** An argument's text, which must be there. */
function argumentText(text: string | undefined): string {
  if (text === undefined) throw new Error('The argument is missing.');
  return text;
}

describe('a whole history stripped to a level (REQ-STOR-166)', () => {
  it('keeps every name, handle and path at full, so the scans below can find them', async () => {
    const text = textOf(await strippedTree(await namedHistory(), ProvenanceLevel.Full));
    for (const each of PRIVATE_TEXT) expect(text).toContain(each);
  });

  it.each([ProvenanceLevel.Minimal, ProvenanceLevel.None])(
    'leaves no name, handle or path of a file in any file of its tree at %s',
    async (level) => {
      const text = textOf(await strippedTree(await namedHistory(), level));
      for (const each of PRIVATE_TEXT) expect(text).not.toContain(each);
    },
  );

  it('stands one placeholder for each file, in the state and in every change', async () => {
    const content = await namedHistory();
    const files = await strippedTree(content, ProvenanceLevel.Minimal);
    const [asset] = linked(content.state);
    const source: { media: ExternalMedia } = JSON.parse(
      textAt(files, `project/assets/${asset}.source.json`),
    );
    const kept = source.media.identity;
    const node: StoredChange = JSON.parse(textAt(files, relinkPath(files)));
    const relinked: ExternalSourceIdentity = JSON.parse(
      argumentText(node.forward[0].arguments['identity']),
    );
    const inverse: ExternalMedia = JSON.parse(argumentText(node.inverse[0].arguments['media']));
    const undone = inverse.identity;

    expect(kept.handleKey).toMatch(/^handle-[1-9]/u);
    expect(undone).toEqual(kept);
    // The copy elsewhere is the same file by name, and another by handle and path.
    expect(relinked.fileName).toBe(kept.fileName);
    expect(relinked.handleKey).not.toBe(kept.handleKey);
    expect(relinked.relativePath).not.toBe(kept.relativePath);
  });

  it.each([ProvenanceLevel.Minimal, ProvenanceLevel.None])(
    'is read back at %s as the tree it was, its nodes and snapshots naming the states it keeps',
    async (level) => {
      const files = await strippedTree(await namedHistory(), level);
      const read = expectSuccess(await readProjectTree(listingOf(files), TREE_READING));
      if (read.scope.kind !== 'history') throw new Error('The history was lost.');
      const { record, states } = read.scope.history;
      const named = [
        ...record.nodes.flatMap((node) => node.stateFingerprint ?? []),
        ...record.snapshots.map((snapshot) => snapshot.stateFingerprint),
      ];

      expect(named.length).toBeGreaterThan(0);
      for (const fingerprint of named) {
        expect(states.fingerprints).toContain(fingerprint);
        expectSuccess(await states.load(fingerprint));
      }
      expect(read.scope.provenance).toBe(level);
      expect(expectSuccess(await writtenFiles(projectTree(read)))).toEqual(files);
    },
  );

  it('refuses a stripped tree where a change keeps a handle it should not', async () => {
    const files = await strippedTree(await namedHistory(), ProvenanceLevel.Minimal);
    const path = relinkPath(files);
    const node: StoredChange = JSON.parse(textAt(files, path));
    const identity: ExternalSourceIdentity = JSON.parse(
      argumentText(node.forward[0].arguments['identity']),
    );
    const kept = { ...identity, handleKey: 'handle-0002' };
    const changed = {
      ...node,
      forward: [
        {
          ...node.forward[0],
          arguments: { ...node.forward[0].arguments, identity: JSON.stringify(kept) },
        },
      ],
    };
    const edited = files.map((file) =>
      file.path === path
        ? { path, body: { kind: 'text', bytes: encodeUtf8(JSON.stringify(changed)) } as const }
        : file,
    );

    const read = await readProjectTree(listingOf(edited), TREE_READING);

    expect(
      read.ok ? [] : read.failures.map(({ code, details }) => [code, details?.['file']]),
    ).toEqual([['tree.provenance-kept', path]]);
  });

  it('refuses a stripped tree where a snapshot keeps the name of the person who made it', async () => {
    const files = await strippedTree(await namedHistory(), ProvenanceLevel.Minimal);
    const snapshot = files.find(({ path }) => path.startsWith('history/snapshots/'));
    if (snapshot === undefined) throw new Error('The history keeps no snapshot.');
    const kept = { ...JSON.parse(textAt(files, snapshot.path)), author: 'A person' };
    const edited = files.map((file) =>
      file.path === snapshot.path
        ? {
            path: file.path,
            body: { kind: 'text', bytes: encodeUtf8(JSON.stringify(kept)) } as const,
          }
        : file,
    );

    const read = await readProjectTree(listingOf(edited), TREE_READING);

    expect(
      read.ok ? [] : read.failures.map(({ code, details }) => [code, details?.['file']]),
    ).toEqual([['tree.provenance-kept', snapshot.path]]);
  });

  it('learns the stripped states’ fingerprints holding one state at a time', async () => {
    const content = await namedHistory();
    const { history } = partsOf(content);
    let held = 0;
    let peak = 0;
    let loads = 0;
    const counted = {
      ...history,
      states: {
        fingerprints: history.states.fingerprints,
        load: async (...args: Parameters<typeof history.states.load>) => {
          loads += 1;
          held += 1;
          peak = Math.max(peak, held);
          return await history.states.load(...args);
        },
      },
    };
    // A state is let go once it is fingerprinted, which hashes it.
    const digest: Digest = async (bytes) => {
      held = 0;
      return await nodeDigest(bytes);
    };

    expectSuccess(
      await stripHistory({ ...partsOf(content), history: counted }, ProvenanceLevel.Minimal, {
        invocationProvenance: TEST_INVOCATION_PROVENANCE,
        digest,
        turns: new Turns(immediateTurns),
      }),
    );

    expect(loads).toBe(history.states.fingerprints.length);
    expect(peak).toBe(1);
  });
});
