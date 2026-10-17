/**
 * Audio: the performance profile and the Custom profile's settings
 * (REQ-ARCH-083), how background work shares the machine (REQ-ARCH-084), the
 * mode renders use (REQ-ARCH-079), the quality a render and playback run at
 * (REQ-AUDIO-080, REQ-AUDIO-086), and the recording input
 * (`recording-input.tsx`). The Custom profile's form is `custom-profile.tsx`.
 */

import type { ReactNode } from 'react';

import { Hint, OptionSelect, SegmentedControl, Section } from '@audiogubbins/design-system';
import { NAMED_QUALITY_LEVELS } from '@audiogubbins/domain';
import { PerformanceProfile } from '@audiogubbins/audio-engine';

import {
  POLICIES,
  POLICY_NAMES,
  RENDER_MODE_NAMES,
  RENDER_MODE_SETTINGS,
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
import { QUALITY_LEVEL_NAMES } from '../../quality-words.js';
import { previewQualityOf, type AudioSettings } from '../../state/audio-settings-store.js';
import { PerformanceChoice } from '../performance-choice.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import { ChoiceField } from './choice-field.js';
import { CustomProfile } from './custom-profile.js';
import { QualityChoice, type QualityOption } from './quality-choice.js';
import { RecordingInput } from './recording-input.js';
import type { RunCommand } from './section.js';

/** What the audio settings need. */
export interface AudioProps {
  readonly settings: AudioSettings;
  readonly run: RunCommand;
}

/** What the audio settings need for their input section besides. */
export interface AudioInputProps {
  /** The input, which the section lists the inputs and the calibration of. */
  readonly recording: RecordingParts;
  readonly unavailableReason: (id: string) => string | undefined;
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
        note="What a render is processed at, and what the waveforms draw. A model runs the same pinned way at every level, so a render sounds the same on every machine."
        run={run}
      />
      <QualityChoice
        legend="Preview quality"
        chosen={previewQualitySetting(settings)}
        options={PREVIEW_QUALITY_OPTIONS}
        mode={previewQualityOf(settings)}
        customCommand={SET_CUSTOM_PREVIEW_QUALITY}
        note="What playback is processed at. Automatic follows the performance profile, lower where it trades margin for latency; a change is heard at once."
        run={run}
      />
    </>
  );
}

/** The audio settings. */
export function Audio({
  settings,
  run,
  recording,
  unavailableReason,
}: AudioProps & AudioInputProps): ReactNode {
  const renderMode = renderModeSetting(settings.renderMode);
  return (
    <div className="ag-settings-section">
      <div className="ag-settings-profile">
        <PerformanceChoice
          profile={settings.chosen.profile}
          run={(id) => {
            run(id);
          }}
        />
        <Hint label="About the performance profiles">
          Profiles trade how soon a change is heard against how much margin the audio has before it
          runs dry. No profile changes what AudioGubbins can do, or a rendered sample; the render
          quality below is the one setting that does.
        </Hint>
      </div>
      {/* Keyed by the stored settings, so a change applied, here or by any
          other route, is what the form shows next. */}
      <CustomProfile
        key={JSON.stringify(settings.custom)}
        custom={settings.custom}
        inForce={settings.chosen.profile === PerformanceProfile.Custom}
        run={run}
      />
      <div className="ag-settings-form">
        <ChoiceField heading="Background priority">
          <SegmentedControl
            label="Background priority"
            small
            value={settings.priorityPolicy}
            options={POLICIES.map((one) => ({ value: one, label: POLICY_NAMES[one] }))}
            onValueChange={(value) => {
              const chosen = POLICIES.find((one) => one === value);
              if (chosen !== undefined && chosen !== settings.priorityPolicy) {
                run(policyCommandId(chosen));
              }
            }}
          />
        </ChoiceField>
        <OptionSelect
          label="Render mode"
          value={renderMode}
          options={RENDER_MODE_SETTINGS.map((one) => ({
            value: one,
            label: RENDER_MODE_NAMES[one],
          }))}
          onValueChange={(value) => {
            const chosen = RENDER_MODE_SETTINGS.find((one) => one === value);
            if (chosen !== undefined && chosen !== renderMode) run(renderModeCommandId(chosen));
          }}
        />
      </div>
      <QualitySettings settings={settings} run={run} />
      {/* Closed until asked for (REQ-UX-071): the input and its latency are
          what a recording needs, and opening them is what lists the inputs. */}
      <Section title="Recording input and latency" defaultOpen={false}>
        <RecordingInput
          settings={settings.recording}
          recording={recording}
          run={run}
          unavailableReason={unavailableReason}
        />
      </Section>
    </div>
  );
}
