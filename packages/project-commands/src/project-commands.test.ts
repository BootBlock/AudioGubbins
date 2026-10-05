import { describe, expect, it } from 'vitest';

import {
  commandId,
  createCommandRegistry,
  isCommandId,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  createDeterministicIdGenerator,
  type Asset,
  type EditOperationId,
  type IdGenerator,
} from '@audiogubbins/domain';
import { TEST_CATALOGUE } from '@audiogubbins/domain/testing';
import {
  SourceChangePolicy,
  canonicalJson,
  isJsonArray,
  isJsonObject,
  memberOf,
  parseJson,
  writeMediaSource,
  type JsonValue,
  type ProjectState,
} from '@audiogubbins/project-format';
import {
  randomAssetRecord,
  randomChain,
  randomContentId,
  randomIdentity,
  randomMedia,
  randomMarker,
  randomName,
  randomOperation,
  randomRegion,
  randomRegionOperation,
  randomState,
  seededRandom,
  type Random,
} from '@audiogubbins/project-format/testing';

import { ProjectCommandId } from './project-command.js';
import { projectCommands } from './project-commands.js';
import { applyInvocation, withdrawInvocation } from './editing/edit-commands.js';
import {
  addMarkerInvocation,
  removeMarkerInvocation,
  setMarkerInvocation,
} from './editing/marker-commands.js';
import {
  addRegionInvocation,
  applyRegionEditInvocation,
  removeRegionInvocation,
  setRegionInvocation,
  withdrawRegionEditInvocation,
} from './editing/region-commands.js';
import {
  addAssetInvocation,
  adoptSourceVersionInvocation,
  relinkSourceInvocation,
} from './project-invocations.js';
import {
  addChainInvocation,
  removeChainInvocation,
  setChainInvocation,
} from './processing/chain-commands.js';
import {
  setEditChainInvocation,
  setRackInvocation,
  type RackTarget,
} from './processing/rack-commands.js';
import {
  appliedOf,
  assertReadsBack,
  canonicalTextOf,
  entryOf,
  projectBus,
  runAll,
} from './testing/bus-runs.js';

const SEEDS = 80;
const STEPS = 30;

/**
 * A random invocation of a random project command against the state, mostly
 * one that applies, sometimes one that is refused or changes nothing.
 */
function randomInvocation(
  random: Random,
  ids: IdGenerator,
  state: ProjectState,
): CommandInvocation {
  const assets = [...state.project.assets.values()];
  const choice = random.below(26);
  if (choice === 0)
    return { commandId: ProjectCommandId.Rename, arguments: { name: randomName(random) } };
  if (choice === 1)
    return { commandId: ProjectCommandId.SetName, arguments: { name: randomName(random) } };
  if (choice === 2 || assets.length === 0) {
    const { asset, source } = randomAssetRecord(random, ids, state.project.id);
    return addAssetInvocation(asset, source);
  }

  const asset = random.pick(assets);
  const assetId = asset.id;
  if (choice >= 21) return randomProcessingInvocation(random, ids, state, asset, choice);
  if (choice >= 11) return randomEditingInvocation(random, ids, state, asset, choice);
  const current = state.sources.get(assetId)?.media;
  const retained = random.chance(0.5) ? randomContentId(random) : undefined;
  switch (choice) {
    case 3:
      return { commandId: ProjectCommandId.RemoveAsset, arguments: { assetId } };
    case 4:
      return {
        commandId: ProjectCommandId.RenameAsset,
        arguments: { assetId, name: randomName(random) },
      };
    case 5:
      return {
        commandId: ProjectCommandId.SetAssetName,
        arguments: { assetId, name: randomName(random) },
      };
    case 6:
      return {
        commandId: ProjectCommandId.SetSourcePolicy,
        arguments: { assetId, policy: random.pick(Object.values(SourceChangePolicy)) },
      };
    case 7:
      return {
        commandId: ProjectCommandId.SetAssetMedia,
        arguments: { assetId, media: canonicalJson(writeMediaSource(randomMedia(random))) },
      };
    case 8:
      return relinkSourceInvocation(asset.id, randomIdentity(random), retained);
    case 9: {
      const identity =
        current?.kind === 'external'
          ? {
              ...current.identity,
              byteLength: random.below(2 ** 40),
              lastModified: random.below(2 ** 42),
            }
          : randomIdentity(random);
      return adoptSourceVersionInvocation(asset.id, identity, retained);
    }
    default:
      return { commandId: ProjectCommandId.FreezeSource, arguments: { assetId } };
  }
}

