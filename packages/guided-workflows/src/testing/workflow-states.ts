/**
 * A project with asset groups for the tests of the guided workflows, made
 * into one through the project's own commands, so it is a state they
 * produce, and a bus that runs those commands as the application's does.
 *
 * ```
 * SFX              −16 LUFS, ceiling −1 dBTP   the door region (inherit)
 *   SFX/Footsteps  a filter chain              the footstep asset (inherit),
 *                                              the walk loop region (own)
 * Dialogue         −23 LUFS, ceiling −2 dBTP   nothing
 * ```
 *
 * The ambience asset is in no group. The sample project is passed in, since
 * only a test may take the fixtures package.
 */

import {
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  derivedSampleCount,
  instantiateProcessor,
  type Asset,
  type EffectChain,
  type IdGenerator,
  type Region,
} from '@audiogubbins/domain';
import type { GameAssetGroup, GroupMember } from '@audiogubbins/game-audio';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import {
  addGroupInvocation,
  assignMemberInvocation,
  projectCommands,
} from '@audiogubbins/project-commands';
import {
  canonicalJson,
  writeProjectDocument,
  type ProjectState,
} from '@audiogubbins/project-format';
import {
  contentIdOfDigit,
  withSources,
  type SampleProject,
} from '@audiogubbins/project-format/testing';

/** The logger the command bus takes, as the bus declares it. */
type BusLogger = Parameters<typeof createCommandBus>[1];

const QUIET: BusLogger = {
  category: 'guided-workflows-tests',
  error: () => undefined,
  warning: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  measured: () => undefined,
  forOperation: () => QUIET,
};

/** A bus over the project's commands and this build's processors. */
export function workflowBus(): CommandBus<ProjectState> {
  const registry = createCommandRegistry<ProjectState>();
  for (const command of projectCommands(PROCESSOR_CATALOGUE)) registry.register(command);
  return createCommandBus(registry, QUIET);
}

/** The compact canonical text of a state's document: equal states, equal text. */
export function stateText(state: ProjectState): string {
  return canonicalJson(writeProjectDocument(state));
}

/** The state `invocations` reach from `state` as one step, a thrown error where it is not applied. */
export function applied(
  bus: CommandBus<ProjectState>,
  state: ProjectState,
  invocations: readonly CommandInvocation[],
): ProjectState {
  const [first, ...rest] = invocations;
  if (first === undefined) throw new Error('There is nothing to apply.');
  const result = bus.executeGroup(state, 'step', [first, ...rest]);
  if (result.kind !== 'applied') {
    const why = result.kind === 'refused' ? result.failures.map((one) => one.code) : [result.code];
    throw new Error(`The step was ${result.kind}: ${why.join(', ')}.`);
  }
  return result.next;
}

export interface WorkflowWorld {
  readonly state: ProjectState;
  /** The generator the world was made with, at the place it left off. */
  readonly ids: IdGenerator;
  readonly assets: { readonly footstep: Asset; readonly ambience: Asset };
  readonly regions: { readonly walk: Region; readonly door: Region };
  readonly groups: {
    readonly sfx: GameAssetGroup;
    readonly footsteps: GameAssetGroup;
    readonly dialogue: GameAssetGroup;
  };
  /** The chain Footsteps sets as its processing. */
  readonly chain: EffectChain;
  readonly members: {
    readonly footstep: GroupMember;
    readonly ambience: GroupMember;
    readonly walk: GroupMember;
    readonly door: GroupMember;
  };
}

function filterChain(ids: IdGenerator): EffectChain {
  const filter = PROCESSOR_CATALOGUE.get('filter');
  if (filter === undefined) throw new Error('This build has no filter.');
  return {
    id: ids.next<'EffectChainId'>(),
    slots: [instantiateProcessor(ids.next<'ProcessorId'>(), filter)],
  };
}

/** The world of the guided workflows' tests, over the fixtures' sample project. */
export function workflowWorld(fixture: SampleProject): WorkflowWorld {
  const { ids } = fixture;
  const { footstep, ambience } = fixture.assets;
  const [walk] = fixture.project.regions.values();
  if (walk === undefined) throw new Error('The sample project has its walk loop region.');
  const door: Region = {
    id: ids.next<'RegionId'>(),
    assetId: ambience.id,
    displayName: 'Door slam',
    basis: 0,
    start: derivedSampleCount(48_000),
    end: derivedSampleCount(96_000),
    tags: [],
    operations: [],
  };
  const sourced = withSources(
    { ...fixture.project, regions: new Map(fixture.project.regions).set(door.id, door) },
    (_asset, index) => ({
      media: {
        kind: 'managed',
        contentId: contentIdOfDigit(String(index + 1)),
        byteLength: 96_044,
        mediaType: 'audio/wav',
      },
    }),
  );
  const chain = filterChain(ids);
  const sfx: GameAssetGroup = {
    id: ids.next<'GameAssetGroupId'>(),
    name: 'SFX',
    policy: { loudness: { integratedLufs: -16, toleranceLu: 1, truePeakCeilingDbtp: -1 } },
  };
  const footsteps: GameAssetGroup = {
    id: ids.next<'GameAssetGroupId'>(),
    name: 'Footsteps',
    parent: sfx.id,
    policy: { processing: chain.id },
  };
  const dialogue: GameAssetGroup = {
    id: ids.next<'GameAssetGroupId'>(),
    name: 'Dialogue',
    policy: { loudness: { integratedLufs: -23, toleranceLu: 1, truePeakCeilingDbtp: -2 } },
  };
  const members: WorkflowWorld['members'] = {
    footstep: { kind: 'asset', asset: footstep.id },
    ambience: { kind: 'asset', asset: ambience.id },
    walk: { kind: 'region', region: walk.id },
    door: { kind: 'region', region: door.id },
  };
  const state = applied(workflowBus(), sourced, [
    addGroupInvocation(sfx),
    addGroupInvocation(footsteps, chain),
    addGroupInvocation(dialogue),
    assignMemberInvocation(members.footstep, footsteps.id, 'inherit'),
    assignMemberInvocation(members.walk, footsteps.id, 'own'),
    assignMemberInvocation(members.door, sfx.id, 'inherit'),
  ]);
  const assetOf = (asset: Asset): Asset => {
    const held = state.project.assets.get(asset.id);
    if (held === undefined) throw new Error('The state lost an asset.');
    return held;
  };
  return {
    state,
    ids,
    assets: { footstep: assetOf(footstep), ambience: assetOf(ambience) },
    regions: { walk, door },
    groups: { sfx, footsteps, dialogue },
    chain,
    members,
  };
}
