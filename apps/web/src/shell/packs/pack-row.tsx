/**
 * One pack version in the Model packs panel (REQ-AUDIO-139): its explicit name
 * and purpose, version, download and installed sizes, the integrity check, its
 * licences, what it needs to run, its model's tier, the state of its
 * installation with the progress of a download, which of the requirement's
 * conditions holds for it, and the steps its state allows, each a pack
 * command. A version a project needs, whose removal was refused for that, says
 * so and offers to remove it knowingly.
 *
 * Drawn as a card: its name, purpose, state and steps at its head, its facts
 * behind a Details section with the long explanations behind their hints, and
 * a download's progress or a failure under them.
 */

import { useId, type ReactNode } from 'react';

import {
  Badge,
  BadgeTone,
  ButtonTone,
  Icon,
  ProgressBar,
  ProgressPlace,
  VisuallyHidden,
  type IconName,
} from '@audiogubbins/design-system';
import type {
  InstallState,
  ModelPackManifest,
  PackRef,
  PackVersionCondition,
} from '@audiogubbins/model-packs';

import { CONDITION_NAMES, packTitle, progressWords, stateWords } from '../../ml/pack-words.js';
import type { PanelCommands } from '../command-button.js';
import { CommandIconButton, HintedCommandButton } from '../hinted-command-button.js';
import { PackFacts } from './pack-facts.js';

/** One version as the panel lists it: what the installer and the catalogue know of it. */
export interface PackVersion {
  readonly ref: PackRef;
  /** Its manifest, where the installer or the catalogue can read one. */
  readonly manifest: ModelPackManifest | undefined;
  readonly state: InstallState;
  /** Which of the conditions holds for it, where availability is known and it has a manifest. */
  readonly condition: PackVersionCondition | undefined;
  /** Why its removal was refused because a project needs it, where it was. */
  readonly needed: string | undefined;
}

/** The condition that holds for a version, and why, where one other than running holds. */
function ConditionLine({
  condition,
  installed,
}: {
  readonly condition: PackVersionCondition | undefined;
  readonly installed: boolean;
}): ReactNode {
  if (condition === undefined || condition.condition === 'runs') return null;
  if (condition.condition === 'update-available') {
    // An update is news only of a version kept: one merely offered is not
    // made out of date by another offered.
    if (!installed) return null;
    return (
      <p className="ag-pack-line" data-ag-tone="warning">
        {`${CONDITION_NAMES['update-available']}: version ${condition.update.version}.`}
      </p>
    );
  }
  return (
    <p className="ag-pack-line" data-ag-tone="error">
      {`${CONDITION_NAMES[condition.condition]}. ${condition.reason.summary}`}
    </p>
  );
}

/** The commands a version's state allows, in the order a person reads them. */
function stepsOf(state: InstallState, offered: boolean): readonly string[] {
  switch (state.kind) {
    case 'available':
      return offered ? ['packs.install'] : [];
    case 'queued':
    case 'downloading':
    case 'verifying':
      return ['packs.pause', 'packs.cancel'];
    case 'paused':
      return ['packs.resume', 'packs.cancel'];
    case 'failed':
      return ['packs.retry', 'packs.remove'];
    case 'installed':
      return ['packs.remove'];
    case 'removing':
      return [];
  }
}

/**
 * How each step's button is drawn: its words, and the glyph that stands for
 * them where the step is a row's small action. Install and Retry keep their
 * words, being what the row is for in its state.
 */
const STEPS: Readonly<Record<string, { readonly label: string; readonly icon?: IconName }>> = {
  'packs.install': { label: 'Install' },
  'packs.pause': { label: 'Pause', icon: 'pause' },
  'packs.resume': { label: 'Resume', icon: 'play' },
  'packs.cancel': { label: 'Cancel', icon: 'cancel' },
  'packs.retry': { label: 'Retry' },
  'packs.remove': { label: 'Remove', icon: 'delete' },
};

