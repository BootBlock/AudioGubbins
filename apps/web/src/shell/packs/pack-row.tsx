/**
 * One pack version in the Model packs panel (REQ-AUDIO-139): its explicit name
 * and purpose, version, download and installed sizes, the integrity check, its
 * licences, what it needs to run, its model's tier, the state of its
 * installation with the progress of a download, which of the requirement's
 * conditions holds for it, and the steps its state allows, each a pack
 * command. A version a project needs, whose removal was refused for that, says
 * so and offers to remove it knowingly.
 */

import { useId, type ReactNode } from 'react';

import { ButtonTone } from '@audiogubbins/design-system';
import type {
  InstallState,
  ModelPackManifest,
  PackCapability,
  PackRef,
  PackTier,
  PackVersionCondition,
} from '@audiogubbins/model-packs';

import { CONDITION_NAMES, packTitle, progressWords, stateWords } from '../../ml/pack-words.js';
import { describeBytes } from '../../wording.js';
import { CommandButton, useCommandReasons, type PanelCommands } from '../command-button.js';
import { SharedReasonNotes } from '../settings/reasoned-button.js';

/** What each capability a pack may need is called. */
const CAPABILITY_NAMES: Readonly<Record<PackCapability, string>> = {
  'webassembly-simd': 'WebAssembly SIMD',
};

/**
 * What each tier says of a pack's model: how quick it is to run against how
 * thorough its result is. Worded for the model alone, since every render and
 * preview quality runs a model the same way, and with none of the quality
 * levels' names, so no reader takes a tier for a quality to choose.
 */
const TIER_WORDS: Readonly<Record<PackTier, string>> = {
  light: 'Light: quick to run, with a lighter result',
  balanced: 'Balanced: between speed and the most thorough result',
  thorough: 'Thorough: the slowest to run, with the most thorough result',
};

/** Said under the tier, so it is read as the model's and not as a quality setting. */
const TIER_NOTE = 'The model’s own; it is the same at every render and preview quality.';

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

/** What the pack needs to run, in a sentence. */
function compatibilityWords(manifest: ModelPackManifest): string {
  const { runtime } = manifest;
  const needs =
    runtime.capabilities.length === 0
      ? ''
      : `, with ${runtime.capabilities.map((one) => CAPABILITY_NAMES[one]).join(' and ')}`;
  return `${runtime.name} from ${runtime.minimum}, below ${runtime.below}${needs}`;
}

/** What the integrity check says of a version in this state. */
function integrityWords(state: InstallState): string {
  switch (state.kind) {
    case 'installed':
      return 'Every file matched its SHA-256 when it was installed, and is checked again as it is read.';
    case 'verifying':
      return 'Every file is being checked against its SHA-256 now.';
    case 'failed':
      return 'Nothing of it is used: a version is used only once every file matches its SHA-256.';
    case 'available':
    case 'queued':
    case 'downloading':
    case 'paused':
    case 'removing':
      return 'Every file is checked against its SHA-256 before anything uses it.';
  }
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
      <p data-ag-status="reduced">
        {`${CONDITION_NAMES['update-available']}: version ${condition.update.version}.`}
      </p>
    );
  }
  return (
    <p data-ag-status="unavailable">
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

/** What each step's button says. */
const STEP_LABELS: Readonly<Record<string, string>> = {
  'packs.install': 'Install',
  'packs.pause': 'Pause',
  'packs.resume': 'Resume',
  'packs.cancel': 'Cancel',
  'packs.retry': 'Retry',
  'packs.remove': 'Remove',
};

/** How far a download has come, and its bar. */
function Progress({ state, title }: { readonly state: InstallState; readonly title: string }) {
  if (state.kind !== 'queued' && state.kind !== 'downloading' && state.kind !== 'paused') {
    return null;
  }
  return (
    <progress
      className="ag-render-progress"
      aria-label={`Download of ${title}`}
      aria-valuetext={progressWords(state.received, state.total)}
      max={state.total}
      value={state.received}
    />
  );
}

/** What REQ-AUDIO-139 asks to be shown of a version, from its manifest. */
function PackFacts({
  manifest,
  state,
}: {
  readonly manifest: ModelPackManifest;
  readonly state: InstallState;
}): ReactNode {
  return (
    <>
      <p>{manifest.purpose}</p>
      <dl className="ag-pack-facts">
        <div>
          <dt>Download size</dt>
          <dd>{describeBytes(manifest.downloadBytes)}</dd>
        </div>
        <div>
          <dt>Installed size</dt>
          <dd>{describeBytes(manifest.installedBytes)}</dd>
        </div>
        <div>
          <dt>Integrity</dt>
          <dd>{integrityWords(state)}</dd>
        </div>
        <div>
          <dt>Licence</dt>
          <dd>{`Code ${manifest.licence.code}; weights ${manifest.licence.weights}`}</dd>
        </div>
        <div>
          <dt>Compatibility</dt>
          <dd>{compatibilityWords(manifest)}</dd>
        </div>
        <div>
          <dt>Model tier</dt>
          <dd>
            {TIER_WORDS[manifest.tier]}. {TIER_NOTE}
          </dd>
        </div>
      </dl>
    </>
  );
}

/** The steps a version's state allows, their reasons said once above them. */
function Steps({
  steps,
  args,
  commands,
}: {
  readonly steps: readonly string[];
  readonly args: { readonly id: string; readonly version: string };
  readonly commands: PanelCommands;
}): ReactNode {
  const shared = useCommandReasons(commands, steps);
  return (
    <>
      <SharedReasonNotes reasons={shared} />
      <div className="ag-settings-row">
        {steps.map((step) => (
          <CommandButton
            key={step}
            id={step}
            label={STEP_LABELS[step] ?? step}
            commands={commands}
            args={args}
            compact
            shared={shared}
          />
        ))}
      </div>
    </>
  );
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
    <li className="ag-pack" role="group" aria-labelledby={heading}>
      <h3 className="ag-pack-name" id={heading}>
        {title}
      </h3>
      {manifest === undefined ? (
        <p>Its manifest cannot be read, so it can only be removed.</p>
      ) : (
        <PackFacts manifest={manifest} state={state} />
      )}
      <p className="ag-pack-state">{stateWords(state)}</p>
      <Progress state={state} title={title} />
      <ConditionLine condition={version.condition} installed={state.kind === 'installed'} />
      <Steps steps={steps} args={args} commands={commands} />
      {version.needed !== undefined && (
        <div role="group" aria-label={`Remove ${title} knowingly`}>
          <p data-ag-status="unavailable">{version.needed}</p>
          <CommandButton
            id="packs.remove"
            label="Remove it anyway"
            commands={commands}
            args={{ ...args, knowingly: true }}
            tone={ButtonTone.Destructive}
            compact
          />
        </div>
      )}
    </li>
  );
}
