/**
 * The targets of the open project, its assets and each asset's regions, ticked
 * in a Library entry's row to apply a saved chain to all of them in one step
 * (REQ-EDIT-012, REQ-EDIT-014), a copy each or one chain shared, by the
 * library's command. What is ticked is the person's choice in the making, kept
 * here until they apply it; a target gone from the project since is left out.
 */

import { useId, useRef, useState, type ReactNode } from 'react';

import { Button, ToggleSwitch } from '@audiogubbins/design-system';
import type { LibraryEntry } from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

import type { OpenProjectState } from '../../state/open-project-store.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { useFocusOnShow } from './row-opening.js';

/** What one of the project's assets or regions is called, and how a command names it. */
interface Target {
  readonly reference: string;
  readonly name: string;
}

/** Every asset and region of the open project, in the project's order, regions after their asset. */
function targetsOf(project: OpenProjectState): readonly Target[] {
  if (project.kind !== 'open') return [];
  const { assets, regions } = project.snapshot.model.state.project;
  const targets: Target[] = [];
  for (const asset of assets.values()) {
    targets.push({ reference: `asset:${asset.id}`, name: asset.displayName });
    for (const region of regions.values()) {
      if (region.assetId !== asset.id) continue;
      targets.push({
        reference: `region:${region.id}`,
        name: `${region.displayName}, a region of ${asset.displayName}`,
      });
    }
  }
  return targets;
}

/** The targets to tick, and applying the chain to those ticked (see the module comment). */
export function TargetChooser({
  entry,
  share,
  project,
  commands,
  onClose,
}: {
  readonly entry: LibraryEntry;
  readonly share: boolean;
  readonly project: OpenProjectState;
  readonly commands: PanelCommands;
  readonly onClose: () => void;
}): ReactNode {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const heading = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnShow(headingRef);
  const targets = targetsOf(project);
  const named = targets.filter((target) => chosen.has(target.reference));
  return (
    <div className="ag-library-chooser" role="group" aria-labelledby={heading}>
      <h5 className="ag-section-heading" id={heading} ref={headingRef} tabIndex={-1}>
        {`Apply ${quoted(entry.name)} to`}
      </h5>
      {targets.length === 0 ? (
        <p>The project has no assets yet.</p>
      ) : (
        <ul className="ag-library-targets">
          {targets.map((target) => (
            <li key={target.reference}>
              <ToggleSwitch
                label={target.name}
                checked={chosen.has(target.reference)}
                onCheckedChange={(on) => {
                  const next = new Set(chosen);
                  if (on) next.add(target.reference);
                  else next.delete(target.reference);
                  setChosen(next);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <CommandButton
        id="library.apply-chain"
        label={`Apply to ${String(named.length)} chosen`}
        commands={commands}
        args={{
          entry: entry.id,
          targets: named.map((target) => target.reference).join(','),
          share,
        }}
        refusal={named.length === 0 ? 'Choose the targets to apply it to.' : undefined}
      />
      <Button compact onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
