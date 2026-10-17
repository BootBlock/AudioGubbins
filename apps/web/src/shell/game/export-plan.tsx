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
  ButtonTone,
  Hint,
  Icon,
  IconSize,
  Verdict,
  VerdictKind,
  VisuallyHidden,
} from '@audiogubbins/design-system';
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
import type { PanelCommands } from '../command-button.js';
import { HintedCommandButton } from '../hinted-command-button.js';
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

/**
 * One item of the game export plan: a planned member, the file it makes and,
 * behind its hint, the group or override that owns its profile, its naming
 * and its folder; or a refused member with every reason.
 */
function PlanItem({
  item,
  state,
  view,
}: {
  readonly item: GameExportItem;
  readonly state: ProjectState;
  readonly view: GamePolicyView;
}): ReactNode {
  const name = memberName(state.project, item.member);
  if (item.kind === 'refused') {
    return (
      <li className="ag-plan-item" data-ag-refused="">
        <Verdict kind={VerdictKind.Fails}>
          <span className="ag-plan-name">{`${name}:`}</span>{' '}
          <span className="ag-plan-reason">
            {item.failures.map((one) => one.summary).join(' ')}
          </span>
        </Verdict>
      </li>
    );
  }
  const folder = item.destination.segments.join('/');
  const file = safeFileName(item.file.name);
  const where = folder === '' ? file : `${folder}/${file}`;
  const { provenance } = item;
  return (
    <li className="ag-plan-item">
      <Verdict kind={VerdictKind.Passes}>
        {name}
        <Icon name="leads-to" size={IconSize.Small} className="ag-plan-arrow" />
        <VisuallyHidden>{' to '}</VisuallyHidden>
        <span className="ag-figure">{where}</span>
      </Verdict>
      <Hint label={`Where the file of ${name} takes its values from`}>
        {`Profile: ${ownerWords(provenance.exportProfile, view)}; name: ${ownerWords(provenance.naming, view)}; folder: ${ownerWords(provenance.destination, view)}.`}
      </Hint>
    </li>
  );
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
    <section className="ag-plan" aria-labelledby={heading}>
      <div className="ag-plan-head">
        <Icon name="export-plan" size={IconSize.Inline} className="ag-plan-glyph" />
        <h3 className="ag-plan-heading" id={heading}>
          Export plan
        </h3>
        <Hint label="About the export plan">
          The folder each goes into is inside the folder you export to; a download has none.
        </Hint>
        <span className="ag-plan-export">
          <HintedCommandButton
            id="game.export-group"
            label="Export the planned members…"
            commands={commands}
            args={{ group: group.id }}
            tone={ButtonTone.Primary}
            refusal={planned === 0 ? 'No member of the group is planned yet.' : undefined}
            compact
          />
        </span>
      </div>
      <p className="ag-plan-summary">
        {`${counted(planned, 'member is', 'members are')} planned and ${counted(plan.items.length - planned, 'is', 'are')} refused.`}
      </p>
      <ul className="ag-plan-items">
        {plan.items.map((item) => (
          <PlanItem key={memberKey(item.member)} item={item} state={state} view={view} />
        ))}
      </ul>
    </section>
  );
}
