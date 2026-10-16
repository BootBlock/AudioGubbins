import { describe, expect, it } from 'vitest';

import {
  AssetOrigin,
  StandardLayouts,
  createDeterministicIdGenerator,
  fail,
  failure,
  FailureKind,
  sampleCount,
  sampleRate,
  succeed,
  type Asset,
  type ChannelLayout,
  type DomainFailure,
  type IdGenerator,
  type Project,
  type Region,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  BUILT_IN_PRESETS,
  batchProgress,
  escapeTemplateText,
  exportBatch,
  plannedExport,
  resolvePreset,
  type CodecLookup,
  type ExportContext,
  type ExportPreset,
} from '@audiogubbins/import-export';

import type { GameAssetGroup } from '../groups/game-asset-group.js';
import type { GameAudioState } from '../groups/game-audio-state.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';
import type { GroupMember, GroupMembership } from '../groups/membership.js';
import { validateGameAudioState } from '../groups/state-validation.js';
import type { InheritedPolicy, PolicyOverrides } from '../policy/inherited-policy.js';
import { worldProject } from '../testing/random-game-state.js';
import { destinationPath } from './destination-path.js';
import { planGameExport, type GameExportItem, type GameExportPlan } from './game-export-plan.js';
import { profileFromPreset } from './game-export-profile.js';
import { namingTemplate, type NamingTemplate } from './naming-template.js';

/** 2026-10-16 09:00 UTC. */
const CLOCK = { epochMilliseconds: Date.UTC(2026, 9, 16, 9), utcOffsetMinutes: 0 };
const RATE = 48_000;

/** A writer of integer and float PCM in WAV, at any rate, of at most two channels. */
const PCM: NonNullable<ReturnType<CodecLookup>> = {
  id: 'pcm',
  name: 'PCM',
  lossless: true,
  codes: { waveFormatTags: [], aifcCompressionTypes: [] },
  read: undefined,
  write: {
    implementation: 'application',
    containers: ['wav'],
    reproducible: true,
    licence: 'Apache-2.0',
    sampleRates: { kind: 'any', minimum: 8_000, maximum: 384_000 },
    maximumChannels: 2,
  },
};
const codecs: CodecLookup = (id) => (id === 'pcm' ? PCM : undefined);

function preset(id: string): ExportPreset {
  const found = BUILT_IN_PRESETS.find((one) => one.id === id);
  if (found === undefined) throw new Error(`No built-in preset ${id}.`);
  return found;
}

const WAV_16 = preset('game-wav-16-48k');
const WAV_16_PROFILE = profileFromPreset(WAV_16);
const FLOAT_PROFILE = profileFromPreset(preset('master-wav-float'));

function template(source: string): NamingTemplate {
  return expectSuccess(namingTemplate(source));
}

function asset(ids: IdGenerator, name: string, seconds: number, layout: ChannelLayout): Asset {
  return {
    id: ids.next<'AssetId'>(),
    displayName: name,
    origin: AssetOrigin.Imported,
    sampleRate: expectSuccess(sampleRate(RATE)),
    channelLayout: layout,
    length: expectSuccess(sampleCount(seconds * RATE)),
    storageKey: `plan:${name}`,
    edits: [],
  };
}

function region(ids: IdGenerator, of: Asset, name: string, start: number, length: number): Region {
  return {
    id: ids.next<'RegionId'>(),
    assetId: of.id,
    displayName: name,
    basis: 0,
    start: expectSuccess(sampleCount(start)),
    end: expectSuccess(sampleCount(start + length)),
    tags: [],
    operations: [],
  };
}

/** Each member's audio as the export reads it: the asset it is, or its region's, with that asset's regions. */
function contextsOf(project: Project): (member: GroupMember) => ReturnType<typeof contextOf> {
  return (member) => contextOf(project, member);
}

