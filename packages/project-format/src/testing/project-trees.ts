/**
 * Project trees built from a seed, and a listing over a tree's files in memory,
 * for the tests of the unpacked tree and of the bundle.
 *
 * A history is built for the state it is given: an origin, changes in a random
 * shape, snapshots of states made by renaming the project, and a cursor whose
 * node names the state the project is in, so every rule the tree's reader holds
 * a history to is met.
 */

import {
  createDeterministicIdGenerator,
  fail,
  failure,
  FailureKind,
  succeed,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { Digest } from '../byte-ports.js';
import type { StateFingerprint } from '../content-identity.js';
import { ExportDestinationKind, ExportStatus, type ExportRecord } from '../export-provenance.js';
import {
  historyLabelFrom,
  type HistoryNodeId,
  type HistoryNodeRecord,
  type NamedSnapshot,
} from '../history-record.js';
import { stateFingerprintOf } from '../project-json.js';
import type { ProjectState } from '../project-state.js';
import type { ProjectTreeListing } from '../project-tree-files.js';
import type { ProjectTreeContent, ProjectTreeFile } from '../project-tree-writing.js';
import { contentIdOfDigit } from './project-states.js';
import { seededRandom } from './random-values.js';

const EPOCH = 1_790_000_000_000;

const NO_EFFECT = {
  assets: [],
  tracks: [],
  buses: [],
  clips: [],
  regions: [],
  markers: [],
  effectChains: [],
  project: true,
};

/** A state renamed, as a change would leave it. */
function renamed(state: ProjectState, name: string): ProjectState {
  return { ...state, project: { ...state.project, displayName: name } };
}

/** An export record made at a moment. */
function exportRecordAt(
  id: ExportRecord['id'],
  at: number,
  stateFingerprint: StateFingerprint,
): ExportRecord {
  return {
    id,
    at,
    stateFingerprint,
    engineVersions: new Map([['engine', '1.0.0']]),
    output: { container: 'wav', settings: new Map([['bits', 24]]) },
    destination: { kind: ExportDestinationKind.Directory, label: 'Sounds for the level' },
    status: ExportStatus.Partial,
    problems: ['One file was not written.'],
  };
}

/** The whole-history content of a tree for `state`, shaped by `seed`. */
export async function historyContent(
  state: ProjectState,
  seed: number,
  digest: Digest,
): Promise<ProjectTreeContent> {
  const random = seededRandom(seed);
  const ids = createDeterministicIdGenerator(seed + 1_000);
  const states = new Map<StateFingerprint, ProjectState>();
  const keep = async (kept: ProjectState): Promise<StateFingerprint> => {
    const fingerprint = await stateFingerprintOf(kept, digest);
    states.set(fingerprint, kept);
    return fingerprint;
  };

  const origin = ids.next<'HistoryNodeId'>();
  const nodes: HistoryNodeRecord[] = [
    {
      kind: 'origin',
      id: origin,
      at: EPOCH,
      origin: { kind: 'new' },
      stateFingerprint: await keep(renamed(state, 'Before')),
    },
  ];
  const snapshots: NamedSnapshot[] = [];
  for (let step = 1; step <= 1 + random.below(12); step += 1) {
    const parent = random.pick(nodes).id;
    const id = ids.next<'HistoryNodeId'>();
    const snapshotted = random.chance(0.3) ? renamed(state, `Take ${String(step)}`) : undefined;
    const fingerprint = snapshotted === undefined ? undefined : await keep(snapshotted);
    nodes.push({
      kind: 'change',
      id,
      parent,
      at: EPOCH + step,
      description: `Take ${String(step)}`,
      forward: [{ commandId: 'project.rename', arguments: { name: `Take ${String(step)}` } }],
      inverse: [{ commandId: 'project.rename', arguments: { name: 'Before', step } }],
      affects: NO_EFFECT,
      ...(fingerprint === undefined ? {} : { stateFingerprint: fingerprint }),
    });
    if (fingerprint !== undefined) {
      snapshots.push(snapshotOf(ids.next<'SnapshotId'>(), id, fingerprint, step));
    }
  }
  const cursor = ids.next<'HistoryNodeId'>();
  const cursorParent = random.pick(nodes).id;
  const current = await keep(state);
  nodes.push({
    kind: 'change',
    id: cursor,
    parent: cursorParent,
    at: EPOCH + 100,
    description: 'Where the project is',
    forward: [{ commandId: 'project.rename', arguments: { name: 'Now' } }],
    inverse: [{ commandId: 'project.rename', arguments: { name: 'Then' } }],
    affects: NO_EFFECT,
    stateFingerprint: current,
  });
  return {
    state,
    scope: {
      kind: 'history',
      history: {
        record: {
          project: state.project.id,
          nodes,
          cursor,
          preferred: new Map([[cursorParent, cursor]]),
          branchNames: new Map([[cursor, expectSuccess(historyLabelFrom('Main idea'))]]),
          snapshots,
        },
        retention: { kind: 'rules', rules: [{ kind: 'recent-changes', count: 50 }] },
        states,
        comparison: {
          a: { kind: 'node', node: cursorParent },
          b: { kind: 'node', node: cursor },
          listening: 'b',
        },
      },
    },
    backup: {
      kind: 'automatic',
      trigger: { everyChanges: 5 },
      retention: { count: 3, days: 30 },
      external: true,
    },
    exports: [
      exportRecordAt(ids.next<'ExportRecordId'>(), EPOCH + 20, current),
      exportRecordAt(ids.next<'ExportRecordId'>(), EPOCH + 10, current),
    ],
    media: [
      { contentId: contentIdOfDigit('a'), byteLength: 9_600 },
      { contentId: contentIdOfDigit('b'), byteLength: 0 },
    ],
    caches: [
      {
        path: `waveform/${contentIdOfDigit('a')}/peaks-256`,
        byteLength: 12,
        contentId: contentIdOfDigit('c'),
      },
    ],
  };
}

function snapshotOf(
  id: NamedSnapshot['id'],
  node: HistoryNodeId,
  stateFingerprint: StateFingerprint,
  step: number,
): NamedSnapshot {
  return {
    id,
    kind: step % 2 === 0 ? 'named' : 'recovery',
    name: expectSuccess(historyLabelFrom(`Snapshot ${String(step)}`)),
    notes: 'Kept for the client.',
    at: EPOCH + step,
    author: 'A person',
    application: 'AudioGubbins 0.1.0',
    node,
    stateFingerprint,
    exports: [],
  };
}

/** A tree's files in memory, as a listing; a media or cache file's bytes are its length's. */
export function listingOf(
  files: readonly ProjectTreeFile[],
  onRead?: (path: string) => void,
): ProjectTreeListing {
  const texts = new Map(
    files.flatMap(({ path, body }) => (body.kind === 'text' ? [[path, body.bytes] as const] : [])),
  );
  return {
    files: files.map(({ path, body }) => ({
      path,
      size: body.kind === 'text' ? body.bytes.length : body.byteLength,
    })),
    read: (path) => {
      onRead?.(path);
      const bytes = texts.get(path);
      return Promise.resolve(
        bytes === undefined
          ? fail(failure('test.not-text', FailureKind.Rejected, 'Not a text file.'))
          : succeed(bytes),
      );
    },
  };
}