/**
 * A random invocation of a chain or rack command: a new chain, a chain
 * changed or removed (refused while something names it), a rack given to or
 * taken from `asset` or one of its regions, or one of its rack edits pointed
 * at another chain.
 */
function randomProcessingInvocation(
  random: Random,
  ids: IdGenerator,
  state: ProjectState,
  asset: Asset,
  choice: number,
): CommandInvocation {
  const chains = [...state.project.effectChains.values()];
  const chain = chains.length > 0 ? random.pick(chains) : undefined;
  const regions = [...state.project.regions.values()].filter(
    (region) => region.assetId === asset.id,
  );
  const region = regions.length > 0 && random.chance(0.5) ? random.pick(regions) : undefined;
  const target: RackTarget =
    region === undefined ? { kind: 'asset', asset } : { kind: 'region', region, asset };
  switch (choice) {
    case 22:
      if (chain !== undefined)
        return setChainInvocation({ ...randomChain(random, ids), id: chain.id });
      break;
    case 23:
      if (chain !== undefined) return removeChainInvocation(chain.id);
      break;
    case 24:
      return setRackInvocation(target, random.chance(0.3) ? undefined : chain?.id);
    case 25: {
      const racks: readonly { readonly id: EditOperationId }[] =
        region === undefined
          ? asset.edits.filter(
              (operation) => operation.kind === 'process' && operation.edit.kind === 'rack',
            )
          : region.operations.filter((operation) => operation.edit.kind === 'rack');
      if (racks.length > 0 && chain !== undefined) {
        return setEditChainInvocation(target, random.pick(racks).id, chain.id);
      }
      break;
    }
  }
  return addChainInvocation(randomChain(random, ids));
}

/**
 * A random invocation of an editing command on `asset`: mostly one the domain
 * accepts, sometimes one refused because something is placed on the edit it
 * withdraws, or the region still has processing.
 */
function randomEditingInvocation(
  random: Random,
  ids: IdGenerator,
  state: ProjectState,
  asset: Asset,
  choice: number,
): CommandInvocation {
  const { assets } = state.project;
  const markers = [...state.project.markers.values()].filter(
    (marker) => marker.assetId === asset.id,
  );
  const regions = [...state.project.regions.values()].filter(
    (region) => region.assetId === asset.id,
  );
  const marker = markers.length > 0 ? random.pick(markers) : undefined;
  const region = regions.length > 0 ? random.pick(regions) : undefined;
  const last = asset.edits.at(-1);
  const context = { chains: state.project.effectChains, catalogue: TEST_CATALOGUE };
  const fresh = randomRegion(random, ids, asset, context);
  switch (choice) {
    case 11: {
      const operation = randomOperation(random, ids, asset, assets, context);
      if (operation !== undefined) return applyInvocation(asset, operation);
      break;
    }
    case 12:
      if (last !== undefined) return withdrawInvocation(asset, last);
      break;
    case 13:
      return addMarkerInvocation(randomMarker(random, ids, asset));
    case 14:
      if (marker !== undefined) {
        return setMarkerInvocation({ ...randomMarker(random, ids, asset), id: marker.id });
      }
      break;
    case 15:
      if (marker !== undefined) return removeMarkerInvocation(marker);
      break;
    case 16:
      if (fresh !== undefined) return addRegionInvocation({ ...fresh, operations: [] });
      break;
    case 17:
      if (region !== undefined && fresh !== undefined) {
        return setRegionInvocation({ ...fresh, id: region.id });
      }
      break;
    case 18:
      if (region !== undefined) return removeRegionInvocation(region);
      break;
    case 19: {
      const operation =
        region === undefined
          ? undefined
          : randomRegionOperation(random, ids, asset, region, context);
      if (region !== undefined && operation !== undefined) {
        return applyRegionEditInvocation(region, operation);
      }
      break;
    }
    default: {
      const processing = region?.operations.at(-1);
      if (region !== undefined && processing !== undefined) {
        return withdrawRegionEditInvocation(region, processing);
      }
    }
  }
  return {
    commandId: ProjectCommandId.RenameAsset,
    arguments: { assetId: asset.id, name: randomName(random) },
  };
}

/** A journal's text of invocations, as the history would keep it. */
function journalOf(invocations: readonly CommandInvocation[]): string {
  return canonicalJson(
    invocations.map((invocation) => ({
      commandId: invocation.commandId,
      arguments: { ...invocation.arguments },
    })),
  );
}