function contextOf(
  project: Project,
  member: GroupMember,
): ReturnType<Parameters<typeof planGameExport>[3]> {
  const id = member.kind === 'asset' ? member.asset : project.regions.get(member.region)?.assetId;
  const audio = id === undefined ? undefined : project.assets.get(id);
  if (audio === undefined) throw new Error('The fixture describes only what the project holds.');
  const described = {
    sampleRate: audio.sampleRate,
    layout: audio.channelLayout,
    precision: { kind: 'integer', bits: 24 } as const,
  };
  const context: ExportContext = {
    codecs,
    source: {
      ...described,
      name: audio.displayName,
      length: audio.length,
      regions: [...project.regions.values()]
        .filter((one) => one.assetId === audio.id)
        .map((one) => ({
          ...described,
          id: one.id,
          name: one.displayName,
          start: one.start,
          length: expectSuccess(sampleCount(one.end - one.start)),
        })),
    },
  };
  return succeed(context);
}

function group(
  id: string,
  name: string,
  policy: InheritedPolicy,
  parent?: GameAssetGroupId,
): GameAssetGroup {
  return {
    id: id as GameAssetGroupId,
    name,
    policy,
    ...(parent === undefined ? {} : { parent }),
  };
}

function membership(
  member: GroupMember,
  of: GameAssetGroup,
  overrides: PolicyOverrides = {},
): GroupMembership {
  return { member, group: of.id, processing: 'own', overrides };
}

function regionMember(one: Region): GroupMember {
  return { kind: 'region', region: one.id };
}

/** A validated state of `groups` and `memberships`. */
function stateOf(
  project: Project,
  groups: readonly GameAssetGroup[],
  memberships: readonly GroupMembership[],
): GameAudioState {
  return expectSuccess(
    validateGameAudioState(project, {
      groups: new Map(groups.map((one) => [one.id, one])),
      memberships,
    }),
  );
}

function planned(item: GameExportItem | undefined): Extract<GameExportItem, { kind: 'planned' }> {
  if (item?.kind !== 'planned') {
    throw new Error(`Expected a planned item: ${JSON.stringify(item)}`);
  }
  return item;
}

function refusals(item: GameExportItem | undefined): readonly DomainFailure[] {
  if (item?.kind !== 'refused') throw new Error(`Expected a refused item: ${JSON.stringify(item)}`);
  return item.failures;
}

function stems(plan: GameExportPlan): readonly (string | undefined)[] {
  return plan.items.map((item) => (item.kind === 'planned' ? item.file.name.stem : undefined));
}

/**
 * Footsteps (WAV 16-bit at 48 kHz, `{group:snake}_{number}`, into `sfx`) ⊃
 * Grass, which sets nothing; three steps of one recording in Grass, and a
 * mono impact asset in Footsteps.
 */
function footsteps() {
  const ids = createDeterministicIdGenerator(10);
  const recording = asset(ids, 'Field recording', 60, StandardLayouts.stereo);
  const impact = asset(ids, 'Impact', 1, StandardLayouts.mono);
  const steps = [
    region(ids, recording, 'Left step', 0, 12_000),
    region(ids, recording, 'Right step', 24_000, 12_000),
    region(ids, recording, 'Scuff', 48_000, 6_000),
  ];
  const project = worldProject(ids, { assets: [recording, impact], regions: steps });
  const sfx = expectSuccess(destinationPath(['sfx']));
  const outer = group('group-footsteps', 'Footsteps', {
    exportProfile: WAV_16_PROFILE,
    naming: template('{group:snake}_{number}'),
    destination: sfx,
  });
  const grass = group('group-grass', 'Grass', {}, outer.id);
  const members = steps.map(regionMember);
  const impactMember: GroupMember = { kind: 'asset', asset: impact.id };
  return { ids, project, recording, impact, steps, outer, grass, members, impactMember };
}

