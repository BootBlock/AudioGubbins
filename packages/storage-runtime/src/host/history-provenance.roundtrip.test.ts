import { describe, expect, it } from 'vitest';

import type { CommandBus, CommandInvocation } from '@audiogubbins/commands';
import {
  AssetOrigin,
  StandardLayouts,
  sampleCount,
  sampleRate,
  type Asset,
  type AssetId,
  type ProjectId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  MemoryStorageTree,
  generatedSource,
  memorySource,
} from '@audiogubbins/media-store/testing';
import {
  ProjectCommandId,
  addAssetInvocation,
  adoptSourceVersionInvocation,
  relinkSourceInvocation,
} from '@audiogubbins/project-commands';
import {
  ExportDestinationKind,
  ExportStatus,
  ProvenanceLevel,
  canonicalJson,
  decodeUtf8,
  stateFingerprintFrom,
  stateFingerprintOf,
  storageKeyOf,
  stripAssetProvenance,
  writeProjectDocument,
  type ContentId,
  type ExternalSourceIdentity,
  type HistoryNodeId,
  type MediaSource,
  type ProjectState,
} from '@audiogubbins/project-format';
import { seededRandom, type Random } from '@audiogubbins/project-format/testing';
import {
  exportBundle,
  importBundle,
  openProject,
  packUnpacked,
  unpackBundle,
  type ProjectModel,
  type ProjectSession,
} from '@audiogubbins/storage';
import { MemoryDirectory, MemoryLeaseCoordinator, memorySink } from '@audiogubbins/storage/testing';

import { SETTINGS, memoryHostServices, steppingClock } from '../testing/memory-storage.js';
import type { HostServices } from './host-services.js';

/**
 * A whole history exported at every provenance level keeps its undo and redo
 * (REQ-STOR-166, REQ-STOR-193): a project made by a random session of the real
 * project commands, adding managed and linked files, relinking them, taking
 * new versions of them, freezing, removing, undoing, redoing and branching, is
 * exported as a bundle at each level and brought into another storage, where
 * every change replays, from the state it was brought in at, to every state
 * the bundle keeps and to the state each change made, as stripped. No name,
 * kept handle or path of a file, and no word of where an export went, is in
 * any text file of a bundle at a lower level; a file's placeholder stands for
 * it, and for no other, throughout; and a bundle unpacked and packed again is
 * the same bundle.
 */

const SEEDS = [1, 2, 3, 4];
const LEVELS = [ProvenanceLevel.Full, ProvenanceLevel.Minimal, ProvenanceLevel.None];

/** Every word the session writes of a file's name, handle or path, or an export's place. */
const PRIVATE = /secret|private/iu;

const RATE = expectSuccess(sampleRate(48_000));
const LENGTH = expectSuccess(sampleCount(4_800));

/** The windows of one test: one the project is made in, and one it is brought into. */
function windowOf(seed: number): HostServices {
  return memoryHostServices({
    tree: new MemoryStorageTree(),
    coordinator: new MemoryLeaseCoordinator(),
    clock: steppingClock(),
    tab: { name: `window ${String(seed)}`, seed },
  });
}

/** A random session over a project, and the files it may link to. */
interface SessionRun {
  readonly session: ProjectSession;
  readonly random: Random;
  readonly services: HostServices;
  readonly project: ProjectId;
  readonly media: readonly ContentId[];
}

/**
 * One of a few files on the person's machine, at a version: the first known
 * by its name alone, which can be relinked but never adopted, and the others
 * by a kept handle and a path too.
 */
function fileAt(run: SessionRun, file: number, version: number): ExternalSourceIdentity {
  const contentId = run.media[(file * 3 + version) % run.media.length] ?? noMedia();
  return {
    ...(file === 0 ? {} : { handleKey: `secret-handle-${String(file)}` }),
    fileName: `Secret take ${String(file)}.wav`,
    ...(file === 0 ? {} : { relativePath: `Private folder/Secret take ${String(file)}.wav` }),
    byteLength: 3_000,
    lastModified: 1_780_000_000_000 + version,
    mediaType: 'audio/wav',
    signature: '52494646',
    fastFingerprint: (file * 1_000 + version).toString(16).padStart(64, '0'),
    contentId,
  };
}

function noMedia(): never {
  throw new Error('No media was stored.');
}

function lost(): never {
  throw new Error('A node was not reached.');
}

