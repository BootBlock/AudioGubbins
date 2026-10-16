/**
 * What a run of the game preview is made from (ADR-0104): the scenario, the
 * rules and pools its subjects play by in the project as it stands, each
 * member's sound as the editor opens it, the files those sounds read, the
 * project's rate and layout, and the voice budget at the person's preview
 * quality.
 *
 * Read, never written: the project's state, its game-audio policy and the
 * catalogue of opened assets are only looked at, so a run changes no edit.
 * Each member is heard as its view hears it, its rack and loop crossfade
 * included, and a member whose audio the page cannot open yet leaves its
 * pool with the reason said.
 */

import { PcmDescriptionKind, type MediaEntry } from '@audiogubbins/audio-engine';
import {
  anchorResolver,
  placeRegion,
  type AssetId,
  type ChannelLayout,
  type EditPlan,
  type ProcessorCatalogue,
  type ResamplingGrade,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  memberKey,
  previewSubjects,
  previewVoiceBudget,
  type GamePreviewScenario,
  type GroupMember,
  type MemberSound,
  type PreviewSubjects,
  type GameAudioState,
} from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

import type { EditorAsset, ProjectOwner } from '../assets/editor-asset.js';
import type { AssetCatalogue, AssetCatalogueState } from '../state/asset-catalogue.js';
import type { Reasons } from '../state/reasons.js';

/** Everything a run plays from. */
export interface PreviewSetup {
  readonly scenario: GamePreviewScenario;
  readonly subjects: PreviewSubjects;
  /** Each member's sound by its `memberKey`. */
  readonly members: ReadonlyMap<string, EditPlan>;
  /** The file behind every asset the members' sounds read. */
  readonly media: readonly MediaEntry[];
  /** The project's: the rate every frame of the run counts at. */
  readonly rate: SampleRate;
  /** The project's, which the run's output takes. */
  readonly layout: ChannelLayout;
  readonly budget: number;
  readonly catalogue: ProcessorCatalogue;
}

/** What a setup is read from. */
export interface SetupSources {
  readonly state: ProjectState;
  readonly assets: Pick<AssetCatalogue, 'find' | 'get'>;
  /** The resampling grade of the person's preview quality, which the budget is measured at. */
  readonly grade: ResamplingGrade;
  readonly catalogue: ProcessorCatalogue;
}

/** The project's opened entry of `member`, or `undefined` where the page has not opened it. */
function openedMember(
  assets: SetupSources['assets'],
  member: GroupMember,
): { readonly entry: EditorAsset; readonly owner: ProjectOwner } | undefined {
  const entry = assets.find(memberKey(member));
  return entry?.owner.kind === 'project' ? { entry, owner: entry.owner } : undefined;
}

/** Where `entry`, a region, loops in its own frames, where it loops and its sound is its length. */
function loopOf(entry: EditorAsset, owner: ProjectOwner): MemberSound['loop'] {
  if (owner.region === undefined) return undefined;
  const placed = placeRegion(anchorResolver(owner.asset), owner.region);
  const loop = placed?.loop;
  if (placed === undefined || loop === undefined || placed.length !== entry.length)
    return undefined;
  return { start: loop.loopStart, end: loop.loopEnd };
}

/** Why `member` cannot be heard now, in a sentence. */
function unheardReason(catalogue: AssetCatalogueState, member: GroupMember): string {
  const unopened = catalogue.unopened.get(memberKey(member));
  return unopened === undefined
    ? 'A member of the scenario is no longer in the project.'
    : `${unopened.name}: ${unopened.reason}`;
}

/** The members every emitter of `scenario` may play in `game`, each once. */
function scenarioMembers(
  game: GameAudioState,
  scenario: GamePreviewScenario,
): readonly GroupMember[] {
  const members = new Map<string, GroupMember>();
  for (const { subject } of scenario.emitters) {
    const own =
      subject.kind === 'member'
        ? [subject.member]
        : game.memberships.filter((one) => one.group === subject.group).map((one) => one.member);
    for (const member of own) members.set(memberKey(member), member);
  }
  return [...members.values()];
}

/** What `members` sound like as the page opens them now, and why any cannot be heard. */
function heardMembers(
  assets: SetupSources['assets'],
  members: readonly GroupMember[],
): {
  readonly sounds: ReadonlyMap<string, MemberSound>;
  readonly plans: ReadonlyMap<string, EditPlan>;
  readonly media: readonly MediaEntry[];
  readonly unheard: readonly string[];
} {
  const sounds = new Map<string, MemberSound>();
  const plans = new Map<string, EditPlan>();
  const media = new Map<AssetId, MediaEntry>();
  const unheard = new Set<string>();
  for (const member of members) {
    const opened = openedMember(assets, member);
    if (opened === undefined) {
      unheard.add(unheardReason(assets.get(), member));
      continue;
    }
    const { entry, owner } = opened;
    const loop = loopOf(entry, owner);
    const key = memberKey(member);
    sounds.set(key, {
      sampleRate: entry.sampleRate,
      length: entry.length,
      ...(loop === undefined ? {} : { loop }),
    });
    plans.set(key, owner.plan);
    const described = entry.describe();
    if (described.kind === PcmDescriptionKind.Edited) {
      for (const one of described.media) media.set(one.asset, one);
    }
  }
  return { sounds, plans, media: [...media.values()], unheard: [...unheard] };
}

/**
 * The setup that plays `scenario` in `sources`, or why it cannot be played: the
 * project has no game audio, or a subject's members cannot be heard yet. What
 * each member sounds like is read once, so a run plays what it was started
 * with however the project changes while it plays.
 */
export function previewSetup(
  scenario: GamePreviewScenario,
  sources: SetupSources,
):
  | { readonly ok: true; readonly setup: PreviewSetup }
  | { readonly ok: false; readonly reasons: Reasons } {
  const { state } = sources;
  const game = state.gameAudio;
  if (game === undefined) {
    return { ok: false, reasons: ['The project has no asset groups for the preview to play.'] };
  }
  const heard = heardMembers(sources.assets, scenarioMembers(game, scenario));
  const [first, ...rest] = heard.unheard;
  if (first !== undefined) return { ok: false, reasons: [first, ...rest] };
  const subjects = previewSubjects(state.project, game, (member) =>
    heard.sounds.get(memberKey(member)),
  );
  const variations = scenario.emitters.flatMap(({ subject }) =>
    subjects.poolOf(subject).map((pooled) => pooled.variation),
  );
  return {
    ok: true,
    setup: {
      scenario,
      subjects,
      members: heard.plans,
      media: heard.media,
      rate: state.project.settings.sampleRate,
      layout: state.project.settings.channelLayout,
      budget: previewVoiceBudget(sources.grade, variations),
      catalogue: sources.catalogue,
    },
  };
}