describe('the game export plan', () => {
  it("plans each member as the export its group's profile, naming and folder give, in the request's order", () => {
    const world = footsteps();
    const state = stateOf(
      world.project,
      [world.outer, world.grass],
      [
        ...world.members.map((member) => membership(member, world.grass)),
        membership(world.impactMember, world.outer),
      ],
    );
    const request = { members: [world.impactMember, ...world.members], clock: CLOCK };
    const plan = planGameExport(world.project, state, request, contextsOf(world.project));

    expect(plan.items.map((item) => item.member)).toEqual(request.members);
    expect(stems(plan)).toEqual(['footsteps_1', 'grass_1', 'grass_2', 'grass_3']);
    const second = planned(plan.items[2]);
    const context = expectSuccess(contextOf(world.project, second.member));
    expect(second.settings).toEqual({
      ...resolvePreset(WAV_16, context),
      range: { kind: 'region', region: world.steps[1]?.id },
      fileName: 'grass_2',
    });
    expect(second.destination).toEqual({ segments: ['sfx'] });
    const fromOuter = { kind: 'group', group: world.outer.id, path: ['Footsteps'] };
    expect(second.provenance).toEqual({
      exportProfile: fromOuter,
      naming: fromOuter,
      destination: fromOuter,
    });
    expect(second.file.span.start).toBe(24_000);
    expect(second.file.span.length).toBe(12_000);
    expect(second.file.target.extension).toBe('wav');
    expect(planned(plan.items[0]).settings.range).toEqual({ kind: 'project' });
  });

  it('counts {number} within the group, so a member is named the same whatever else is exported', () => {
    const world = footsteps();
    const many = Array.from({ length: 9 }, (_, index) =>
      region(world.ids, world.recording, `Step ${String(index)}`, index * 6_000, 6_000),
    );
    const project = worldProject(world.ids, {
      assets: [world.recording],
      regions: [...world.steps, ...many],
    });
    const members = [...world.steps, ...many].map(regionMember);
    const state = stateOf(
      project,
      [world.outer, world.grass],
      members.map((member) => membership(member, world.grass)),
    );
    const third = members[2];
    if (third === undefined) throw new Error('The fixture has twelve members.');
    const alone = planGameExport(
      project,
      state,
      { members: [third], clock: CLOCK },
      contextsOf(project),
    );
    expect(stems(alone)).toEqual(['grass_03']);
  });

  it("names a file by the profile's extension, the clock's date and the group's path", () => {
    const world = footsteps();
    const grass = group(
      'group-grass',
      'Grass',
      {
        naming: template('{group-path:kebab} {region:pascal} {date}.{format}'),
      },
      world.outer.id,
    );
    const state = stateOf(
      world.project,
      [world.outer, grass],
      [membership(world.members[0] ?? world.impactMember, grass)],
    );
    const plan = planGameExport(
      world.project,
      state,
      { members: state.memberships.map((one) => one.member), clock: CLOCK },
      contextsOf(world.project),
    );
    expect(stems(plan)).toEqual(['footsteps-grass LeftStep 2026-10-16.wav']);
  });

  it('writes a brace in a name into the settings as a brace, never a token', () => {
    const world = footsteps();
    const odd = region(world.ids, world.recording, 'Step {index}', 0, 100);
    const project = worldProject(world.ids, { assets: [world.recording], regions: [odd] });
    const grass = group('group-grass', 'Grass', { naming: template('{region}') }, world.outer.id);
    const member = regionMember(odd);
    const state = stateOf(project, [world.outer, grass], [membership(member, grass)]);
    const item = planned(
      planGameExport(project, state, { members: [member], clock: CLOCK }, contextsOf(project))
        .items[0],
    );
    expect(item.settings.fileName).toBe(escapeTemplateText('Step {index}'));
    expect(item.file.name.stem).toBe('Step {index}');
  });

  it("takes a member's overrides over its group's, and names the override as their source", () => {
    const world = footsteps();
    const [first, second] = world.members;
    if (first === undefined || second === undefined) throw new Error('The fixture has steps.');
    const naming = template('{region:snake}');
    const destination = expectSuccess(destinationPath(['sfx', 'loud']));
    const state = stateOf(
      world.project,
      [world.outer, world.grass],
      [
        membership(first, world.grass, { naming, destination, exportProfile: FLOAT_PROFILE }),
        membership(second, world.grass),
      ],
    );
    const plan = planGameExport(
      world.project,
      state,
      { members: [first, second], clock: CLOCK },
      contextsOf(world.project),
    );
    const overridden = planned(plan.items[0]);
    const override = { kind: 'override', member: first };
    expect(overridden.provenance).toEqual({
      exportProfile: override,
      naming: override,
      destination: override,
    });
    expect(overridden.file.name.stem).toBe('left_step');
    expect(overridden.destination).toEqual({ segments: ['sfx', 'loud'] });
    expect(overridden.settings.encoding).toEqual({ kind: 'float', bits: 32 });
    expect(planned(plan.items[1]).settings.encoding).toEqual({ kind: 'integer', bits: 16 });
  });

  it('sends a file to the folder exported to where no group sets a destination', () => {
    const world = footsteps();
    const bare = group('group-bare', 'Bare', {
      exportProfile: WAV_16_PROFILE,
      naming: template('{region}'),
    });
    const member = world.members[0] ?? world.impactMember;
    const state = stateOf(world.project, [bare], [membership(member, bare)]);
    const item = planned(
      planGameExport(
        world.project,
        state,
        { members: [member], clock: CLOCK },
        contextsOf(world.project),
      ).items[0],
    );
    expect(item.destination).toEqual({ segments: [] });
    expect(item.provenance.destination).toEqual({ kind: 'unset' });
  });
});

