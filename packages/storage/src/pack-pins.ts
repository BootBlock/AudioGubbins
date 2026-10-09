/**
 * Which model pack versions the projects need, which no cleanup removes and
 * the installer keeps until the person removes them knowingly (REQ-AUDIO-139,
 * ADR-0062).
 *
 * A project needs every pack version a processor instance names, by its
 * `ModelIdentity`, in its current state, its history, its snapshots or its
 * backups, since an undo or a restore brings the instance back. That is what
 * `project-roots.ts` walks: a state names its models by the processors of every
 * chain it runs (`projectChains`: its own and those audio pasted into it
 * carries), and the rest is searched for a model identity's shape anywhere,
 * nested JSON text among it (`nested-values.ts`), as a command's arguments
 * carry a chain, which errs, as it must, on the side of keeping.
 *
 * The walk reads one file at a time, when the pins are asked for, and holds
 * only the set of versions found, which is as small as the packs installed. A
 * file it cannot read means the set cannot be told, so the pins are refused
 * with the reason, and everything is kept.
 */

import {
  FailureKind,
  fail,
  failure,
  isModelIdentity,
  processorsOf,
  projectChains,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import { packKey, type PackRef } from '@audiogubbins/model-packs';
import {
  isJsonObject,
  type Digest,
  type JsonValue,
  type ProjectState,
  type StorageTree,
} from '@audiogubbins/project-format';

import { CheckedRecords } from './checked-records.js';
import { valuesWithin } from './nested-values.js';
import type { PackPins } from './pack-cleanup.js';
import { projectRoots, type RootReading, type UnreadableRoot } from './project-roots.js';

/** The pack version a value of a model identity's shape names, or nothing. */
function modelRef(value: Readonly<Record<string, JsonValue>>): PackRef | undefined {
  const { pack, version, modelHash, runtimeHash } = value;
  if (
    typeof pack !== 'string' ||
    typeof version !== 'string' ||
    typeof modelHash !== 'string' ||
    typeof runtimeHash !== 'string' ||
    !isModelIdentity({ pack, version, modelHash, runtimeHash })
  ) {
    return undefined;
  }
  return { id: pack, version };
}

/**
 * Every pack version `value` names by a model identity, anywhere in it, nested
 * JSON text among it; one may be given twice.
 */
function* modelsIn(value: JsonValue): Generator<PackRef, void, undefined> {
  for (const each of valuesWithin(value)) {
    if (!isJsonObject(each)) continue;
    const ref = modelRef(each);
    if (ref !== undefined) yield ref;
  }
}

/** Every pack version a processor of a chain `state` runs names; one may be given twice. */
export function* modelsNamedBy(state: ProjectState): Generator<PackRef, void, undefined> {
  for (const chain of projectChains(state.project)) {
    for (const processor of processorsOf(chain.slots)) {
      const model = processor.version.model;
      if (model !== undefined) yield { id: model.pack, version: model.version };
    }
  }
}

const MODELS: RootReading<PackRef> = { inState: modelsNamedBy, inValue: modelsIn };

/** The pins of the projects `tree` keeps (see the module comment). */
export function projectPackPins(tree: StorageTree, digest: Digest): PackPins {
  return async (signal) => {
    const unreadable: UnreadableRoot[] = [];
    const pins = new Map<string, PackRef>();
    const found = projectRoots(
      new CheckedRecords(tree, digest),
      MODELS,
      (root) => unreadable.push(root),
      signal,
    );
    for await (const ref of found) pins.set(packKey(ref), ref);
    return pinsOf(pins, unreadable);
  };
}

/** The pins found, or why they cannot be told where any file could not be read. */
function pinsOf(
  pins: ReadonlyMap<string, PackRef>,
  unreadable: readonly UnreadableRoot[],
): DomainResult<readonly PackRef[]> {
  const [first] = unreadable;
  if (first === undefined) return succeed([...pins.values()]);
  return fail(
    failure(
      'storage.pack-pins-unread',
      FailureKind.Unrecoverable,
      'Which model packs the projects need cannot be told, since what a project keeps cannot be read, so every pack is kept.',
      { details: { path: first.path }, cause: first.failure },
    ),
  );
}
