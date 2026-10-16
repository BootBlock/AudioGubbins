/**
 * The game export plan of the asset group chosen (ADR-0102): each member
 * planned, with the file it makes inside the folder exported to and the group
 * or override that owns its profile, its naming and its folder, or refused
 * with every reason, worked out from the project as it stands; and the
 * command that exports the planned members, which plans them again as it
 * starts.
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  memberKey,
  type GameAssetGroup,
  type GameExportItem,
  type GroupMembership,
  type PolicySource,
} from '@audiogubbins/game-audio';
import { safeFileName } from '@audiogubbins/import-export';
import type { ProjectState } from '@audiogubbins/project-format';
import { counted } from '@audiogubbins/text';

import { gameExportPlan } from '../../commands/game-export-commands.js';
import { memberName } from '../../commands/game-target.js';
import { exportClockAt } from '../../export/page-export.js';
import type { GamePolicyView } from '../../state/game-policy-view.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import type { GroupsParts } from './groups-parts.js';

/** Where a value of a planned file comes from, in a phrase. */
function ownerWords(source: PolicySource, view: GamePolicyView): string {
  switch (source.kind) {
    case 'override':
      return 'its own';
    case 'group':
      return view.pathOf(source.group).join('/');
    case 'unset':
      return 'not set';
  }
}

/** One item of the game export plan, in words. */
function itemWords(item: GameExportItem, state: ProjectState, view: GamePolicyView): string {
  const name = memberName(state.project, item.member);
  if (item.kind === 'refused') {
    return `✗ ${name}: ${item.failures.map((one) => one.summary).join(' ')}`;
  }
  const folder = item.destination.segments.join('/');
  const file = safeFileName(item.file.name);
  const where = folder === '' ? file : `${folder}/${file}`;
  const { provenance } = item;
  return `✓ ${name} → ${where} (profile: ${ownerWords(provenance.exportProfile, view)}; name: ${ownerWords(provenance.naming, view)}; folder: ${ownerWords(provenance.destination, view)})`;
}

/** The game export plan of the group chosen, and the command that exports its planned members. */
export function ExportPlan({
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
  const heading = useId();
  useSyncExternalStore(parts.codecs.subscribe, parts.codecs.get);
  // The moment the plan is shown from, which a `{date}` in a name reads; the
  // export itself is planned again at the moment it is asked for.
  const [asked] = useState(() => exportClockAt(Date.now()));
  if (memberships.length === 0) return null;
  const plan = gameExportPlan(
    parts,
    state,
    memberships.map((one) => one.member),
    asked,
  );
  const planned = plan.items.filter((item) => item.kind === 'planned').length;
  return (
    <section aria-labelledby={heading}>
      <h3 className="ag-section-heading" id={heading}>
        Export plan
      </h3>
      <p>
        {`${counted(planned, 'member is', 'members are')} planned and ${counted(plan.items.length - planned, 'is', 'are')} refused. The folder each goes into is inside the folder you export to; a download has none.`}
      </p>
      <ul>
        {plan.items.map((item) => (
          <li key={memberKey(item.member)}>{itemWords(item, state, view)}</li>
        ))}
      </ul>
      <CommandButton
        id="game.export-group"
        label="Export the planned members…"
        commands={commands}
        args={{ group: group.id }}
        refusal={planned === 0 ? 'No member of the group is planned yet.' : undefined}
      />
    </section>
  );
}
