/**
 * Writing and reading an export's settings (`@audiogubbins/import-export`'s
 * `ExportSettings`, ADR-0092) wherever the project keeps them: the settings it
 * was last exported with, and the settings each export record names
 * (REQ-STOR-197, REQ-EXEC-136.12).
 *
 * The reader holds every member to its type: each format's own encoding, the
 * literal depths and durations the types allow, whole numbers where a count or
 * a seed is meant, and finite numbers elsewhere. Whether settings can be made
 * by the codecs this browser has is not a property of the document: settings
 * kept from one machine are read on another and checked there, against its
 * codecs, by `validateExportSettings` before an export begins.
 */

import type { MetadataTextKey } from '@audiogubbins/codecs';
import { MAXIMUM_CHANNEL_COUNT, unsafeBrandId } from '@audiogubbins/domain';
import type {
  ChannelConversion,
  DitherSettings,
  ExportFormat,
  ExportRange,
  ExportSettings,
  MetadataEdit,
  MetadataSettings,
  NoiseShaping,
} from '@audiogubbins/import-export';

import type { JsonObject } from './canonical-json.js';
import { listConverter, objectOf, pathOf, required, type Converter } from './document-reading.js';
import { presentMembers } from './document-writing.js';
import {
  asId,
  integerConverter,
  namedValueConverter,
  oneOfConverter,
  textConverter,
} from './scalar-reading.js';
import { asFinite, formatSettings } from './export-encoding-json.js';
import { kindOf, members } from './variant-reading.js';
import { writeLayout } from './value-writing.js';
import { asChannelLayout, asSampleCount, asSampleRate } from './value-reading.js';

const COMMON_MEMBERS = [
  'format',
  'encoding',
  'sampleRate',
  'channels',
  'dither',
  'range',
  'metadata',
  'fileName',
] as const;
const SETTINGS_MEMBERS: ReadonlySet<string> = new Set(COMMON_MEMBERS);

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

/** The matrices a conversion may name: the engine's fixed ones, as the settings type them. */
type FixedNamedMatrix = Extract<ChannelConversion, { readonly kind: 'matrix' }>['matrix'];

const asMatrix = namedValueConverter<FixedNamedMatrix>({
  'itu-bs775-5.1-to-stereo': true,
  'mid-side-encode': true,
  'mid-side-decode': true,
});

const asShaping = namedValueConverter<NoiseShaping>({
  none: true,
  'first-order': true,
  'lipshitz-e-weighted': true,
});

const asTextKey = namedValueConverter<MetadataTextKey>({
  title: true,
  artist: true,
  album: true,
  albumArtist: true,
  trackNumber: true,
  trackTotal: true,
  discNumber: true,
  discTotal: true,
  date: true,
  genre: true,
  comment: true,
  copyright: true,
  encoder: true,
  isrc: true,
});

const asSeed = integerConverter(0, 2 ** 32 - 1);
const asMetadataText = textConverter({ maximumLength: 65_536 });
const asTemplate = textConverter({ maximumLength: 1_024 });
const asChannelIndex = integerConverter(0, MAXIMUM_CHANNEL_COUNT - 1);
const asChannelIndices = listConverter(MAXIMUM_CHANNEL_COUNT, asChannelIndex);

const asChannels: Converter<ChannelConversion> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    keep: members('kind'),
    fold: members('kind', 'to'),
    matrix: members('kind', 'matrix'),
    map: members('kind', 'channels', 'to'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  switch (kind) {
    case 'keep':
      return { kind };
    case 'fold': {
      const to = required(reading, object, at, 'to', asChannelLayout);
      return to === undefined ? undefined : { kind, to };
    }
    case 'matrix': {
      const matrix = required(reading, object, at, 'matrix', asMatrix);
      return matrix === undefined ? undefined : { kind, matrix };
    }
    case 'map': {
      const channels = required(reading, object, at, 'channels', asChannelIndices);
      const to = required(reading, object, at, 'to', asChannelLayout);
      return channels === undefined || to === undefined ? undefined : { kind, channels, to };
    }
  }
};