/** The invocations a journal's text holds, read back as a reload would. */
function invocationsOf(journal: string): CommandInvocation[] {
  const parsed = parseJson(journal, { maximumLength: 2 ** 24, maximumDepth: 8 });
  if (!parsed.ok || !isJsonArray(parsed.value)) throw new Error('The journal is not a list.');
  return parsed.value.map((entry: JsonValue) => {
    const id = isJsonObject(entry) ? memberOf(entry, 'commandId') : undefined;
    const args = isJsonObject(entry) ? memberOf(entry, 'arguments') : undefined;
    if (typeof id !== 'string' || !isCommandId(id) || args === undefined || !isJsonObject(args)) {
      throw new Error('A journal entry is not an invocation.');
    }
    const primitives: Record<string, string | number | boolean | null> = {};
    for (const [name, value] of Object.entries(args)) {
      if (typeof value === 'object' && value !== null) throw new Error('An argument is nested.');
      primitives[name] = value;
    }
    return { commandId: commandId(id), arguments: primitives };
  });
}

describe('projectCommands', () => {
  it('declares every project command once, undoable and kept out of the palette', () => {
    const commands = projectCommands(TEST_CATALOGUE);
    const registry = createCommandRegistry<ProjectState>();
    for (const command of commands) registry.register(command);

    expect(commands.map((command) => command.id).sort()).toEqual(
      Object.values(ProjectCommandId).sort(),
    );
    expect(commands.every((command) => command.undoable && command.discoverable === false)).toBe(
      true,
    );
  });
});

describe('applying random commands to random states', () => {
  // About 3 s alone and twice that under the whole suite's load (2,400 steps,
  // each read back through the project format), so it is given a budget of its
  // own rather than Vitest's five-second default; a hang still fails it.
  it(
    'keeps every state valid, and undoing in reverse gives back the state it began with',
    { timeout: 30_000 },
    () => {
      const appliedIds = new Set<string>();
      let applied = 0;

      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const bus = projectBus();
        const start = randomState(seed);
        assertReadsBack(start);
        const random = seededRandom(seed * 7_919);
        const ids = createDeterministicIdGenerator(seed * 104_729);

        let state = start;
        const inverses: CommandInvocation[] = [];
        for (let step = 0; step < STEPS; step += 1) {
          const invocation = randomInvocation(random, ids, state);
          const result = bus.execute(state, invocation);
          if (result.kind !== 'applied') continue;
          assertReadsBack(result.next);
          inverses.push(...entryOf(result).inverse);
          appliedIds.add(invocation.commandId);
          applied += 1;
          state = result.next;
        }

        for (const inverse of inverses.reverse()) {
          state = appliedOf(bus.execute(state, inverse)).next;
          assertReadsBack(state);
        }
        expect(state).toEqual(start);
        expect(canonicalTextOf(state)).toBe(canonicalTextOf(start));
      }

      // The property is only worth its name if the walk applied every command.
      expect([...appliedIds].sort()).toEqual(Object.values(ProjectCommandId).sort());
      expect(applied).toBeGreaterThan(SEEDS * STEPS * 0.4);
    },
  );
});

describe('replaying a journal', () => {
  it('gives the same state, by its canonical text, as the run it was kept from', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const start = randomState(seed);
      const random = seededRandom(seed);
      const ids = createDeterministicIdGenerator(seed + 1);
      const bus = projectBus();

      const invocations: CommandInvocation[] = [];
      let state = start;
      for (let step = 0; step < STEPS; step += 1) {
        const invocation = randomInvocation(random, ids, state);
        invocations.push(invocation);
        const result = bus.execute(state, invocation);
        if (result.kind === 'applied') state = result.next;
      }

      const replayed = runAll(projectBus(), start, invocationsOf(journalOf(invocations)));
      expect(canonicalTextOf(replayed)).toBe(canonicalTextOf(state));
    }
  });
});

describe('running as one group through the bus', () => {
  it('records one step whose inverses, run in order, undo the whole group', () => {
    const start = randomState(3);
    const random = seededRandom(3);
    const { asset, source } = randomAssetRecord(
      random,
      createDeterministicIdGenerator(99),
      start.project.id,
    );
    const bus = projectBus();

    const result = bus.executeGroup(start, 'Import “Gravel footstep”', [
      addAssetInvocation(asset, source),
      {
        commandId: ProjectCommandId.RenameAsset,
        arguments: { assetId: asset.id, name: 'Gravel footstep' },
      },
    ]);
    const entry = entryOf(result);

    expect(entry.description).toBe('Import “Gravel footstep”');
    expect(entry.inverse).toHaveLength(2);
    let state = appliedOf(result).next;
    for (const inverse of entry.inverse) state = appliedOf(bus.execute(state, inverse)).next;
    expect(state).toEqual(start);
  });
});
