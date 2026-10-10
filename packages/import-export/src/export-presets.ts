/**
 * Presets over the full settings (ADR-0092, REQ-AUDIO-050).
 *
 * A preset is a name and the settings it chooses; resolving it fills every
 * other value from the format's defaults, so a preset gives exactly the
 * record the expert controls edit, and an edit made after it is an edit of
 * that record, never of the preset. The defaults suit what the preset chose:
 * a preset of a rate or a conversion takes the encoding that suits them, and
 * one that chooses an encoding and no dither takes the dither its depth does.
 *
 * The built-in presets are the game effects, masters and distribution files
 * the ADR names. A person's own presets are kept with their preferences.
 */

import { sampleRate, type SampleRate } from '@audiogubbins/domain';

import { defaultDither, defaultsFor } from './default-settings.js';
import type { ExportContext } from './export-context.js';
import { exportTarget } from './export-formats.js';
import type { ExportFormat, SettingsByFormat } from './export-settings.js';

/** What a preset chooses of one format's settings. */
export type PresetChoices<F extends ExportFormat> = Partial<Omit<SettingsByFormat[F], 'format'>>;

/** A named choice of settings. */
export type ExportPreset = {
  readonly [F in ExportFormat]: {
    /** Stable across versions, so a person's last choice is found again. */
    readonly id: string;
    readonly name: string;
    readonly format: F;
    readonly settings: PresetChoices<F>;
  };
}[ExportFormat];

function resolved<F extends ExportFormat>(
  format: F,
  choices: PresetChoices<F>,
  context: ExportContext,
): SettingsByFormat[F] {
  const defaults = defaultsFor(format, context, {
    ...(choices.sampleRate === undefined ? {} : { sampleRate: choices.sampleRate }),
    ...(choices.channels === undefined ? {} : { channels: choices.channels }),
  });
  const settings: SettingsByFormat[F] = { ...defaults, ...choices };
  return choices.dither === undefined
    ? { ...settings, dither: defaultDither(exportTarget(settings).depth) }
    : settings;
}

/** The settings a preset gives for the context's project. */
export function resolvePreset(
  preset: ExportPreset,
  context: ExportContext,
): SettingsByFormat[ExportFormat] {
  return resolved(preset.format, preset.settings, context);
}

function rate(hertz: number): SampleRate {
  const made = sampleRate(hertz);
  if (!made.ok) throw new RangeError(`${String(hertz)} Hz is not a sample rate.`);
  return made.value;
}

const FORTY_EIGHT_KILOHERTZ = rate(48_000);

/** The presets AudioGubbins offers. */
export const BUILT_IN_PRESETS: readonly ExportPreset[] = [
  {
    id: 'game-wav-16-48k',
    name: 'Game effect, WAV 16-bit 48 kHz',
    format: 'wav',
    settings: { sampleRate: FORTY_EIGHT_KILOHERTZ, encoding: { kind: 'integer', bits: 16 } },
  },
  {
    id: 'game-ogg-vorbis',
    name: 'Game effect, Ogg Vorbis',
    format: 'ogg-vorbis',
    settings: { sampleRate: FORTY_EIGHT_KILOHERTZ, encoding: { mode: 'quality', quality: 6 } },
  },
  {
    id: 'game-opus',
    name: 'Game effect, Opus',
    format: 'opus',
    settings: {
      sampleRate: FORTY_EIGHT_KILOHERTZ,
      encoding: { bitRate: 128, application: 'audio', frameDuration: 20, complexity: 10 },
    },
  },
  {
    id: 'master-wav-24',
    name: 'Master, WAV 24-bit',
    format: 'wav',
    settings: { encoding: { kind: 'integer', bits: 24 } },
  },
  {
    id: 'master-wav-float',
    name: 'Master, WAV 32-bit float',
    format: 'wav',
    settings: { encoding: { kind: 'float', bits: 32 } },
  },
  {
    id: 'master-flac',
    name: 'Master, FLAC',
    format: 'flac',
    settings: { encoding: { bits: 24, compressionLevel: 8 } },
  },
  {
    id: 'distribution-mp3-320',
    name: 'Distribution, MP3 320 kbit/s',
    format: 'mp3',
    settings: { encoding: { mode: 'constant', bitRate: 320 } },
  },
  {
    id: 'distribution-mp3-v0',
    name: 'Distribution, MP3 V0',
    format: 'mp3',
    settings: { encoding: { mode: 'variable', quality: 0 } },
  },
  {
    id: 'distribution-aac',
    name: 'Distribution, AAC 256 kbit/s',
    format: 'aac',
    settings: { encoding: { bitRate: 256 } },
  },
];