/** An asset of the session's, with its media, added with where it came from. */
function added(run: SessionRun, media: MediaSource, step: number): CommandInvocation {
  const id = run.services.ids.next<'AssetId'>();
  const asset: Asset = {
    id,
    displayName: `Asset ${String(step)}`,
    origin: AssetOrigin.Imported,
    sampleRate: RATE,
    channelLayout: StandardLayouts.mono,
    length: LENGTH,
    storageKey: storageKeyOf(id, media),
    edits: [],
  };
  return addAssetInvocation(asset, {
    media,
    provenance: {
      originalFileName: `Secret import ${String(step)}.wav`,
      importedAt: 1_790_000_000_000 + step,
      byteLength: 3_000,
      mediaType: 'audio/wav',
      originProjectId: run.project,
    },
  });
}

/** A linked asset of the project as it is, picked at random, with its identity. */
function linkedAsset(run: SessionRun) {
  const { state } = run.session.getSnapshot().model;
  const linked = [...state.sources].flatMap(([id, { media }]) =>
    media.kind === 'external' ? [{ asset: state.project.assets.get(id), media }] : [],
  );
  const picked = linked.length === 0 ? undefined : run.random.pick(linked);
  return picked?.asset === undefined ? undefined : { ...picked, asset: picked.asset };
}

/** Any asset of the project as it is, picked at random. */
function anyAsset(run: SessionRun): AssetId | undefined {
  const ids = [...run.session.getSnapshot().model.state.project.assets.keys()];
  return ids.length === 0 ? undefined : run.random.pick(ids);
}

type Operation = (run: SessionRun, step: number) => Promise<unknown>;

const OPERATIONS: readonly (readonly [weight: number, Operation])[] = [
  [
    4,
    async (run, step) =>
      await run.session.run(
        added(
          run,
          {
            kind: 'managed',
            contentId: run.random.pick(run.media),
            byteLength: 3_000,
            mediaType: 'audio/wav',
          },
          step,
        ),
      ),
  ],
  [
    8,
    async (run, step) => {
      const identity = fileAt(run, run.random.below(4), 0);
      const media: MediaSource = {
        kind: 'external',
        identity,
        policy: 'prompt',
        ...(identity.contentId === undefined ? {} : { retainedCopy: identity.contentId }),
      };
      return await run.session.run(added(run, media, step));
    },
  ],
  [
    8,
    async (run) => {
      const linked = linkedAsset(run);
      if (linked === undefined) return undefined;
      const identity = fileAt(run, run.random.below(4), run.random.below(3));
      return await run.session.run(
        relinkSourceInvocation(linked.asset.id, identity, identity.contentId),
      );
    },
  ],
  [
    14,
    async (run, step) => {
      const linked = linkedAsset(run);
      if (linked === undefined) return undefined;
      const now = linked.media.identity;
      const contentId = run.random.pick(run.media);
      const newer = { ...now, lastModified: now.lastModified + step, contentId };
      const identity = { ...newer, fastFingerprint: step.toString(16).padStart(64, 'f') };
      return await run.session.run(
        adoptSourceVersionInvocation(linked.asset.id, identity, contentId),
      );
    },
  ],
  [3, async (run) => await assetCommand(run, ProjectCommandId.FreezeSource, {})],
  [
    3,
    async (run) =>
      await assetCommand(run, ProjectCommandId.SetSourcePolicy, {
        policy: run.random.pick(['prompt', 'adopt', 'freeze']),
      }),
  ],
  [
    3,
    async (run, step) =>
      await assetCommand(run, ProjectCommandId.RenameAsset, { name: `Renamed ${String(step)}` }),
  ],
  [3, async (run) => await assetCommand(run, ProjectCommandId.RemoveAsset, {})],
  [
    3,
    async ({ session }, step) =>
      await session.run({
        commandId: ProjectCommandId.Rename,
        arguments: { name: `Step ${String(step)}` },
      }),
  ],
  [10, async ({ session }) => await session.undo()],
  [6, async ({ session }) => await session.redo()],
  [
    6,
    async ({ session, random }) =>
      await session.goTo(random.pick([...session.getSnapshot().model.history.nodes.keys()])),
  ],
  [2, async ({ session }, step) => await session.createSnapshot({ name: `Kept ${String(step)}` })],
  [2, async (run) => await run.session.recordExport(secretExport(run))],
];

