/**
 * The quality processing runs at (ADR-0061): a final render's, which defaults
 * to the highest (REQ-AUDIO-143) and which the peaks draw, and a preview's,
 * which follows the performance profile until the person chooses one
 * (REQ-AUDIO-080). Each is a named level or Custom settings chosen one by one
 * (REQ-AUDIO-086).
 *
 * Each is a command, so the settings dialogue, the palette and a shortcut
 * reach one route (REQ-EDIT-073). None needs a capability: each changes how
 * much processing spends, never whether it can be done.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  NAMED_QUALITY_LEVELS,
  QualityLevel,
  qualityModeFrom,
  type NamedQualityLevel,
  type QualityMode,
  type QualitySettingKey,
  type QualitySettings,
} from '@audiogubbins/domain';

import { QUALITY_LEVEL_NAMES, QUALITY_SETTING_KEYS, qualitySentence } from '../quality-words.js';
import { previewQualityOf, type AudioSettings } from '../state/audio-settings-store.js';
import { reasonsOf, type Reasons } from '../state/reasons.js';
import { namedMode, validQualitySetting } from '../state/stored-quality.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The command that sets Custom render quality settings. */
export const SET_CUSTOM_RENDER_QUALITY = 'transport.set-custom-render-quality';

/** The command that sets Custom preview quality settings. */
export const SET_CUSTOM_PREVIEW_QUALITY = 'transport.set-custom-preview-quality';

/** A preview quality the person may choose: a named level, or the profile's. */
export type PreviewQualitySetting = NamedQualityLevel | 'automatic';

/** What each preview quality setting is called, standing alone as it does in a list. */
export const PREVIEW_QUALITY_NAMES: Readonly<Record<PreviewQualitySetting, string>> = {
  automatic: 'Automatic',
  [QualityLevel.Draft]: QUALITY_LEVEL_NAMES[QualityLevel.Draft],
  [QualityLevel.Standard]: QUALITY_LEVEL_NAMES[QualityLevel.Standard],
  [QualityLevel.High]: QUALITY_LEVEL_NAMES[QualityLevel.High],
  [QualityLevel.Maximum]: QUALITY_LEVEL_NAMES[QualityLevel.Maximum],
};

/** The preview quality settings, automatic first, as the settings offer them. */
export const PREVIEW_QUALITY_SETTINGS: readonly PreviewQualitySetting[] = [
  'automatic',
  ...NAMED_QUALITY_LEVELS,
];

/** The command that sets the render quality to a named level. */
export function renderQualityCommandId(level: NamedQualityLevel): string {
  return `transport.render-quality-${level}`;
}

/** The command that sets the preview quality. */
export function previewQualityCommandId(setting: PreviewQualitySetting): string {
  return `transport.preview-quality-${setting}`;
}

/** The preview quality setting the stored choice stands for, Custom where it is none of them. */
export function previewQualitySetting(
  settings: AudioSettings,
): PreviewQualitySetting | typeof QualityLevel.Custom {
  return settings.previewQuality?.level ?? 'automatic';
}

/** What each setting an invocation names is refused for in the wrong form. */
const SETTING_FORMS: Readonly<Record<QualitySettingKey, string>> = {
  resampling: 'A resampling grade is draft, high or maximum.',
  oversampling: 'Oversampling is 1, 2, 4 or 8 times.',
  spectralOverlap: 'A spectral overlap is 2, 4 or 8 frames.',
};

/**
 * The mode an invocation asks for: each setting it names over `current`'s. A
 * setting in the wrong form is a reason to refuse, not one to skip, so nobody
 * believes a value was kept that was not.
 */
function requestedQuality(
  invocation: CommandInvocation,
  current: QualitySettings,
): { readonly mode: QualityMode } | { readonly refused: Reasons } {
  const given = invocation.arguments ?? {};
  const problems: string[] = [];
  const settings: Record<string, unknown> = { ...current };
  for (const key of QUALITY_SETTING_KEYS) {
    const value = given[key];
    if (value === undefined) continue;
    if (validQualitySetting(current, key, value)) settings[key] = value;
    else problems.push(SETTING_FORMS[key]);
  }
  const [first, ...rest] = problems;
  if (first !== undefined) return { refused: [first, ...rest] };
  const read = qualityModeFrom(settings);
  return read.ok ? { mode: read.value } : { refused: reasonsOf(read.failures) };
}

/** The keywords every quality command is found by. */
const KEYWORDS = ['quality', 'resampling', 'oversampling', 'spectral', 'overlap'];

