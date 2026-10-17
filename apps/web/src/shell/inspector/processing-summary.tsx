/**
 * What processes the Inspector's subject (REQ-EDIT-072): with processors
 * selected, their settings, by the controls the Effects rack shows them with;
 * otherwise what the rack of the asset or region runs, and the command that
 * shows the rack.
 */

import type { ReactNode } from 'react';

import { ButtonTone } from '@audiogubbins/design-system';
import type { ProcessorId } from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { targetChains } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';

import { processorIn } from '../../commands/library-access.js';
import { showPanelCommandId } from '../../commands/panel-commands.js';
import { targetName } from '../../commands/rack-target.js';
import { chainWords, processorLabel } from '../../commands/rack-words.js';
import { EditingPanelKinds } from '../../panel-kinds.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { ProcessorControls } from '../rack/processor-controls.js';
import type { Inspected } from './inspected.js';
import { InspectorPart } from './inspector-part.js';

/** A subject of the project, as the Inspector shows one. */
type ProjectInspected = Extract<Inspected, { readonly kind: 'project' }>;

/** The settings of each processor selected, by the controls the Effects rack shows them with. */
function SelectedProcessors({
  ids,
  of: subject,
  state,
  commands,
}: {
  readonly ids: readonly ProcessorId[];
  /**
   * What they are selected in: the view the commands act in, and the audio
   * whose rate a response is drawn at.
   */
  readonly of: ProjectInspected;
  readonly state: ProjectState;
  readonly commands: PanelCommands;
}): ReactNode {
  const { panel } = subject;
  return ids.map((id) => {
    const processor = processorIn(state, id);
    const descriptor =
      processor === undefined ? undefined : PROCESSOR_CATALOGUE.get(processor.typeKey);
    if (processor === undefined) {
      return (
        <InspectorPart
          key={id}
          heading="A processor no longer in the project"
          title="Processor"
          summary="No longer in the project"
        >
          {null}
        </InspectorPart>
      );
    }
    const label = processorLabel(processor.typeKey);
    const bypassed = !processor.enabled;
    return (
      <InspectorPart
        key={id}
        heading={`Processor: ${label}${bypassed ? ', bypassed' : ''}`}
        title={label}
        summary={bypassed ? 'Bypassed' : undefined}
      >
        {descriptor !== undefined && (
          <ProcessorControls
            processor={processor}
            descriptor={descriptor}
            panel={panel}
            commands={commands}
            sampleRate={subject.view.sampleRate}
          />
        )}
      </InspectorPart>
    );
  });
}

/** What the ranges a chain processes come to, in a sentence, or nothing where there are none. */
function rangesWords(count: number): string {
  if (count === 0) return '';
  return count === 1
    ? ' One of its ranges is processed by a chain of its own.'
    : ` ${String(count)} of its ranges are processed by chains of their own.`;
}

/** What the rack of the asset or region shown runs, and the command that shows the rack. */
function RackSummary({
  subject,
  state,
  commands,
}: {
  readonly subject: ProjectInspected;
  readonly state: ProjectState;
  readonly commands: PanelCommands;
}): ReactNode {
  const asset = state.project.assets.get(subject.asset.id) ?? subject.asset;
  const target =
    subject.region === undefined
      ? ({ kind: 'asset', asset } as const)
      : ({ kind: 'region', region: subject.region.region, asset } as const);
  const { rack, ranges } = targetChains(target);
  const chain = rack === undefined ? undefined : state.project.effectChains.get(rack);
  const runs =
    chain === undefined
      ? 'It has no rack.'
      : `It runs ${chainWords(chain)}${chain.slots.some((slot) => !slot.enabled) ? ', some of it bypassed' : ''}.`;
  return (
    <InspectorPart
      heading={`Rack of ${targetName(target)}`}
      title="Rack"
      actions={
        <CommandButton
          id={showPanelCommandId(EditingPanelKinds.Rack)}
          label="Show the rack"
          commands={commands}
          tone={ButtonTone.Quiet}
          compact
        />
      }
    >
      <p className="ag-inspector-text">{`${runs}${rangesWords(ranges.length)}`}</p>
    </InspectorPart>
  );
}

/** The processors selected in `subject`'s view, or else what its rack runs. */
export function ProcessingSummary({
  subject,
  processors,
  state,
  commands,
}: {
  readonly subject: ProjectInspected;
  readonly processors: readonly ProcessorId[];
  readonly state: ProjectState;
  readonly commands: PanelCommands;
}): ReactNode {
  return processors.length > 0 ? (
    <SelectedProcessors ids={processors} of={subject} state={state} commands={commands} />
  ) : (
    <RackSummary subject={subject} state={state} commands={commands} />
  );
}
