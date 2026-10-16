/**
 * The game export plan (ADR-0102): for a list of members, one item each, the
 * member planned as one Phase 09 export or refused with every reason, each
 * naming the group or override it comes from.
 *
 * A planned item is ordinary: its settings are what the member's effective
 * profile resolves to for its own audio, as `resolvePreset` resolves any
 * preset, with the member's range and the literal name its effective naming
 * template gives it, and its file is what `planExport` plans from them. So
 * the planned items run as one Phase 09 `ExportBatch`, one job each, and a
 * later batch job takes the same items. Many regions of one long recording
 * are many items reading that one asset, never a copy of it.
 *
 * A value the member's audio cannot take is refused for that member, re-stated
 * as `game.policy-profile-invalid` with the owner of the profile and the
 * export's own refusal as its cause; a range the member's context does not
 * hold is the export's refusal as it is. Two planned items whose files would
 * be one file in one folder are both refused before anything renders. A
 * refused item refuses no other, and nothing is planned that is not whole.
 *
 * Pure over its arguments: no clock is read, no file written, and a
 * collision with a file already at the destination is the delivery's to
 * decide (ADR-0092).
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type Project,
} from '@audiogubbins/domain';
import {
  exportTarget,
  planExport,
  resolvePreset,
  safeFileName,
  type ExportClock,
  type ExportContext,
  type ExportSettings,
  type PlannedFile,
} from '@audiogubbins/import-export';

import type { GameAudioState } from '../groups/game-audio-state.js';
import { pathText } from '../groups/group-names.js';
import { memberKey, type GroupMember } from '../groups/membership.js';
import {
  resolveAll,
  type EffectivePolicy,
  type PolicySource,
} from '../policy/policy-resolution.js';
import { ownerDetails, ownerWords, type PolicyOwner } from '../policy/policy-validation.js';
import type { DestinationPath } from './destination-path.js';
import { profilePreset, type GameExportProfile } from './game-export-profile.js';
import { memberExportSettings } from './member-export-settings.js';
import { memberNamings, memberStem, type MemberNaming } from './member-names.js';
import type { NamingTemplate } from './naming-template.js';

export interface GameExportRequest {
  /** The members to export, in the order the plan answers them. */
  readonly members: readonly GroupMember[];

  /** When the export is asked for, which `{date}` reads. */
  readonly clock: ExportClock;
}

/** Where each value that made a planned item's settings, name and folder comes from. */
export interface GameExportProvenance {
  readonly exportProfile: PolicySource;
  readonly naming: PolicySource;
  readonly destination: PolicySource;
}

export type GameExportItem =
  | {
      readonly kind: 'planned';
      readonly member: GroupMember;
      readonly settings: ExportSettings;
      /** Phase 09's planned file: one per item, named as the member's naming names it. */
      readonly file: PlannedFile;
      /** The folder inside the one exported to that the file goes to; none where none is set. */
      readonly destination: DestinationPath;
      readonly provenance: GameExportProvenance;
    }
  | {
      readonly kind: 'refused';
      readonly member: GroupMember;
      readonly failures: readonly [DomainFailure, ...DomainFailure[]];
    };

export interface GameExportPlan {
  /** One item for each member asked about, in the request's order. */
  readonly items: readonly GameExportItem[];
}

type PlannedItem = Extract<GameExportItem, { readonly kind: 'planned' }>;
type RefusedItem = Extract<GameExportItem, { readonly kind: 'refused' }>;

/** A member planned alone, with what a collision names it by. */
interface Drafted {
  readonly kind: 'drafted';
  readonly item: PlannedItem;
  readonly naming: MemberNaming;
  readonly namingOwner: PolicyOwner;
}

/** What the plan reads for every member: its policy, its naming values, its audio. */
interface Planning {
  readonly policyOf: (member: GroupMember) => EffectivePolicy;
  readonly namingOf: (member: GroupMember) => DomainResult<MemberNaming>;
  readonly contextOf: (member: GroupMember) => DomainResult<ExportContext>;
  readonly clock: ExportClock;
}

/** The folder a member's file goes to where nothing sets one: the folder exported to. */
const NO_FOLDER: DestinationPath = { segments: [] };

/** The prefix of the export's refusals of a range, which are the member's audio's, not its profile's. */
const RANGE_REFUSAL = 'import-export.range-';

/** A value a group or an override sets. */
type SetSource = Exclude<PolicySource, { readonly kind: 'unset' }>;

/** The member's own name: its region's, or its asset's. */
function nameOf(naming: MemberNaming): string {
  return naming.region ?? naming.asset;
}