describe('a refused member', () => {
  it('names every policy it lacks at once', () => {
    const world = footsteps();
    const bare = group('group-bare', 'Bare', {});
    const member = world.members[0] ?? world.impactMember;
    const state = stateOf(world.project, [bare], [membership(member, bare)]);
    const plan = planGameExport(
      world.project,
      state,
      { members: [member], clock: CLOCK },
      contextsOf(world.project),
    );
    const failures = refusals(plan.items[0]);
    expect(failures.map((one) => one.code)).toEqual([
      'game.export-profile-unset',
      'game.export-naming-unset',
    ]);
    expect(failures[0]?.details).toEqual({ member: `region:${String(world.steps[0]?.id)}` });
    expect(failures[0]?.summary).toBe(
      'No group from "Bare" up sets the export profile of the region "Left step", and it overrides none; set one on a group it is in.',
    );
  });

  it('is refused for its own audio, naming the group whose profile it cannot take, and refuses no other', () => {
    const world = footsteps();
    const surround = asset(world.ids, 'Crowd', 2, StandardLayouts.surround5_1);
    const project = worldProject(world.ids, {
      assets: [world.recording, surround],
      regions: world.steps,
    });
    const crowd: GroupMember = { kind: 'asset', asset: surround.id };
    const members = [world.members[0] ?? crowd, crowd];
    const state = stateOf(
      project,
      [world.outer, world.grass],
      members.map((member) => membership(member, world.grass)),
    );
    const plan = planGameExport(project, state, { members, clock: CLOCK }, contextsOf(project));

    planned(plan.items[0]);
    const [refusal, ...rest] = refusals(plan.items[1]);
    expect(rest.map((one) => one.code)).toEqual(rest.map(() => 'game.policy-profile-invalid'));
    expect(refusal?.code).toBe('game.policy-profile-invalid');
    expect(refusal?.details).toEqual({
      field: 'exportProfile',
      owner: 'group',
      group: 'group-footsteps',
      groupPath: 'Footsteps',
      member: `asset:${surround.id}`,
    });
    expect(refusal?.cause?.code).toBe('import-export.too-many-channels');
    expect(refusal?.summary).toMatch(
      /^The group "Footsteps" sets its export profile with what the asset "Crowd" cannot be exported by: /u,
    );
  });

  it('names the member as the owner of a profile it overrides', () => {
    const world = footsteps();
    const member = world.members[0] ?? world.impactMember;
    const fast = profileFromPreset({
      id: 'too-fast',
      name: 'Too fast',
      format: 'wav',
      settings: { sampleRate: expectSuccess(sampleRate(768_000)) },
    });
    const state = stateOf(
      world.project,
      [world.outer, world.grass],
      [membership(member, world.grass, { exportProfile: fast })],
    );
    const plan = planGameExport(
      world.project,
      state,
      { members: [member], clock: CLOCK },
      contextsOf(world.project),
    );
    const [refusal] = refusals(plan.items[0]);
    expect(refusal?.code).toBe('game.policy-profile-invalid');
    expect(refusal?.details).toMatchObject({
      owner: 'member',
      member: `region:${String(world.steps[0]?.id)}`,
    });
    expect(refusal?.summary).toMatch(/^The region "Left step" overrides its export profile/u);
  });

  it('keeps the refusal of a context as it is, which is no policy of the group', () => {
    const world = footsteps();
    const state = stateOf(
      world.project,
      [world.outer, world.grass],
      world.members.map((member) => membership(member, world.grass)),
    );
    const gone = failure('storage.asset-missing', FailureKind.Rejected, 'The audio is gone.');
    const plan = planGameExport(
      world.project,
      state,
      { members: world.members, clock: CLOCK },
      (member) => (member === world.members[1] ? fail(gone) : contextOf(world.project, member)),
    );
    expect(refusals(plan.items[1])).toEqual([gone]);
    expect(stems(plan)).toEqual(['grass_1', undefined, 'grass_3']);
  });

  it("keeps the export's refusal of a range its context does not hold as the export's", () => {
    const world = footsteps();
    const member = world.members[0] ?? world.impactMember;
    const state = stateOf(
      world.project,
      [world.outer, world.grass],
      [membership(member, world.grass)],
    );
    const plan = planGameExport(
      world.project,
      state,
      { members: [member], clock: CLOCK },
      (asked) =>
        succeed({
          ...expectSuccess(contextOf(world.project, asked)),
          source: { ...expectSuccess(contextOf(world.project, asked)).source, regions: [] },
        }),
    );
    expect(refusals(plan.items[0]).map((one) => one.code)).toEqual([
      'import-export.range-region-unknown',
    ]);
  });

  it('refuses {region} for a whole asset, and a name that would be nothing', () => {
    const world = footsteps();
    const blank = region(world.ids, world.recording, '!?', 0, 100);
    const project = worldProject(world.ids, {
      assets: [world.recording, world.impact],
      regions: [blank],
    });
    const named = group('group-named', 'Named', {
      exportProfile: WAV_16_PROFILE,
      naming: template('{region:snake}'),
    });
    const members = [world.impactMember, regionMember(blank)];
    const state = stateOf(
      project,
      [named],
      members.map((member) => membership(member, named)),
    );
    const plan = planGameExport(project, state, { members, clock: CLOCK }, contextsOf(project));
    expect(plan.items.map((item) => refusals(item).map((one) => one.code))).toEqual([
      ['game.export-region-token-for-asset'],
      ['game.member-name-empty'],
    ]);
  });

  it('refuses a member in no group and one the project does not hold', () => {
    const world = footsteps();
    const state = stateOf(world.project, [world.outer], []);
    const stranger: GroupMember = { kind: 'asset', asset: world.ids.next<'AssetId'>() };
    const plan = planGameExport(
      world.project,
      state,
      { members: [world.impactMember, stranger], clock: CLOCK },
      contextsOf(world.project),
    );
    expect(plan.items.map((item) => refusals(item).map((one) => one.code))).toEqual([
      ['game.member-in-no-group'],
      ['game.member-unknown'],
    ]);
  });
});

