/**
 * What REQ-AUDIO-139 asks the Model packs panel to show of a pack version,
 * from its manifest, behind its Details section: its download and installed
 * sizes, its integrity check, its model's tier, its licences and what it needs
 * to run, the long explanations behind their hints.
 */

import type { ReactNode } from 'react';

import { Hint, Section } from '@audiogubbins/design-system';
import type {
  InstallState,
  ModelPackManifest,
  PackCapability,
  PackTier,
} from '@audiogubbins/model-packs';

import { describeBytes } from '../../wording.js';

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

/** What REQ-AUDIO-139 asks to be shown of a version, from its manifest, behind its details. */
export function PackFacts({
  manifest,
  state,
}: {
  readonly manifest: ModelPackManifest;
  readonly state: InstallState;
}): ReactNode {
  const [tier = TIER_WORDS[manifest.tier]] = TIER_WORDS[manifest.tier].split(':');
  return (
    <Section title="Details" defaultOpen={false}>
      <dl className="ag-pack-facts">
        <div>
          <dt>Download size</dt>
          <dd className="ag-figure">{describeBytes(manifest.downloadBytes)}</dd>
        </div>
        <div>
          <dt>Installed size</dt>
          <dd className="ag-figure">{describeBytes(manifest.installedBytes)}</dd>
        </div>
        <div>
          <dt>Integrity</dt>
          <dd>
            <Hint label="About its integrity">{integrityWords(state)}</Hint>
          </dd>
        </div>
        <div>
          <dt>Model tier</dt>
          <dd>
            {tier}
            <Hint label="About its model tier">{`${TIER_WORDS[manifest.tier]}. ${TIER_NOTE}`}</Hint>
          </dd>
        </div>
        <div data-ag-wide="">
          <dt>Licence</dt>
          <dd>{`Code ${manifest.licence.code}; weights ${manifest.licence.weights}`}</dd>
        </div>
        <div data-ag-wide="">
          <dt>Compatibility</dt>
          <dd>{compatibilityWords(manifest)}</dd>
        </div>
      </dl>
    </Section>
  );
}