const asDither: Converter<DitherSettings> = (reading, value, parent, key) => {
  const noise = members('kind', 'amplitude', 'shaping', 'seed');
  const read = kindOf(reading, value, parent, key, 'kind', {
    none: members('kind'),
    rectangular: noise,
    triangular: noise,
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  if (kind === 'none') return { kind };
  const amplitude = required(reading, object, at, 'amplitude', asFinite);
  const shaping = required(reading, object, at, 'shaping', asShaping);
  const seed = required(reading, object, at, 'seed', asSeed);
  return amplitude === undefined || shaping === undefined || seed === undefined
    ? undefined
    : { kind, amplitude, shaping, seed };
};

const asRange: Converter<ExportRange> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    project: members('kind'),
    region: members('kind', 'region'),
    'every-region': members('kind'),
    selection: members('kind', 'start', 'length'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  switch (kind) {
    case 'project':
    case 'every-region':
      return { kind };
    case 'region': {
      const region = required(reading, object, at, 'region', asId<'RegionId'>);
      return region === undefined ? undefined : { kind, region: unsafeBrandId<'RegionId'>(region) };
    }
    case 'selection': {
      const start = required(reading, object, at, 'start', asSampleCount);
      const length = required(reading, object, at, 'length', asSampleCount);
      return start === undefined || length === undefined ? undefined : { kind, start, length };
    }
  }
};

const asEdit: Converter<MetadataEdit> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    set: members('kind', 'key', 'value'),
    remove: members('kind', 'key'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  const field = required(reading, object, at, 'key', asTextKey);
  if (kind === 'remove') return field === undefined ? undefined : { kind, key: field };
  const text = required(reading, object, at, 'value', asMetadataText);
  return field === undefined || text === undefined ? undefined : { kind, key: field, value: text };
};

const asPolicy = oneOfConverter(['full', 'minimal', 'none'] as const);
const asEdits = listConverter(256, asEdit);

const asMetadata: Converter<MetadataSettings> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, members('policy', 'edits'));
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const policy = required(reading, object, at, 'policy', asPolicy);
  const edits = required(reading, object, at, 'edits', asEdits);
  return policy === undefined || edits === undefined ? undefined : { policy, edits };
};

/** Reads an export's settings (see the module comment). */
export const readExportSettings: Converter<ExportSettings> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SETTINGS_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const format = required(reading, object, at, 'format', asFormat);
  const sampleRate = required(reading, object, at, 'sampleRate', asSampleRate);
  const channels = required(reading, object, at, 'channels', asChannels);
  const dither = required(reading, object, at, 'dither', asDither);
  const range = required(reading, object, at, 'range', asRange);
  const metadata = required(reading, object, at, 'metadata', asMetadata);
  const fileName = required(reading, object, at, 'fileName', asTemplate);
  if (format === undefined) return undefined;
  const common =
    sampleRate === undefined ||
    channels === undefined ||
    dither === undefined ||
    range === undefined ||
    metadata === undefined ||
    fileName === undefined
      ? undefined
      : { sampleRate, channels, dither, range, metadata, fileName };
  return formatSettings(reading, format, object, at, common);
};

/** Writes an export's settings. */
export function writeExportSettings(settings: ExportSettings): JsonObject {
  return {
    format: settings.format,
    encoding: { ...settings.encoding },
    sampleRate: settings.sampleRate,
    channels: writeChannels(settings.channels),
    dither: { ...settings.dither },
    range: { ...settings.range },
    metadata: {
      policy: settings.metadata.policy,
      edits: settings.metadata.edits.map((edit) => ({ ...edit })),
    },
    fileName: settings.fileName,
  };
}

function writeChannels(channels: ChannelConversion): JsonObject {
  switch (channels.kind) {
    case 'keep':
    case 'matrix':
      return { ...channels };
    case 'fold':
      return { kind: channels.kind, to: writeLayout(channels.to) };
    case 'map':
      return presentMembers({
        kind: channels.kind,
        channels: [...channels.channels],
        to: writeLayout(channels.to),
      });
  }
}