async function assetCommand(
  run: SessionRun,
  commandId: CommandInvocation['commandId'],
  more: Readonly<Record<string, string>>,
): Promise<unknown> {
  const assetId = anyAsset(run);
  if (assetId === undefined) return undefined;
  return await run.session.run({ commandId, arguments: { assetId, ...more } });
}

/** An export to a Godot project, recorded with where it went. */
function secretExport(run: SessionRun) {
  return {
    id: run.services.ids.next<'ExportRecordId'>(),
    at: run.services.clock.now(),
    stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'0'.repeat(64)}`)),
    engineVersions: new Map([['engine', '1']]),
    output: { container: 'ogg', settings: new Map([['quality', 0.5]]) },
    destination: { kind: ExportDestinationKind.GodotProject, label: 'Secret game' },
    godot: { projectLabel: 'Secret game', resources: ['res://secret/step.ogg'] },
    status: ExportStatus.Partial,
    problems: ['Could not write res://secret/step_2.ogg'],
  };
}

function chosen(random: Random): Operation {
  const total = OPERATIONS.reduce((sum, [weight]) => sum + weight, 0);
  let roll = random.below(total);
  for (const [weight, operation] of OPERATIONS) {
    if (roll < weight) return operation;
    roll -= weight;
  }
  throw new Error('A roll fell past every operation.');
}

/** A closed project made by a random session, and its model as the session left it. */
async function randomProject(services: HostServices, seed: number) {
  const media: ContentId[] = [];
  for (let index = 0; index < 6; index += 1) {
    const { contentId } = expectSuccess(
      await services.store.put(generatedSource(3_000, seed * 10 + index)),
    );
    services.store.release(contentId);
    media.push(contentId);
  }
  const project = expectSuccess(
    await services.repository.create({ name: 'Forest walk', settings: SETTINGS }),
  ).id;
  const opened = expectSuccess(
    await openProject(
      { project, access: 'write' },
      { ...services, cadence: { checkpointAfter: 5, keepStateEvery: 3 } },
    ),
  );
  if (opened.kind !== 'writable') throw new Error(`The project opened ${opened.kind}.`);
  const run = { session: opened.session, random: seededRandom(seed), services, project, media };
  for (let step = 1; step <= 60; step += 1) await chosen(run.random)(run, step);
  expectSuccess(await opened.session.createSnapshot({ name: 'Last' }));
  const { model } = opened.session.getSnapshot();
  expectSuccess(await opened.session.close());
  return { project, model };
}

/** The state each change applies, every invocation of which must apply. */
function applied(
  bus: CommandBus<ProjectState>,
  from: ProjectState,
  invocations: readonly CommandInvocation[],
): ProjectState {
  let state = from;
  for (const invocation of invocations) {
    const result = bus.execute(state, invocation);
    if (result.kind !== 'applied') {
      throw new Error(`${invocation.commandId} did not replay: it was ${result.kind}.`);
    }
    state = result.next;
  }
  return state;
}

/**
 * The state of every node of a history, each reached by replaying its changes
 * from the state the project is at: a parent by undoing, a child by redoing.
 */
function replayed(model: ProjectModel, bus: CommandBus<ProjectState>) {
  const { history } = model;
  const states = new Map<HistoryNodeId, ProjectState>([[history.cursor, model.state]]);
  const waiting = [history.cursor];
  for (let id = waiting.shift(); id !== undefined; id = waiting.shift()) {
    const state = states.get(id);
    const node = history.nodes.get(id);
    if (state === undefined || node === undefined) throw new Error('A node was lost.');
    const next: [HistoryNodeId, ProjectState][] = [];
    if (node.kind === 'change' && node.parent !== undefined && !states.has(node.parent)) {
      next.push([node.parent, applied(bus, state, node.inverse)]);
    }
    for (const child of history.children.get(id) ?? []) {
      const changed = history.nodes.get(child);
      if (changed?.kind !== 'change' || states.has(child)) continue;
      next.push([child, applied(bus, state, changed.forward)]);
    }
    for (const [each, reached] of next) {
      states.set(each, reached);
      waiting.push(each);
    }
  }
  return states;
}

function textOf(state: ProjectState): string {
  return canonicalJson(writeProjectDocument(state));
}

/**
 * Throws unless each name, handle and path of the original states stands as
 * one value in the brought-in states, and each value there for one original.
 */
function assertOnePlaceholderEach(
  original: ReadonlyMap<HistoryNodeId, ProjectState>,
  brought: ReadonlyMap<HistoryNodeId, ProjectState>,
): number {
  const forward = new Map<string, string>();
  const backward = new Map<string, string>();
  for (const [node, state] of original) {
    for (const [asset, { media }] of state.sources) {
      const other = brought.get(node)?.sources.get(asset)?.media;
      if (media.kind !== 'external' || other?.kind !== 'external') continue;
      for (const field of ['handleKey', 'fileName', 'relativePath'] as const) {
        const was = media.identity[field];
        const is = other.identity[field];
        expect(is === undefined).toBe(was === undefined);
        if (was === undefined || is === undefined) continue;
        expect(forward.get(`${field}:${was}`) ?? is).toBe(is);
        expect(backward.get(`${field}:${is}`) ?? was).toBe(was);
        forward.set(`${field}:${was}`, is);
        backward.set(`${field}:${is}`, was);
      }
    }
  }
  return forward.size;
}

/** Every text file of a tree that holds a word it should not. */
function leaking(directory: MemoryDirectory): readonly string[] {
  return [...directory.files]
    .filter(([path]) => !path.startsWith('media/'))
    .filter(([, bytes]) => PRIVATE.test(expectSuccess(decodeUtf8(bytes))))
    .map(([path]) => path);
}

function changesOf(model: ProjectModel, command: string): number {
  return [...model.history.nodes.values()].filter(
    (node) => node.kind === 'change' && node.forward.some((each) => each.commandId === command),
  ).length;
}

describe('a whole history exported at each provenance level (REQ-STOR-166)', () => {
  it.each(SEEDS.flatMap((seed) => LEVELS.map((level) => [seed, level] as const)))(
    'seed %i at %s: brought in, every change replays to the states it keeps',
    async (seed, level) => {
      const source = windowOf(seed);
      const { project, model } = await randomProject(source, seed);
      expect(changesOf(model, ProjectCommandId.AdoptSourceVersion)).toBeGreaterThan(0);
      expect(changesOf(model, ProjectCommandId.RelinkSource)).toBeGreaterThan(0);
      const sink = memorySink();
      const options = {
        scope: { kind: 'whole-history', provenance: level },
        includeCaches: false,
      } as const;
      expectSuccess(expectSuccess(await exportBundle(project, sink, options, source)).written);
      const bundle = sink.bytes();

      const directory = new MemoryDirectory();
      expectSuccess(await unpackBundle(memorySource(bundle), directory, source));
      const leaks = leaking(directory);
      if (level === ProvenanceLevel.Full) expect(leaks.length).toBeGreaterThan(0);
      else expect(leaks).toEqual([]);
      const packed = memorySink();
      expectSuccess(await packUnpacked(directory, packed, source));
      expect(packed.bytes()).toEqual(bundle);

      const target = windowOf(seed + 100);
      expectSuccess(await importBundle(memorySource(bundle), 'original', target));
      const opened = expectSuccess(await openProject({ project, access: 'read' }, target));
      if (opened.kind !== 'read-only') throw new Error(`The project opened ${opened.kind}.`);
      const brought = opened.view.getSnapshot().model;
      opened.view.close();
      const reached = replayed(brought, target.bus);
      const kept = [...directory.files.keys()].flatMap((path) => {
        const named = /^history\/states\/(.+)\.json$/u.exec(path)?.[1];
        return named === undefined ? [] : [named];
      });
      const named = new Set<string>();
      for (const [id, node] of brought.history.nodes.entries()) {
        if (node.stateFingerprint === undefined) continue;
        const state = reached.get(id) ?? lost();
        expect(await stateFingerprintOf(state, target.digest)).toBe(node.stateFingerprint);
        named.add(node.stateFingerprint);
      }
      expect(kept.length).toBeGreaterThan(1);
      for (const fingerprint of kept) expect(named).toContain(fingerprint);

      const original = replayed(model, source.bus);
      expect([...reached.keys()].toSorted()).toEqual([...original.keys()].toSorted());
      for (const [id, state] of original) {
        const other = reached.get(id) ?? lost();
        expect(textOf(stripAssetProvenance(other, level))).toBe(
          textOf(stripAssetProvenance(state, level)),
        );
      }
      expect(assertOnePlaceholderEach(original, reached)).toBeGreaterThan(2);
    },
    // A session of the real commands, two storages and every state replayed
    // twice take well under a second alone, and several under a loaded run.
    30_000,
  );
});