/** The state of a version's installation: a badge where it is settled, a line otherwise. */
function StateLine({ state, title }: { readonly state: InstallState; readonly title: string }) {
  const words = stateWords(state);
  switch (state.kind) {
    case 'installed': {
      // The badge says the state in a word; the rest of the words are the
      // integrity fact's too, said here to a screen reader.
      const [badge = words, rest = ''] = words.split(/(?=, )/u);
      return (
        <Badge tone={BadgeTone.Success} icon="verified">
          {badge}
          <VisuallyHidden>{rest}</VisuallyHidden>
        </Badge>
      );
    }
    case 'available':
      return <Badge>{words}</Badge>;
    case 'failed':
      return (
        <p className="ag-pack-line" data-ag-tone="error">
          {words}
        </p>
      );
    case 'queued':
    case 'downloading':
    case 'paused':
      return (
        <>
          <p className="ag-pack-line ag-figure">{words}</p>
          <ProgressBar
            label={`Download of ${title}`}
            value={state.total === 0 ? null : state.received / state.total}
            valueText={() => progressWords(state.received, state.total)}
            place={ProgressPlace.Row}
          />
        </>
      );
    case 'verifying':
    case 'removing':
      return <p className="ag-pack-line">{words}</p>;
  }
}

/** The steps a version's state allows, each its reason opened on hover or focus. */
function Steps({
  steps,
  args,
  commands,
}: {
  readonly steps: readonly string[];
  readonly args: { readonly id: string; readonly version: string };
  readonly commands: PanelCommands;
}): ReactNode {
  return (
    <span className="ag-pack-steps">
      {steps.map((step) => {
        const { label = step, icon } = STEPS[step] ?? {};
        return icon === undefined ? (
          <HintedCommandButton
            key={step}
            id={step}
            label={label}
            commands={commands}
            args={args}
            compact
          />
        ) : (
          <CommandIconButton
            key={step}
            id={step}
            icon={icon}
            label={label}
            commands={commands}
            args={args}
            compact
          />
        );
      })}
    </span>
  );
}

/** A version's head: its glyph, name and purpose, its settled state, and its steps. */
function PackHead({
  version,
  title,
  heading,
  steps,
  commands,
}: {
  readonly version: PackVersion;
  readonly title: string;
  /** The id its name is the heading of the row by. */
  readonly heading: string;
  readonly steps: readonly string[];
  readonly commands: PanelCommands;
}): ReactNode {
  const { ref, manifest, state } = version;
  return (
    <div className="ag-pack-head">
      <span className="ag-pack-tile" aria-hidden="true">
        <Icon name="enhance" />
      </span>
      <div className="ag-pack-text">
        <h3 className="ag-pack-name" id={heading}>
          {manifest?.name ?? ref.id}{' '}
          <span className="ag-pack-version ag-figure">{ref.version}</span>
        </h3>
        <p className="ag-pack-purpose">
          {manifest === undefined
            ? 'Its manifest cannot be read, so it can only be removed.'
            : manifest.purpose}
        </p>
      </div>
      {settled(state) && <StateLine state={state} title={title} />}
      <Steps steps={steps} args={{ id: ref.id, version: ref.version }} commands={commands} />
    </div>
  );
}

/** Whether a version's state is settled, which its head says in a badge. */
function settled(state: InstallState): boolean {
  return state.kind === 'installed' || state.kind === 'available';
}

/** One version and what can be done with it. */
export function PackRow({
  version,
  offered,
  commands,
}: {
  readonly version: PackVersion;
  /** Whether the catalogue as last read offers it, so it can be installed. */
  readonly offered: boolean;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  const { ref, manifest, state } = version;
  const title = packTitle(manifest?.name ?? ref.id, ref.version);
  const steps = stepsOf(state, offered && manifest !== undefined);
  const args = { id: ref.id, version: ref.version };
  return (
    <li
      className="ag-pack"
      role="group"
      aria-labelledby={heading}
      data-ag-failed={state.kind === 'failed' ? '' : undefined}
    >
      <PackHead
        version={version}
        title={title}
        heading={heading}
        steps={steps}
        commands={commands}
      />
      {manifest === undefined ? null : <PackFacts manifest={manifest} state={state} />}
      {settled(state) ? null : <StateLine state={state} title={title} />}
      <ConditionLine condition={version.condition} installed={state.kind === 'installed'} />
      {version.needed !== undefined && (
        <div className="ag-pack-knowingly" role="group" aria-label={`Remove ${title} knowingly`}>
          <p className="ag-pack-line" data-ag-tone="error">
            {version.needed}
          </p>
          <span>
            <HintedCommandButton
              id="packs.remove"
              label="Remove it anyway"
              commands={commands}
              args={{ ...args, knowingly: true }}
              tone={ButtonTone.Destructive}
              compact
            />
          </span>
        </div>
      )}
    </li>
  );
}