describe('names that collide', () => {
  /** The steps in Grass, named by `naming` with `overrides` for the first. */
  function collide(naming: string, overrides: PolicyOverrides = {}) {
    const world = footsteps();
    const grass = group('group-grass', 'Grass', { naming: template(naming) }, world.outer.id);
    const [first, ...rest] = world.members;
    if (first === undefined) throw new Error('The fixture has steps.');
    const state = stateOf(
      world.project,
      [world.outer, grass],
      [membership(first, grass, overrides), ...rest.map((member) => membership(member, grass))],
    );
    return {
      world,
      plan: planGameExport(
        world.project,
        state,
        { members: world.members, clock: CLOCK },
        contextsOf(world.project),
      ),
    };
  }

  it('refuses every item whose file would be another one, naming both and whose templates named them', () => {
    const { world, plan } = collide('{group}', { naming: template('GRASS') });
    expect(plan.items.map((item) => item.kind)).toEqual(['refused', 'refused', 'refused']);
    const [left, right, scuff] = world.steps.map((one) => `region:${one.id}`);
    const first = refusals(plan.items[0]);
    expect(first.map((one) => one.details?.['other'])).toEqual([right, scuff]);
    expect(first[0]?.code).toBe('game.export-names-collide');
    expect(first[0]?.details).toEqual({
      member: left,
      other: right,
      name: 'GRASS.wav',
      folder: 'sfx',
      namingOwner: 'member',
      otherNamingOwner: 'group',
      otherNamingGroup: 'group-grass',
      otherNamingGroupPath: 'Footsteps/Grass',
    });
    expect(first[0]?.summary).toBe(
      'Both the region "Left step" and the region "Right step" would be exported as "GRASS.wav" in the folder "sfx", one file over the other. The region "Left step" names the first. The group "Footsteps/Grass" names the second. Give one a template that tells them apart.',
    );
    expect(refusals(plan.items[2]).map((one) => one.details?.['other'])).toEqual([left, right]);
  });

  it('collides names as a case-insensitive file system does, in NFC lower case after they are made safe', () => {
    const { plan } = collide('Café:{group}', { naming: template('CAFÉ_GRASS') });
    expect(refusals(plan.items[0]).map((one) => one.details?.['other'])).toHaveLength(2);
  });

  it('lets the same name into different folders', () => {
    const { plan } = collide('{group}', {
      destination: expectSuccess(destinationPath(['sfx', 'left'])),
    });
    expect(plan.items.map((item) => item.kind)).toEqual(['planned', 'refused', 'refused']);
  });

  it('never collides a refused member with a planned one', () => {
    const world = footsteps();
    const surround = asset(world.ids, 'Grass', 2, StandardLayouts.surround5_1);
    const project = worldProject(world.ids, {
      assets: [world.recording, surround],
      regions: world.steps,
    });
    const named = group('group-named', 'Named', {
      exportProfile: WAV_16_PROFILE,
      naming: template('{asset}'),
    });
    const members: GroupMember[] = [
      { kind: 'asset', asset: surround.id },
      world.members[0] ?? world.impactMember,
    ];
    const state = stateOf(
      project,
      [named],
      members.map((member) => membership(member, named)),
    );
    const plan = planGameExport(project, state, { members, clock: CLOCK }, contextsOf(project));
    expect(plan.items.map((item) => item.kind)).toEqual(['refused', 'planned']);
    expect(stems(plan)).toEqual([undefined, 'Field recording']);
  });
});