function renderQualityCommands(): readonly Command<ShellContext>[] {
  return NAMED_QUALITY_LEVELS.map((level) => {
    const name = QUALITY_LEVEL_NAMES[level];
    return shellCommand(
      renderQualityCommandId(level),
      `Render quality: ${name}`,
      CommandCategory.Transport,
      (context) => {
        context.audioSettings.chooseRenderQuality(namedMode(level));
        context.interaction.announce(`Render quality: ${name}.`);
      },
      {
        keywords: ['render', 'final', 'export', ...KEYWORDS],
        description: `Renders, and draws waveforms, at ${name} quality. ${qualitySentence(namedMode(level).settings)}`,
        availability: (context) =>
          context.audioSettings.get().renderQuality.level === level
            ? unavailable(`${name} is already the render quality.`)
            : AVAILABLE,
      },
    );
  });
}

/** Sets the preview quality, and plays on at it. */
function choosePreview(context: ShellContext, mode: QualityMode | undefined): void {
  context.audioSettings.choosePreviewQuality(mode);
  context.playback.usePreviewQuality();
}

function previewQualityCommands(): readonly Command<ShellContext>[] {
  return PREVIEW_QUALITY_SETTINGS.map((setting) => {
    const name = PREVIEW_QUALITY_NAMES[setting];
    return shellCommand(
      previewQualityCommandId(setting),
      `Preview quality: ${name}`,
      CommandCategory.Transport,
      (context) => {
        choosePreview(context, setting === 'automatic' ? undefined : namedMode(setting));
        context.interaction.announce(`Preview quality: ${name}.`);
      },
      {
        keywords: ['preview', 'playback', 'automatic', ...KEYWORDS],
        description:
          setting === 'automatic'
            ? 'Plays at the quality the performance profile can afford: lower where it trades margin for latency.'
            : `Plays at ${name} quality whatever the profile. ${qualitySentence(namedMode(setting).settings)}`,
        availability: (context) =>
          previewQualitySetting(context.audioSettings.get()) === setting
            ? unavailable(`${name} is already the preview quality.`)
            : AVAILABLE,
      },
    );
  });
}

function customRenderQualityCommand(): Command<ShellContext> {
  return shellCommand(
    SET_CUSTOM_RENDER_QUALITY,
    'Set Custom render quality',
    CommandCategory.Transport,
    (context, invocation) => {
      const before = context.audioSettings.get().renderQuality;
      const requested = requestedQuality(invocation, before.settings);
      if ('refused' in requested) return requested.refused;
      context.audioSettings.chooseRenderQuality(requested.mode);
      const after = context.audioSettings.get().renderQuality;
      if (after === before) {
        return unchanged(
          'audio.render-quality-unchanged',
          'The render quality already has these settings.',
        );
      }
      context.interaction.announce(`Render quality: ${QUALITY_LEVEL_NAMES[after.level]}.`);
      return undefined;
    },
    {
      keywords: ['custom', 'render', ...KEYWORDS],
      description: 'Sets each value a render and the waveforms are processed at.',
      // Only a form can supply the settings, so a palette entry or a key could
      // only refuse.
      discoverable: false,
    },
  );
}

function customPreviewQualityCommand(): Command<ShellContext> {
  return shellCommand(
    SET_CUSTOM_PREVIEW_QUALITY,
    'Set Custom preview quality',
    CommandCategory.Transport,
    (context, invocation) => {
      const settings = context.audioSettings.get();
      const before = settings.previewQuality;
      const requested = requestedQuality(invocation, previewQualityOf(settings).settings);
      if ('refused' in requested) return requested.refused;
      // Chosen, even with the profile's own values, the preview stops
      // following the profile, which is a change.
      choosePreview(context, requested.mode);
      const after = context.audioSettings.get().previewQuality;
      if (after === before || after === undefined) {
        return unchanged(
          'audio.preview-quality-unchanged',
          'The preview quality already has these settings.',
        );
      }
      context.interaction.announce(`Preview quality: ${QUALITY_LEVEL_NAMES[after.level]}.`);
      return undefined;
    },
    {
      keywords: ['custom', 'preview', 'playback', ...KEYWORDS],
      description: 'Sets each value playback is processed at, whatever the profile.',
      // Only a form can supply the settings, so a palette entry or a key could
      // only refuse.
      discoverable: false,
    },
  );
}

/** Every command that chooses the quality a render or a preview runs at. */
export function qualityCommands(): readonly Command<ShellContext>[] {
  return [
    ...renderQualityCommands(),
    ...previewQualityCommands(),
    customRenderQualityCommand(),
    customPreviewQualityCommand(),
  ];
}
