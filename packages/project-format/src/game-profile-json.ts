/**
 * Writing and reading a game export profile (`@audiogubbins/game-audio`'s
 * `GameExportProfile`, ADR-0102, ADR-0106): a format and the choices of a
 * preset for it, read and written by the encodings an export's settings have
 * (`export-settings-json.ts`), so a profile's choice is held to the rule the
 * same setting is held to wherever an export keeps it. Every choice may be
 * absent; the encoding, where chosen, is its format's own, refused where the
 * format does not hold it. The range and the file name are each member's and
 * its naming's, never a profile's, and are refused here.
 */

import type { GameExportProfile } from '@audiogubbins/game-audio';
import type { ExportFormat, FormatEncodings } from '@audiogubbins/import-export';

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { presentMembers } from './document-writing.js';
import { ENCODING_READERS } from './export-encoding-json.js';
import {
  asChannels,
  asDither,
  asMetadata,
  writeChannels,
  writeMetadata,
} from './export-settings-json.js';
import { namedValueConverter } from './scalar-reading.js';
import { members } from './variant-reading.js';
import { asSampleRate } from './value-reading.js';

const asFormat = namedValueConverter<ExportFormat>({
  wav: true,
  aiff: true,
  aifc: true,
  flac: true,
  mp3: true,
  'ogg-vorbis': true,
  opus: true,
  aac: true,
});

const CHOICE_MEMBERS = members('encoding', 'sampleRate', 'channels', 'dither', 'metadata');

/** The choices every format's profile may make, each where it is made. */
type CommonChoices = Omit<
  Extract<GameExportProfile, { readonly format: 'wav' }>['choices'],
  'encoding'
>;

/** The common choices of the object at `at`, or `undefined` where one was refused. */
function commonChoices(
  reading: Reading,
  object: JsonObject,
  at: string,
): CommonChoices | undefined {
  const sampleRate = optional(reading, object, at, 'sampleRate', asSampleRate);
  const channels = optional(reading, object, at, 'channels', asChannels);
  const dither = optional(reading, object, at, 'dither', asDither);
  const metadata = optional(reading, object, at, 'metadata', asMetadata);
  const refused =
    (object['sampleRate'] !== undefined && sampleRate === undefined) ||
    (object['channels'] !== undefined && channels === undefined) ||
    (object['dither'] !== undefined && dither === undefined) ||
    (object['metadata'] !== undefined && metadata === undefined);
  if (refused) return undefined;
  return {
    ...(sampleRate === undefined ? {} : { sampleRate }),
    ...(channels === undefined ? {} : { channels }),
    ...(dither === undefined ? {} : { dither }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/** A format's encoding, where the profile chooses one. */
interface Chosen<F extends ExportFormat> {
  readonly encoding?: FormatEncodings[F];
}

/** Makes one format's profile from its choices. */
type ProfileMaker<F extends ExportFormat> = (
  common: CommonChoices,
  chosen: Chosen<F>,
) => GameExportProfile;

/**
 * Each format's profile from its choices: each format its own entry, so its
 * encoding's type stays its own without a cast.
 */
const PROFILES: { readonly [F in ExportFormat]: ProfileMaker<F> } = {
  wav: (common, chosen) => ({ format: 'wav', choices: { ...common, ...chosen } }),
  aiff: (common, chosen) => ({ format: 'aiff', choices: { ...common, ...chosen } }),
  aifc: (common, chosen) => ({ format: 'aifc', choices: { ...common, ...chosen } }),
  flac: (common, chosen) => ({ format: 'flac', choices: { ...common, ...chosen } }),
  mp3: (common, chosen) => ({ format: 'mp3', choices: { ...common, ...chosen } }),
  'ogg-vorbis': (common, chosen) => ({ format: 'ogg-vorbis', choices: { ...common, ...chosen } }),
  opus: (common, chosen) => ({ format: 'opus', choices: { ...common, ...chosen } }),
  aac: (common, chosen) => ({ format: 'aac', choices: { ...common, ...chosen } }),
};

/** The encoding `value` of `format`, refused where the format does not hold it. */
function encodingOf<F extends ExportFormat>(
  reading: Reading,
  format: F,
  value: JsonValue,
  at: string,
): FormatEncodings[F] | undefined {
  const read: (reading: Reading, value: JsonValue, at: string) => FormatEncodings[F] | undefined =
    ENCODING_READERS[format];
  return read(reading, value, at);
}

/** `format`'s profile of `common` and `encoding`, where one is chosen. */
function profileWith<F extends ExportFormat>(
  format: F,
  common: CommonChoices,
  encoding: FormatEncodings[F] | undefined,
): GameExportProfile {
  const make: ProfileMaker<F> = PROFILES[format];
  return make(common, encoding === undefined ? {} : { encoding });
}

/** The profile of `format` whose choices are the object at `at`, or `undefined` where one was refused. */
function profileOf(
  reading: Reading,
  format: ExportFormat,
  object: JsonObject,
  at: string,
): GameExportProfile | undefined {
  const common = commonChoices(reading, object, at);
  const value = object['encoding'];
  const encoding = value === undefined ? undefined : encodingOf(reading, format, value, at);
  if (common === undefined || (value !== undefined && encoding === undefined)) return undefined;
  return profileWith(format, common, encoding);
}

/** Reads a game export profile. */
export const readGameExportProfile: Converter<GameExportProfile> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = objectOf(reading, value, parent, key, members('format', 'choices'));
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const format = required(reading, object, at, 'format', asFormat);
  const choices = required(reading, object, at, 'choices', (inner, held, outer, name) =>
    objectOf(inner, held, outer, name, CHOICE_MEMBERS),
  );
  if (format === undefined || choices === undefined) return undefined;
  return profileOf(reading, format, choices, pathOf(at, 'choices'));
};

/** Writes a game export profile. */
export function writeGameExportProfile(profile: GameExportProfile): JsonObject {
  const { choices } = profile;
  return {
    format: profile.format,
    choices: presentMembers({
      encoding: choices.encoding === undefined ? undefined : { ...choices.encoding },
      sampleRate: choices.sampleRate,
      channels: choices.channels === undefined ? undefined : writeChannels(choices.channels),
      dither: choices.dither === undefined ? undefined : { ...choices.dither },
      metadata: choices.metadata === undefined ? undefined : writeMetadata(choices.metadata),
    }),
  };
}