describe('a long recording cut into many regions', () => {
  it('plans as many exports, each reading its span of the one recording, run as one batch', () => {
    const ids = createDeterministicIdGenerator(30);
    const recording = asset(ids, 'Ten minute walk', 600, StandardLayouts.stereo);
    const cuts = Array.from({ length: 120 }, (_, index) =>
      region(ids, recording, `Step ${String(index + 1)}`, index * 5 * RATE, 2 * RATE),
    );
    const project = worldProject(ids, { assets: [recording], regions: cuts });
    const steps = group('group-steps', 'Steps', {
      exportProfile: WAV_16_PROFILE,
      naming: template('{asset:snake}_{number}'),
    });
    const members = cuts.map(regionMember);
    const state = stateOf(
      project,
      [steps],
      members.map((member) => membership(member, steps)),
    );
    const plan = planGameExport(project, state, { members, clock: CLOCK }, contextsOf(project));

    const items = plan.items.map(planned);
    expect(items).toHaveLength(120);
    expect(items.map((item) => item.file.name.stem)).toEqual(
      cuts.map((_, index) => `ten_minute_walk_${String(index + 1).padStart(3, '0')}`),
    );
    expect(new Set(items.map((item) => item.file.span.region?.id)).size).toBe(120);
    for (const [index, item] of items.entries()) {
      expect(item.file.span.start).toBe(index * 5 * RATE);
      expect(item.file.span.length).toBe(2 * RATE);
      expect(item.file.span.audio.layout).toBe(recording.channelLayout);
    }
    expect([...project.assets.keys()]).toEqual([recording.id]);

    const batch = exportBatch(
      items.map((item) => plannedExport(item.file.name.stem, item.file.render.range.length)),
    );
    expect(batchProgress(batch)).toEqual({
      jobsSettled: 0,
      jobsTotal: 120,
      framesRendered: 0,
      framesTotal: 120 * 2 * RATE,
    });
  });
});
