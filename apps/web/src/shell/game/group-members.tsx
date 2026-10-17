/**
 * The members of the asset group chosen, as a table (ADR-0101): each in its
 * assignment order, with whether its rack is its group's processing or its
 * own, how many fields it overrides, the loudness target it resolves to and
 * how its loudness measured this session stands against it, a verdict in
 * words beside the glyph of its kind, and the command that takes it out.
 *
 * Drawn in the design language's table (section 10, "Tables"), with each
 * member's name the header of its row, so a screen reader names the member
 * with every cell of it.
 */

import { useId, useSyncExternalStore, type ReactNode } from 'react';

import { Badge, BadgeTone, EmptyState, Verdict, VisuallyHidden } from '@audiogubbins/design-system';
import type { QualityMode } from '@audiogubbins/domain';
import { memberKey, type GameAssetGroup, type GroupMembership } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';
import { counted } from '@audiogubbins/text';

import { detectionIdentity } from '../../analysis/detection-control.js';
import { assetEntryId, regionEntryId } from '../../assets/project-entry.js';
import { memberName } from '../../commands/game-target.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { GamePolicyView } from '../../state/game-policy-view.js';
import type { LoudnessReadings } from '../../state/loudness-store.js';
import type { PanelCommands } from '../command-button.js';
import { CommandIconButton } from '../hinted-command-button.js';
import { loudnessWords } from './game-words.js';
import type { GroupsParts } from './groups-parts.js';
import { CONFORMANCE_VERDICTS, conformance, conformanceWords } from './loudness-conformance.js';

/** What a member's loudness is judged with: the readings, the quality measured at, and its audio now. */
interface LoudnessSources {
  readonly readings: LoudnessReadings;
  readonly quality: QualityMode;
  readonly assets: Pick<AssetCatalogue, 'find'>;
}

/** One member: how it stands to its group's processing, what it overrides, and its loudness. */
function MemberRow({
  membership,
  state,
  view,
  loudness,
  commands,
}: {
  readonly membership: GroupMembership;
  readonly state: ProjectState;
  readonly view: GamePolicyView;
  readonly loudness: LoudnessSources;
  readonly commands: PanelCommands;
}): ReactNode {
  const { member } = membership;
  const target = view.member(member).loudness.value;
  const audio = loudness.assets.find(
    member.kind === 'region' ? regionEntryId(member.region) : assetEntryId(member.asset),
  );
  const identity = audio === undefined ? undefined : detectionIdentity(audio, loudness.quality);
  const verdict = conformance(target, loudness.readings.get(memberKey(member)), identity);
  const overrides = Object.keys(membership.overrides).length;
  const name = memberName(state.project, member);
  return (
    <tr>
      <th scope="row">{name}</th>
      <td>
        {membership.processing === 'inherit' ? (
          <Badge>Inherits</Badge>
        ) : (
          <Badge tone={BadgeTone.Accent}>Its own</Badge>
        )}
      </td>
      <td data-ag-quiet={overrides === 0 ? '' : undefined}>
        {overrides === 0 ? 'None' : counted(overrides, 'field', 'fields')}
      </td>
      <td className="ag-figure" data-ag-quiet={target === undefined ? '' : undefined}>
        {target === undefined ? 'Not set' : loudnessWords(target)}
      </td>
      <td data-ag-kind="verdict">
        <Verdict kind={CONFORMANCE_VERDICTS[verdict.kind]}>{conformanceWords(verdict)}</Verdict>
      </td>
      <td data-ag-kind="action">
        <CommandIconButton
          id="game.remove-from-group"
          icon="remove"
          label="Take out"
          commands={commands}
          args={{ member: memberKey(member) }}
          compact
        />
      </td>
    </tr>
  );
}

/** The members of the group chosen, each with its processing, overrides and loudness. */
export function GroupMembers({
  group,
  memberships,
  state,
  view,
  parts,
  commands,
}: {
  readonly group: GameAssetGroup;
  readonly memberships: readonly GroupMembership[];
  readonly state: ProjectState;
  readonly view: GamePolicyView;
  readonly parts: GroupsParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const caption = useId();
  const readings = useSyncExternalStore(parts.loudness.subscribe, parts.loudness.get);
  const settings = useSyncExternalStore(parts.audioSettings.subscribe, parts.audioSettings.get);
  useSyncExternalStore(parts.assets.subscribe, parts.assets.get);
  if (memberships.length === 0) {
    return (
      <EmptyState
        icon="group"
        title="No members yet"
        text="Select regions in the editor, or show an asset, and put them in the group."
      />
    );
  }
  return (
    <div className="ag-table-frame">
      <table className="ag-table ag-row-headed-table ag-group-members" aria-labelledby={caption}>
        <caption id={caption} className="ag-visually-hidden">
          {`Members of ${view.pathOf(group.id).join('/')}`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Processing</th>
            <th scope="col">Overrides</th>
            <th scope="col">Loudness target</th>
            <th scope="col">Loudness</th>
            <th scope="col">
              <VisuallyHidden>Actions</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {memberships.map((membership) => (
            <MemberRow
              key={memberKey(membership.member)}
              membership={membership}
              state={state}
              view={view}
              loudness={{ readings, quality: settings.renderQuality, assets: parts.assets }}
              commands={commands}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