/** The member as a refusal names it. */
function memberWords(member: GroupMember, naming: MemberNaming): string {
  return `the ${member.kind} "${nameOf(naming)}"`;
}

/** The owner of a value `source` sets, as a refusal names it. */
function ownerOf(source: SetSource, member: GroupMember, naming: MemberNaming): PolicyOwner {
  return source.kind === 'group'
    ? { kind: 'group', group: source.group, path: source.path }
    : { kind: 'member', member, name: nameOf(naming) };
}

/** Both results' values, or the failures of either, the first's first. */
function together<A, B>(a: DomainResult<A>, b: DomainResult<B>): DomainResult<readonly [A, B]> {
  if (!a.ok) return fail(...a.failures, ...(b.ok ? [] : b.failures));
  if (!b.ok) return b;
  return succeed([a.value, b.value]);
}

function unset(
  code: string,
  member: GroupMember,
  naming: MemberNaming,
  what: string,
): DomainFailure {
  return failure(
    code,
    FailureKind.Rejected,
    `No group from "${pathText(naming.groupPath)}" up sets the ${what} of ${memberWords(member, naming)}, and it overrides none; set one on a group it is in.`,
    { details: { member: memberKey(member) } },
  );
}

/** The member's effective profile with its owner, or why it has none. */
function profileOf(
  policy: EffectivePolicy,
  member: GroupMember,
  naming: MemberNaming,
): DomainResult<{ readonly profile: GameExportProfile; readonly owner: PolicyOwner }> {
  const { value, source } = policy.exportProfile;
  if (value === undefined || source.kind === 'unset') {
    return fail(unset('game.export-profile-unset', member, naming, 'export profile'));
  }
  return succeed({ profile: value, owner: ownerOf(source, member, naming) });
}

/** The member's effective naming template with its owner, or why it has none. */
function templateOf(
  policy: EffectivePolicy,
  member: GroupMember,
  naming: MemberNaming,
): DomainResult<{ readonly template: NamingTemplate; readonly owner: PolicyOwner }> {
  const { value, source } = policy.naming;
  if (value === undefined || source.kind === 'unset') {
    return fail(unset('game.export-naming-unset', member, naming, 'naming template'));
  }
  return succeed({ template: value, owner: ownerOf(source, member, naming) });
}

/** The export's refusal of the profile for this member, re-stated as the profile owner's. */
function profileRefusal(
  cause: DomainFailure,
  owner: PolicyOwner,
  member: GroupMember,
  naming: MemberNaming,
): DomainFailure {
  const verb = owner.kind === 'group' ? 'sets' : 'overrides';
  return failure(
    'game.policy-profile-invalid',
    FailureKind.Rejected,
    `${ownerWords(owner)} ${verb} its export profile with what ${memberWords(member, naming)} cannot be exported by: ${cause.summary}`,
    {
      details: { field: 'exportProfile', ...ownerDetails(owner), member: memberKey(member) },
      cause,
    },
  );
}

/** The member's one planned file, or its refusals with the profile's owner named. */
function plannedFile(
  settings: ExportSettings,
  context: ExportContext,
  clock: ExportClock,
  owner: PolicyOwner,
  member: GroupMember,
  naming: MemberNaming,
): DomainResult<PlannedFile> {
  const planned = planExport(settings, context, clock);
  if (!planned.ok) {
    const restated = (cause: DomainFailure): DomainFailure =>
      cause.code.startsWith(RANGE_REFUSAL) ? cause : profileRefusal(cause, owner, member, naming);
    const [first, ...rest] = planned.failures;
    return fail(restated(first), ...rest.map(restated));
  }
  const [file, ...others] = planned.value;
  // A region's range and a whole asset's are each one span, so one file.
  if (file === undefined || others.length > 0) {
    throw new Error(`Member ${memberKey(member)} planned ${String(planned.value.length)} files.`);
  }
  return succeed(file);
}

/**
 * The extension of the file `profile` makes of the member's audio, which
 * `{format}` reads. It is the target the profile resolves to for this audio,
 * resolved again with the name as the settings: the name cannot come first.
 */
function extensionOf(profile: GameExportProfile, context: ExportContext): string {
  return exportTarget(resolvePreset(profilePreset(profile), context)).extension;
}

