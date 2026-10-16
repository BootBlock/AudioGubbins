/**
 * Exporting an asset group's members (ADR-0102): the game export plan of a
 * group or of the members selected, each member planned by the export profile,
 * naming template and destination folder it resolves to, or refused with
 * every reason naming the group or override that owns it, and then the
 * planned files run as one batch of the page's export, each by its own
 * settings into its own folder.
 *
 * Nothing renders until every planned file is ready: the refused members are
 * said before the export starts, and the planned ones are exported without
 * them. The export is never an undoable step, and it leaves the project's last
 * export settings as they were. A save dialog's one file and a download have
 * no folder, so a group's files go into a folder the person chooses, or a
 * trusted one; downloaded, each takes its name alone, which is said.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { CodecEnvironment } from '@audiogubbins/codecs';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type AssetId,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  NO_GAME_AUDIO,
  planGameExport,
  type GameExportItem,
  type GameExportPlan,
  type GroupMember,
} from '@audiogubbins/game-audio';
import type { CollisionPolicy, ExportClock } from '@audiogubbins/import-export';
import type { ProjectState } from '@audiogubbins/project-format';
import { counted } from '@audiogubbins/text';

import { assetEntryId } from '../assets/project-entry.js';
import { exportContextOf, servedCodecs } from '../export/export-context.js';
import type { ExportDestinationChoice, PlannedExportFile } from '../export/export-types.js';
import { exportClockAt } from '../export/page-export.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import type { Observable } from '../state/observable.js';
import { exportParts, type ExportParts } from './export-dialog-opening.js';
import {
  gameScope,
  groupAvailability,
  groupName,
  memberName,
  targetGroup,
  targetMembers,
  type GameScope,
} from './game-target.js';
import { sayWhenSettled } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** What a game export is planned against: the assets as the editor opens them, and the codecs served. */
export interface GameExportSources {
  readonly assets: Pick<AssetCatalogue, 'find' | 'get'>;
  readonly codecs: Observable<CodecEnvironment>;
}

/** The asset whose audio `member` is of in `state`, or `undefined` where it is not in the project. */
function memberAsset(state: ProjectState, member: GroupMember): AssetId | undefined {
  return member.kind === 'asset' ? member.asset : state.project.regions.get(member.region)?.assetId;
}

/**
 * The game export plan of `members` in `state` at `clock`, each planned
 * against its asset's audio as the editor opens it (see the module comment).
 */
export function gameExportPlan(
  sources: GameExportSources,
  state: ProjectState,
  members: readonly GroupMember[],
  clock: ExportClock,
): GameExportPlan {
  const codecs = servedCodecs(sources.codecs);
  return planGameExport(
    state.project,
    state.gameAudio ?? NO_GAME_AUDIO,
    { members, clock },
    (member) => {
      const asset = memberAsset(state, member);
      const entry = asset === undefined ? undefined : assetEntryId(asset);
      const editor = entry === undefined ? undefined : sources.assets.find(entry);
      if (entry === undefined || editor === undefined) {
        const reason =
          (entry === undefined ? undefined : sources.assets.get().unopened.get(entry)?.reason) ??
          `${memberName(state.project, member)} cannot be heard yet.`;
        return fail(failure('game.export-member-unopened', FailureKind.Rejected, reason));
      }
      return exportContextOf(editor, state, codecs);
    },
  );
}

/** The planned items of `plan`, as files the page's export takes. */
function plannedFiles(state: ProjectState, plan: GameExportPlan): readonly PlannedExportFile[] {
  return plan.items.flatMap((item) => {
    if (item.kind !== 'planned') return [];
    const asset = memberAsset(state, item.member);
    return asset === undefined
      ? []
      : [
          {
            asset,
            settings: item.settings,
            file: item.file,
            folder: item.destination.segments,
          },
        ];
  });
}

/** Why each refused member of `plan` is refused, a sentence each, naming it. */
function refusedSentences(state: ProjectState, plan: GameExportPlan): readonly string[] {
  return plan.items.flatMap((item: GameExportItem) =>
    item.kind === 'refused'
      ? [
          `${memberName(state.project, item.member)}: ${item.failures.map((one) => one.summary).join(' ')}`,
        ]
      : [],
  );
}

/** The collision policy the invocation names by `policy`, asking where it names none. */
function policyArgument(
  invocation: CommandInvocation,
): { readonly policy: CollisionPolicy } | string {
  const named = textArgument(invocation, 'policy') ?? 'prompt';
  return named === 'prompt' || named === 'overwrite' || named === 'skip' || named === 'rename'
    ? { policy: named }
    : 'A taken name is asked about, overwritten, skipped or renamed.';
}

/**
 * Where the invocation asks the files delivered by `destination`: a folder
 * the person chooses now, in the gesture that ran the command, which is the
 * default; a folder kept trusted, as `trusted:<key>`; or a download.
 */
