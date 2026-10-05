/**
 * Audio: the performance profile and the Custom profile's settings
 * (REQ-ARCH-083), how background work shares the machine (REQ-ARCH-084), the
 * mode renders use (REQ-ARCH-079), and the quality a render and playback run
 * at (REQ-AUDIO-080, REQ-AUDIO-086).
 *
 * The Custom settings are a form, because they are checked together: a person
 * sets the fields and applies them, and a refusal names every field that is
 * wrong while keeping what they typed. Nothing here switches a feature on or
 * off; each setting changes how soon audio is heard, how much is buffered, or
 * how work is queued.
 */

import { useState, type ReactNode } from 'react';

import { Button, OptionSelect, TextField } from '@audiogubbins/design-system';
import { NAMED_QUALITY_LEVELS, type QualitySettingKey } from '@audiogubbins/domain';
import {
  LATENCY_CATEGORIES,
  PerformanceProfile,
  type LatencyCategory,
  type PerformanceSettings,
} from '@audiogubbins/audio-engine';

import {
  POLICIES,
  POLICY_NAMES,
  RENDER_MODE_NAMES,
  RENDER_MODE_SETTINGS,
  SET_CUSTOM_PROFILE,
  policyCommandId,
  renderModeCommandId,
  renderModeSetting,
} from '../../commands/audio-settings-commands.js';
import {
  PREVIEW_QUALITY_NAMES,
  PREVIEW_QUALITY_SETTINGS,
  SET_CUSTOM_PREVIEW_QUALITY,
  SET_CUSTOM_RENDER_QUALITY,
  previewQualityCommandId,
  previewQualitySetting,
  renderQualityCommandId,
} from '../../commands/quality-commands.js';
import { QUALITY_LEVEL_NAMES, QUALITY_SETTING_KEYS } from '../../quality-words.js';
import { previewQualityOf, type AudioSettings } from '../../state/audio-settings-store.js';
import { PerformanceChoice } from '../performance-choice.js';
import { QualityChoice, type QualityOption } from './quality-choice.js';
import type { RunCommand } from './section.js';

/** What the audio settings need. */
export interface AudioProps {
  readonly settings: AudioSettings;
  readonly run: RunCommand;
}

/** A latency hint as the form offers it: a category, or a latency the person types. */
type LatencyChoice = LatencyCategory | 'milliseconds';

const LATENCY_NAMES: Readonly<Record<LatencyChoice, string>> = {
  interactive: 'As low as the device allows',
  balanced: 'Balanced',
  playback: 'Smooth playback over low latency',
  milliseconds: 'A latency I set',
};

const LATENCY_CHOICES: readonly LatencyChoice[] = [...LATENCY_CATEGORIES, 'milliseconds'];

/** The form's text, as typed, for each Custom setting. */
interface CustomDraft {
  readonly latency: LatencyChoice;
  readonly latencyMilliseconds: string;
  readonly feedAhead: string;
  readonly background: string;
  readonly chunk: string;
}

function draftOf(custom: PerformanceSettings): CustomDraft {
  const hint = custom.latencyHint;
  return {
    latency: typeof hint === 'number' ? 'milliseconds' : hint,
    latencyMilliseconds: typeof hint === 'number' ? String(hint * 1000) : '',
    feedAhead: String(custom.feedAheadMilliseconds),
    background: String(custom.backgroundConcurrencyWhileInteractive),
    chunk: String(custom.renderChunkMilliseconds),
  };
}

/**
 * A field's text as the command takes it: the number it reads as, or the text
 * itself where it reads as none, so the command says which field is wrong.
 */
function typed(text: string): number | string {
  const trimmed = text.trim();
  const value = Number(trimmed);
  return trimmed !== '' && Number.isFinite(value) ? value : text;
}

function argumentsOf(draft: CustomDraft): Readonly<Record<string, string | number>> {
  const latency = typed(draft.latencyMilliseconds);
  return {
    latencyHint:
      draft.latency !== 'milliseconds'
        ? draft.latency
        : typeof latency === 'number'
          ? latency / 1000
          : latency,
    feedAheadMilliseconds: typed(draft.feedAhead),
    backgroundConcurrencyWhileInteractive: typed(draft.background),
    renderChunkMilliseconds: typed(draft.chunk),
  };
}

/** The number fields of the Custom form, each with what it asks and why it matters. */
const NUMBER_FIELDS: readonly {
  readonly field: 'feedAhead' | 'background' | 'chunk';
  readonly label: string;
  readonly description: string;
}[] = [
  {
    field: 'feedAhead',
    label: 'Audio kept ready ahead of playback, in milliseconds',
    description: 'More survives a busy moment without a drop-out, and a change is heard later.',
  },
  {
    field: 'background',
    label: 'Background jobs at once while playing or editing',
    description: 'A whole number of at least one. Fewer keeps more of the machine for playback.',
  },
  {
    field: 'chunk',
    label: 'Render chunk length, in milliseconds',
    description:
      'Shorter chunks hand the processor back sooner. The rendered audio is identical either way.',
  },
];

/** What each part of the Custom form is given: the draft, how to change it, and how to apply it. */
interface DraftProps {
  readonly draft: CustomDraft;
  readonly change: (changes: Partial<CustomDraft>) => void;
  readonly apply: () => void;
}