/** One member planned alone, or every reason it cannot be; collisions are found across items after. */
function planMember(member: GroupMember, planning: Planning): Drafted | RefusedItem {
  const naming = planning.namingOf(member);
  if (!naming.ok) return { kind: 'refused', member, failures: naming.failures };
  const values = naming.value;
  const policy = planning.policyOf(member);
  const ready = together(
    together(profileOf(policy, member, values), templateOf(policy, member, values)),
    planning.contextOf(member),
  );
  if (!ready.ok) return { kind: 'refused', member, failures: ready.failures };
  const [[{ profile, owner }, { template, owner: namingOwner }], context] = ready.value;
  const extension = extensionOf(profile, context);
  const stem = memberStem(template, { ...values, clock: planning.clock, extension }, member);
  if (!stem.ok) return { kind: 'refused', member, failures: stem.failures };
  const settings = memberExportSettings(profile, member, context, stem.value);
  const file = plannedFile(settings, context, planning.clock, owner, member, values);
  if (!file.ok) return { kind: 'refused', member, failures: file.failures };
  return {
    kind: 'drafted',
    naming: values,
    namingOwner,
    item: {
      kind: 'planned',
      member,
      settings,
      file: file.value,
      destination: policy.destination.value ?? NO_FOLDER,
      provenance: {
        exportProfile: policy.exportProfile.source,
        naming: policy.naming.source,
        destination: policy.destination.source,
      },
    },
  };
}

function folded(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

/**
 * Where a drafted file would land, as a case-insensitive file system tells
 * files apart: its folders and its safe name, each in NFC lower case.
 */
function landingKey({ item }: Drafted): string {
  const name = safeFileName(item.file.name);
  return JSON.stringify([...item.destination.segments.map(folded), folded(name)]);
}

/** The details naming the owner of a naming template, under `prefix`. */
function namingOwnerDetails(prefix: string, owner: PolicyOwner): Readonly<Record<string, string>> {
  return owner.kind === 'group'
    ? {
        [`${prefix}Owner`]: 'group',
        [`${prefix}Group`]: owner.group,
        [`${prefix}GroupPath`]: pathText(owner.path),
      }
    : { [`${prefix}Owner`]: 'member' };
}

/** That `draft`'s file would be `other`'s, naming both members and whose templates named them. */
function collision(draft: Drafted, other: Drafted): DomainFailure {
  const name = safeFileName(draft.item.file.name);
  const { segments } = draft.item.destination;
  const folder =
    segments.length === 0 ? 'the folder exported to' : `the folder "${segments.join('/')}"`;
  return failure(
    'game.export-names-collide',
    FailureKind.Rejected,
    `Both ${memberWords(draft.item.member, draft.naming)} and ${memberWords(other.item.member, other.naming)} would be exported as "${name}" in ${folder}, one file over the other. ${ownerWords(draft.namingOwner)} names the first. ${ownerWords(other.namingOwner)} names the second. Give one a template that tells them apart.`,
    {
      details: {
        member: memberKey(draft.item.member),
        other: memberKey(other.item.member),
        name,
        folder: segments.join('/'),
        ...namingOwnerDetails('naming', draft.namingOwner),
        ...namingOwnerDetails('otherNaming', other.namingOwner),
      },
    },
  );
}

/** Each draft as the plan's item: planned, or refused for every other draft whose file it would be. */
function settled(drafts: readonly (Drafted | RefusedItem)[]): readonly GameExportItem[] {
  const landings = new Map<string, Drafted[]>();
  for (const draft of drafts) {
    if (draft.kind !== 'drafted') continue;
    const key = landingKey(draft);
    const landing = landings.get(key);
    if (landing === undefined) landings.set(key, [draft]);
    else landing.push(draft);
  }
  return drafts.map((draft): GameExportItem => {
    if (draft.kind !== 'drafted') return draft;
    const others = (landings.get(landingKey(draft)) ?? []).filter((one) => one !== draft);
    const [first, ...rest] = others.map((other) => collision(draft, other));
    return first === undefined
      ? draft.item
      : { kind: 'refused', member: draft.item.member, failures: [first, ...rest] };
  });
}

/**
 * The plan of exporting `request`'s members of `project` under its validated
 * game-audio `state`: one item for each, in the request's order. `contextOf`
 * describes each member's audio, the asset it is or the asset its region is
 * of, and its refusal refuses that member alone.
 */
export function planGameExport(
  project: Project,
  state: GameAudioState,
  request: GameExportRequest,
  contextOf: (member: GroupMember) => DomainResult<ExportContext>,
): GameExportPlan {
  const policies = resolveAll(project, state);
  const planning: Planning = {
    namingOf: memberNamings(project, state),
    policyOf: (member) => {
      const policy = policies.get(memberKey(member));
      // Asked only of a member its naming found in a group, so one of the memberships.
      if (policy === undefined) throw new Error(`Member ${memberKey(member)} has no membership.`);
      return policy;
    },
    contextOf,
    clock: request.clock,
  };
  return { items: settled(request.members.map((member) => planMember(member, planning))) };
}
