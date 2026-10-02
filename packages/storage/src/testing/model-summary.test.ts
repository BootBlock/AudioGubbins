import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { historyFromRecord, historyRecordOf } from '@audiogubbins/history';
import {
  ExportDestinationKind,
  ExportStatus,
  stateFingerprintFrom,
  type HistoryNodeRecord,
  type HistoryRecord,
  type NamedSnapshot,
} from '@audiogubbins/project-format';

import type { ProjectModel } from '../project-model.js';
import { summaryOf } from './model-summary.js';
import { harness } from './node-services.js';
import { madeProject, openToWrite } from './storage-harness.js';
import { addAsset, contentOf, setName } from './test-commands.js';

/**
 * The summary the round-trip and recovery tests compare projects by: a project
 * kept or carried with any part of it lost or changed must summarise apart from
 * the project it was, or those tests would pass over the loss.
 */

const FINGERPRINT = expectSuccess(stateFingerprintFrom(`s1-${'1'.repeat(64)}`));

async function sampleModel(): Promise<ProjectModel> {
  const test = harness(41);
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), contentOf(3))));
  expectSuccess(await session.run(setName('Named')));
  expectSuccess(
    await session.createSnapshot({ name: 'Kept', notes: 'For the client', author: 'Sam' }),
  );
  expectSuccess(
    await session.recordExport({
      id: test.ids.next<'ExportRecordId'>(),
      at: test.clock.now(),
      stateFingerprint: FINGERPRINT,
      engineVersions: new Map([['engine', '1']]),
      output: { container: 'wav', settings: new Map([['bits', 24]]) },
      destination: { kind: ExportDestinationKind.Download },
      status: ExportStatus.Succeeded,
      problems: [],
    }),
  );
  return session.getSnapshot().model;
}

/** The model with its history's record changed by `change`. */
function withHistory(
  model: ProjectModel,
  change: (record: HistoryRecord) => HistoryRecord,
): ProjectModel {
  return {
    ...model,
    history: expectSuccess(historyFromRecord(change(historyRecordOf(model.history)))),
  };
}

function eachNode(change: (node: HistoryNodeRecord) => HistoryNodeRecord) {
  return (record: HistoryRecord): HistoryRecord => ({ ...record, nodes: record.nodes.map(change) });
}

function eachSnapshot(change: (snapshot: NamedSnapshot) => NamedSnapshot) {
  return (record: HistoryRecord): HistoryRecord => ({
    ...record,
    snapshots: record.snapshots.map(change),
  });
}

const CHANGES: readonly (readonly [string, (model: ProjectModel) => ProjectModel])[] = [
  [
    'a node’s time',
    (model) =>
      withHistory(
        model,
        eachNode((node) => ({ ...node, at: node.at + 1 })),
      ),
  ],
  [
    'what a change affects',
    (model) =>
      withHistory(
        model,
        eachNode((node) =>
          node.kind === 'change'
            ? { ...node, affects: { ...node.affects, project: !node.affects.project } }
            : node,
        ),
      ),
  ],
  [
    'a snapshot’s notes',
    (model) =>
      withHistory(
        model,
        eachSnapshot((snapshot) => ({ ...snapshot, notes: 'Other' })),
      ),
  ],
  [
    'a snapshot’s kind',
    (model) =>
      withHistory(
        model,
        eachSnapshot((snapshot) => ({ ...snapshot, kind: 'recovery' })),
      ),
  ],
  [
    'a snapshot’s author',
    (model) =>
      withHistory(
        model,
        eachSnapshot((snapshot) => ({ ...snapshot, author: 'Alex' })),
      ),
  ],
  [
    'a snapshot’s time',
    (model) =>
      withHistory(
        model,
        eachSnapshot((snapshot) => ({ ...snapshot, at: snapshot.at + 1 })),
      ),
  ],
  [
    'a snapshot’s exports',
    (model) =>
      withHistory(
        model,
        eachSnapshot((snapshot) => ({ ...snapshot, exports: model.exports.map(({ id }) => id) })),
      ),
  ],
  [
    'an export’s status',
    (model) => ({
      ...model,
      exports: model.exports.map((record) => ({
        ...record,
        status: ExportStatus.Failed,
        problems: ['The disc was full.'],
      })),
    }),
  ],
  [
    'an export’s engines',
    (model) => ({
      ...model,
      exports: model.exports.map((record) => ({
        ...record,
        engineVersions: new Map([['engine', '2']]),
      })),
    }),
  ],
];

describe('the summary projects are compared by', () => {
  it.each(CHANGES)('tells a project apart from one with %s changed', async (_, change) => {
    const model = await sampleModel();
    expect(summaryOf(change(model))).not.toBe(summaryOf(model));
  });

  it('leaves out the fingerprints a checkpoint adds to nodes', async () => {
    const model = await sampleModel();
    const learned = withHistory(
      model,
      eachNode((node) => ({ ...node, stateFingerprint: FINGERPRINT })),
    );
    expect(summaryOf(learned)).toBe(summaryOf(model));
  });
});