async function chosenDestination(
  parts: ExportParts,
  invocation: CommandInvocation,
  policy: CollisionPolicy,
): Promise<DomainResult<ExportDestinationChoice | undefined>> {
  const named = textArgument(invocation, 'destination') ?? 'folder';
  if (named === 'download') return succeed({ kind: 'download' });
  if (named.startsWith('trusted:')) {
    return succeed({ kind: 'trusted-folder', key: named.slice('trusted:'.length), policy });
  }
  const chosen = await parts.stores.exportDestinations.chooseFolder();
  if (!chosen.ok) return chosen;
  return succeed(
    chosen.value === undefined ? undefined : { kind: 'folder', handle: chosen.value, policy },
  );
}

/** What is said of the members left out before an export of the rest starts. */
function leftOut(refused: readonly string[]): string {
  return refused.length === 0
    ? ''
    : ` ${counted(refused.length, 'member was', 'members were')} left out: ${refused.join(' ')}`;
}

/** Exports the planned members of `plan`, saying what came of it. */
function exportPlanned(
  context: ShellContext,
  invocation: CommandInvocation,
  scope: GameScope,
  plan: GameExportPlan,
  what: string,
): string | readonly [string, ...string[]] | undefined {
  const parts = exportParts(context);
  if (typeof parts === 'string') return parts;
  const run = parts.control.get().kind;
  if (run === 'running' || run === 'held') {
    return 'An export is under way or waits for a file; finish or cancel it first.';
  }
  const refused = refusedSentences(scope.state, plan);
  const [first, ...rest] = plannedFiles(scope.state, plan);
  if (first === undefined) {
    const [reason, ...reasons] = refused;
    return reason === undefined ? `${what} has no member to export.` : [reason, ...reasons];
  }
  const asked = policyArgument(invocation);
  if (typeof asked === 'string') return asked;
  // Asked now, inside the person's gesture, which is when a browser opens its dialogs.
  const destination = chosenDestination(parts, invocation, asked.policy);
  const work = destination.then(async (chosen) => {
    if (!chosen.ok || chosen.value === undefined) return chosen.ok ? succeed(undefined) : chosen;
    const flat =
      chosen.value.kind === 'download' && [first, ...rest].some((one) => one.folder.length > 0)
        ? ' A download has no folder, so each file took its name alone.'
        : '';
    const ended = await parts.control.start(parts.session, {
      files: [first, ...rest],
      destination: chosen.value,
    });
    return ended.ok ? succeed(`${ended.value}${flat}${leftOut(refused)}`) : ended;
  });
  sayWhenSettled(context, work, (said) => said);
  return undefined;
}

/** Available where a project is open to change and the page can export. */
function exportAvailability(context: ShellContext): CommandAvailability {
  const parts = exportParts(context);
  return typeof parts === 'string' ? unavailable(parts) : AVAILABLE;
}

function exportGroupCommand(): Command<ShellContext> {
  return shellCommand(
    'game.export-group',
    'Export the asset group',
    CommandCategory.File,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const members = scope.view.membersOf(group.id).map((one) => one.member);
      const plan = gameExportPlan(
        { assets: context.assets, codecs: context.codecs.environment },
        scope.state,
        members,
        exportClockAt(context.clock.now()),
      );
      return exportPlanned(
        context,
        invocation,
        scope,
        plan,
        `The group ${groupName(scope.view, group.id)}`,
      );
    },
    {
      availability: (context) => {
        const can = exportAvailability(context);
        return can.available ? groupAvailability(context) : can;
      },
      keywords: ['export', 'group', 'game', 'batch', 'render', 'members'],
      description:
        'Exports each member of the asset group chosen by the export profile, naming template and destination folder its policy gives, as one batch, leaving out a member it refuses and saying why.',
    },
  );
}

function exportMembersCommand(): Command<ShellContext> {
  return shellCommand(
    'game.export-members',
    'Export the selected members',
    CommandCategory.File,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const members = targetMembers(context, invocation, scope.state.project);
      if (typeof members === 'string') return members;
      const plan = gameExportPlan(
        { assets: context.assets, codecs: context.codecs.environment },
        scope.state,
        members,
        exportClockAt(context.clock.now()),
      );
      const [only, ...rest] = members;
      return exportPlanned(
        context,
        invocation,
        scope,
        plan,
        rest.length === 0 ? memberName(scope.state.project, only) : 'The selection',
      );
    },
    {
      availability: exportAvailability,
      keywords: ['export', 'members', 'game', 'batch', 'regions'],
      description:
        'Exports the regions selected, or the region or asset shown, each by the export profile, naming template and destination folder its group gives it.',
    },
  );
}

/** The commands that export an asset group's members. */
export function gameExportCommands(): readonly Command<ShellContext>[] {
  return [exportGroupCommand(), exportMembersCommand()];
}