/** The output latency: a category, or a number of milliseconds the person types. */
function LatencyFields({ draft, change, apply }: DraftProps): ReactNode {
  return (
    <>
      <OptionSelect
        label="Output latency"
        value={draft.latency}
        options={LATENCY_CHOICES.map((one) => ({ value: one, label: LATENCY_NAMES[one] }))}
        onValueChange={(value) => {
          const latency = LATENCY_CHOICES.find((one) => one === value);
          if (latency !== undefined) change({ latency });
        }}
      />
      {draft.latency === 'milliseconds' && (
        <TextField
          label="Output latency, in milliseconds"
          description="What the browser is asked for; the device may give more."
          value={draft.latencyMilliseconds}
          onValueChange={(latencyMilliseconds) => {
            change({ latencyMilliseconds });
          }}
          onSubmit={apply}
        />
      )}
    </>
  );
}

/** The Custom profile's settings, as a form applied through one command. */
function CustomProfile({
  custom,
  inForce,
  run,
}: {
  readonly custom: PerformanceSettings;
  readonly inForce: boolean;
  readonly run: RunCommand;
}): ReactNode {
  const [draft, setDraft] = useState(() => draftOf(custom));
  const change = (changes: Partial<CustomDraft>): void => {
    setDraft({ ...draft, ...changes });
  };
  const apply = (): void => {
    run(SET_CUSTOM_PROFILE, argumentsOf(draft));
  };

  return (
    <fieldset className="ag-settings-group">
      <legend>Custom profile</legend>
      <p className="ag-settings-note">
        {inForce
          ? 'These settings are in force. A change closes the audio context and opens another, and playback goes on from where it was.'
          : 'These settings are kept for when you choose the Custom profile.'}
      </p>
      <LatencyFields draft={draft} change={change} apply={apply} />
      {NUMBER_FIELDS.map(({ field, label, description }) => (
        <TextField
          key={field}
          label={label}
          description={description}
          value={draft[field]}
          onValueChange={(value) => {
            change({ [field]: value });
          }}
          onSubmit={apply}
        />
      ))}
      <div className="ag-settings-row">
        <Button onClick={apply}>Apply the Custom settings</Button>
        <Button
          onClick={() => {
            setDraft(draftOf(custom));
          }}
        >
          Discard changes
        </Button>
      </div>
    </fieldset>
  );
}

/** The render quality levels, each with the command that chooses it. */
const RENDER_QUALITY_OPTIONS: readonly QualityOption[] = NAMED_QUALITY_LEVELS.map((level) => ({
  value: level,
  label: QUALITY_LEVEL_NAMES[level],
  command: renderQualityCommandId(level),
}));

/** The preview quality settings, automatic first, each with the command that chooses it. */
const PREVIEW_QUALITY_OPTIONS: readonly QualityOption[] = PREVIEW_QUALITY_SETTINGS.map(
  (setting) => ({
    value: setting,
    label: PREVIEW_QUALITY_NAMES[setting],
    command: previewQualityCommandId(setting),
  }),
);

/** A render always takes the pinned inference path (ADR-0062), so it offers no choice of one. */
const RENDER_SETTINGS: readonly QualitySettingKey[] = QUALITY_SETTING_KEYS.filter(
  (key) => key !== 'inference',
);

/** The quality a render and playback run at. */
function QualitySettings({ settings, run }: AudioProps): ReactNode {
  return (
    <>
      <QualityChoice
        legend="Render quality"
        chosen={settings.renderQuality.level}
        options={RENDER_QUALITY_OPTIONS}
        mode={settings.renderQuality}
        customCommand={SET_CUSTOM_RENDER_QUALITY}
        settings={RENDER_SETTINGS}
        note="What a render is processed at, and what the waveforms draw. A render always takes the pinned inference path, so it sounds the same on every machine."
        run={run}
      />
      <QualityChoice
        legend="Preview quality"
        chosen={previewQualitySetting(settings)}
        options={PREVIEW_QUALITY_OPTIONS}
        mode={previewQualityOf(settings)}
        customCommand={SET_CUSTOM_PREVIEW_QUALITY}
        settings={QUALITY_SETTING_KEYS}
        note="What playback is processed at. Automatic follows the performance profile, lower where it trades margin for latency; a change is heard at once."
        run={run}
      />
    </>
  );
}

/** The audio settings. */
export function Audio({ settings, run }: AudioProps): ReactNode {
  const renderMode = renderModeSetting(settings.renderMode);
  return (
    <div className="ag-settings-section">
      <p className="ag-settings-note">
        Profiles trade how soon a change is heard against how much margin the audio has before it
        runs dry. No profile changes what AudioGubbins can do, or a rendered sample; the render
        quality below is the one setting that does.
      </p>
      <PerformanceChoice
        profile={settings.chosen.profile}
        run={(id) => {
          run(id);
        }}
      />
      {/* Keyed by the stored settings, so a change applied, here or by any
          other route, is what the form shows next. */}
      <CustomProfile
        key={JSON.stringify(settings.custom)}
        custom={settings.custom}
        inForce={settings.chosen.profile === PerformanceProfile.Custom}
        run={run}
      />
      <OptionSelect
        label="Background priority"
        value={settings.priorityPolicy}
        options={POLICIES.map((one) => ({ value: one, label: POLICY_NAMES[one] }))}
        onValueChange={(value) => {
          const chosen = POLICIES.find((one) => one === value);
          if (chosen !== undefined && chosen !== settings.priorityPolicy) {
            run(policyCommandId(chosen));
          }
        }}
      />
      <OptionSelect
        label="Render mode"
        value={renderMode}
        options={RENDER_MODE_SETTINGS.map((one) => ({ value: one, label: RENDER_MODE_NAMES[one] }))}
        onValueChange={(value) => {
          const chosen = RENDER_MODE_SETTINGS.find((one) => one === value);
          if (chosen !== undefined && chosen !== renderMode) run(renderModeCommandId(chosen));
        }}
      />
      <QualitySettings settings={settings} run={run} />
    </div>
  );
}
