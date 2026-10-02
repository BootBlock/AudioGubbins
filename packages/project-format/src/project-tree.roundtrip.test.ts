import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { DEFAULT_BACKUP_POLICY } from './backup-policy-json.js';
import { canonicalJson } from './canonical-json.js';
import { writeExportRecord } from './export-record-json.js';
import { writeHistoryRecord } from './history-json.js';
import { writeProjectDocument } from './project-json.js';
import type { StateFingerprint } from './content-identity.js';
import type { ProjectState } from './project-state.js';
import { readProjectTree } from './project-tree-reading.js';
import { projectTree, type ProjectTreeContent } from './project-tree-writing.js';
import { ProvenanceLevel, stripAssetProvenance } from './provenance-stripping.js';
import { nodeDigest } from './testing/node-digest.js';
import { referenceState } from './testing/project-states.js';
import {
  everyState,
  historyContent,
  listingOf,
  writtenFiles,
  type WrittenFile,
} from './testing/project-trees.js';
import { randomState } from './testing/random-states.js';
import { decodeUtf8 } from './utf8.js';

/**
 * The unpacked tree round-trips (REQ-STOR-103): a project written as a tree and
 * read back is the same project, and the tree written from what was read is the
 * same files, byte for byte, so converting between the tree and anything
 * holding it loses nothing and churns nothing.
 */

const SEEDS = Array.from({ length: 30 }, (_, index) => index + 1);

/** Each file's path and, for text, its text; for media and caches, what it names. */
function filesText(files: readonly WrittenFile[]): readonly string[] {
  return files.map(({ path, body }) =>
    body.kind === 'text'
      ? `${path}\n${expectSuccess(decodeUtf8(body.bytes))}`
      : `${path} ${JSON.stringify(body)}`,
  );
}

/** A comparable form of what a tree holds. */
async function contentText(content: ProjectTreeContent): Promise<string> {
  const { scope } = content;
  const states =
    scope.kind === 'history'
      ? await everyState(scope.history.states)
      : new Map<StateFingerprint, ProjectState>();
  return JSON.stringify({
    state: canonicalJson(writeProjectDocument(content.state)),
    history:
      scope.kind === 'history'
        ? {
            record: canonicalJson(writeHistoryRecord(scope.history.record)),
            retention: scope.history.retention,
            states: [...states]
              .map(
                ([fingerprint, state]) =>
                  `${fingerprint} ${canonicalJson(writeProjectDocument(state))}`,
              )
              .sort(),
          }
        : scope.provenance,
    exports: content.exports.map((record) => canonicalJson(writeExportRecord(record))),
    media: content.media,
    caches: content.caches ?? null,
  });
}

async function roundTrip(content: ProjectTreeContent) {
  const files = expectSuccess(await writtenFiles(projectTree(content)));
  const read = expectSuccess(await readProjectTree(listingOf(files), nodeDigest));
  return { files, read, again: expectSuccess(await writtenFiles(projectTree(read))) };
}

function sample(seed: number): ProjectState {
  return seed % 3 === 0 ? referenceState(sampleProject(seed)) : randomState(seed);
}

describe('the unpacked tree round-trips (REQ-STOR-103)', () => {
  it.each(SEEDS)('keeps a whole history, seed %i', async (seed) => {
    const content = await historyContent(sample(seed), seed, nodeDigest);
    const { files, read, again } = await roundTrip(content);

    expect(filesText(again)).toEqual(filesText(files));
    // The export log comes back oldest first, which is the order it grows in.
    const oldestFirst = { ...content, exports: [...content.exports].reverse() };
    expect(await contentText(read)).toBe(await contentText(oldestFirst));
  });

  it.each([ProvenanceLevel.Full, ProvenanceLevel.Minimal, ProvenanceLevel.None])(
    'keeps the state alone at %s provenance',
    async (provenance) => {
      const state = referenceState(sampleProject());
      const full = await historyContent(state, 7, nodeDigest);
      const content: ProjectTreeContent = { ...full, scope: { kind: 'state', provenance } };
      const { files, read, again } = await roundTrip(content);

      expect(filesText(again)).toEqual(filesText(files));
      expect(canonicalJson(writeProjectDocument(read.state))).toBe(
        canonicalJson(writeProjectDocument(stripAssetProvenance(state, provenance))),
      );
      expect(read.exports).toHaveLength(provenance === ProvenanceLevel.None ? 0 : 2);
      expect(files.some(({ path }) => path.startsWith('history/'))).toBe(false);
    },
  );

  it('writes one file per entity, the header first, and media by reference', async () => {
    const content = await historyContent(referenceState(sampleProject()), 3, nodeDigest);
    const paths = projectTree(content).map(({ path }) => path);

    expect(paths[0]).toBe('audiogubbins-project.json');
    expect(paths).toContain('project/settings.json');
    expect(paths).toContain('project/track-order.json');
    for (const asset of content.state.project.assets.keys()) {
      expect(paths).toContain(`project/assets/${asset}.json`);
      expect(paths).toContain(`project/assets/${asset}.source.json`);
    }
    for (const track of content.state.project.tracks.keys()) {
      expect(paths).toContain(`project/tracks/${track}.json`);
    }
    expect(paths.filter((path) => path.startsWith('media/'))).toHaveLength(2);
    expect(paths).toEqual([...paths].sort());
  });

  it('changes only the files of the entity a change touches', async () => {
    const state = referenceState(sampleProject());
    const [track] = state.project.tracks.values();
    if (track === undefined) throw new Error('The sample has no track.');
    const changed: ProjectState = {
      ...state,
      project: {
        ...state.project,
        tracks: new Map(state.project.tracks).set(track.id, { ...track, muted: !track.muted }),
      },
    };
    const treeOf = async (of: ProjectState) =>
      filesText(
        expectSuccess(
          await writtenFiles(
            projectTree({
              state: of,
              scope: { kind: 'state', provenance: ProvenanceLevel.Full },
              exports: [],
              backup: DEFAULT_BACKUP_POLICY,
              media: [],
            }),
          ),
        ),
      );
    const before = await treeOf(state);
    const after = await treeOf(changed);

    const differing = after
      .filter((text) => !before.includes(text))
      .map((text) => text.split('\n')[0]);
    expect(differing).toEqual([`project/tracks/${track.id}.json`]);
  });
});
