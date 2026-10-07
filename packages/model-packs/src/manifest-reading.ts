/**
 * The one reader of a model pack's manifest, and of the catalogue that lists
 * them, from text nobody here wrote (ADR-0062, REQ-EXEC-136.12).
 *
 * A manifest arrives from the catalogue the build configures or from a file the
 * person has, and the storage keeps the manifest of each pack it holds, so all
 * three are read here and refused the same way: every problem at once, each
 * with its path in the document and never the value it found. Text, nesting,
 * lists and numbers are bounded before anything is believed; a hash is 64
 * lower-case hexadecimal digits; a file's path stays inside its pack. The
 * download size must be the files' sum, since that is what a download transfers
 * and its progress is counted against.
 */

import { QualityLevel, type DomainResult, type NamedQualityLevel } from '@audiogubbins/domain';
import {
  integerConverter,
  objectOf,
  oneOfConverter,
  parseJson,
  pathOf,
  required,
  startReading,
  textConverter,
  type Converter,
  type JsonLimits,
  type JsonValue,
  type Reading,
} from '@audiogubbins/project-format';

import {
  PackCapability,
  type ModelPackManifest,
  type PackFile,
  type PackLicence,
  type PackRuntime,
  type PackServes,
} from './manifest.js';
import { distinctList } from './distinct-list.js';
import { MANIFEST_FORMAT } from './manifest-writing.js';
import { readFiles } from './pack-files.js';
import { LONGEST_VERSION, PACK_VERSION, compareVersions } from './pack-version.js';

/** The most a pack may take installed: 16 GiB, a bound on what is believed. */
const MOST_PACK_BYTES = 2 ** 34;

/** A manifest's text: 64 files of long paths fit many times over. */
export const MANIFEST_LIMITS: JsonLimits = { maximumLength: 256 * 1024, maximumDepth: 6 };

const MOST_TYPE_KEYS = 32;

/** Prose a person can read: no control character, nothing blank at either end. */
const PROSE = /^(?!\s)[^\p{Cc}]*(?<!\s)$/u;

const NAMED_LEVELS: readonly NamedQualityLevel[] = [
  QualityLevel.Draft,
  QualityLevel.Standard,
  QualityLevel.High,
  QualityLevel.Maximum,
];

const CAPABILITIES: readonly PackCapability[] = Object.values(PackCapability);

const MANIFEST_MEMBERS: ReadonlySet<string> = new Set([
  'format',
  'id',
  'name',
  'purpose',
  'version',
  'downloadBytes',
  'installedBytes',
  'files',
  'licence',
  'runtime',
  'tiers',
  'serves',
]);
const LICENCE_MEMBERS: ReadonlySet<string> = new Set(['code', 'weights']);
const RUNTIME_MEMBERS: ReadonlySet<string> = new Set(['name', 'minimum', 'below', 'capabilities']);
const SERVES_MEMBERS: ReadonlySet<string> = new Set(['processors', 'detectors']);

const asPackId = textConverter({
  maximumLength: 64,
  pattern: /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u,
  shape: 'a name of lower-case letters, digits and inner hyphens',
});
const asName = textConverter({
  maximumLength: 80,
  pattern: /^(?!\s)[^\p{Cc}]+(?<!\s)$/u,
  shape: 'a name with no control character or surrounding space',
});
const asPurpose = textConverter({
  maximumLength: 500,
  pattern: PROSE,
  shape: 'prose with no control character or surrounding space',
});
const asVersion = textConverter({
  maximumLength: LONGEST_VERSION,
  pattern: PACK_VERSION,
  shape: 'a version of three whole numbers, major.minor.patch, without leading zeros',
});
const asLicence = textConverter({
  maximumLength: 100,
  pattern: /^[A-Za-z0-9][A-Za-z0-9.+ ()-]*(?<! )$/u,
  shape: 'an SPDX licence expression',
});
const asRuntimeName = textConverter({
  maximumLength: 64,
  pattern: /^[a-z0-9][a-z0-9.-]{0,63}$/u,
  shape: 'a runtime name of lower-case letters, digits, dots and hyphens',
});
const asTypeKey = textConverter({
  maximumLength: 64,
  pattern: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u,
  shape: 'a type key of lower-case words joined by hyphens',
});
const asPackBytes = integerConverter(1, MOST_PACK_BYTES);

const readLicence: Converter<PackLicence> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, LICENCE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const code = required(reading, object, at, 'code', asLicence);
  const weights = required(reading, object, at, 'weights', asLicence);
  return code === undefined || weights === undefined ? undefined : { code, weights };
};

const readCapabilities = distinctList(
  CAPABILITIES.length,
  oneOfConverter(CAPABILITIES),
  (capability) => capability,
  'A capability is named once.',
  0,
);

const readRuntime: Converter<PackRuntime> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RUNTIME_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const name = required(reading, object, at, 'name', asRuntimeName);
  const minimum = required(reading, object, at, 'minimum', asVersion);
  const below = required(reading, object, at, 'below', asVersion);
  const capabilities = required(reading, object, at, 'capabilities', readCapabilities);
  if (
    name === undefined ||
    minimum === undefined ||
    below === undefined ||
    capabilities === undefined
  ) {
    return undefined;
  }
  if ((compareVersions(minimum, below) ?? 0) >= 0) {
    reading.refuse(
      'model-pack.runtime-range-empty',
      'The runtime versions run from the minimum up to a higher version below which they stop.',
      pathOf(at, 'below'),
    );
    return undefined;
  }
  return { name, minimum, below, capabilities };
};

const readTiers = distinctList(
  NAMED_LEVELS.length,
  oneOfConverter(NAMED_LEVELS),
  (tier) => tier,
  'A quality tier is named once.',
);

const readTypeKeys = distinctList(
  MOST_TYPE_KEYS,
  asTypeKey,
  (typeKey) => typeKey,
  'A type key is named once.',
  0,
);

const readServes: Converter<PackServes> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SERVES_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const processors = required(reading, object, at, 'processors', readTypeKeys);
  const detectors = required(reading, object, at, 'detectors', readTypeKeys);
  if (processors === undefined || detectors === undefined) return undefined;
  if (processors.length + detectors.length === 0) {
    reading.refuse(
      'model-pack.serves-nothing',
      'A pack serves one processor or detector at least.',
      at,
    );
    return undefined;
  }
  return { processors, detectors };
};

/** Reads the format a manifest or a catalogue is written in. */
export const readFormat: Converter<number> = (reading, value, parent, key) => {
  if (value === MANIFEST_FORMAT) return value;
  reading.refuse(
    'model-pack.format-unknown',
    `This build reads format ${String(MANIFEST_FORMAT)} alone.`,
    pathOf(parent, key),
  );
  return undefined;
};

/**
 * Whether the sizes a manifest states hold of its files: the download is their
 * sum, since that is what a download transfers and counts its progress against,
 * and the pack takes at least that once installed.
 */
function sizesHold(
  reading: Reading,
  at: string,
  files: readonly PackFile[],
  downloadBytes: number,
  installedBytes: number,
): boolean {
  const sum = files.reduce((total, file) => total + file.bytes, 0);
  if (downloadBytes !== sum) {
    reading.refuse(
      'model-pack.download-size-mismatch',
      'The download size is not the sum of the files the pack names.',
      pathOf(at, 'downloadBytes'),
      { stated: downloadBytes, files: sum },
    );
    return false;
  }
  if (installedBytes < downloadBytes) {
    reading.refuse(
      'model-pack.installed-size-short',
      'A pack takes at least its files once installed.',
      pathOf(at, 'installedBytes'),
    );
    return false;
  }
  return true;
}

/** Reads a manifest held in a document, such as a catalogue's or a kept record's. */
export const manifestConverter: Converter<ModelPackManifest> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, MANIFEST_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const format = required(reading, object, at, 'format', readFormat);
  const id = required(reading, object, at, 'id', asPackId);
  const name = required(reading, object, at, 'name', asName);
  const purpose = required(reading, object, at, 'purpose', asPurpose);
  const version = required(reading, object, at, 'version', asVersion);
  const downloadBytes = required(reading, object, at, 'downloadBytes', asPackBytes);
  const installedBytes = required(reading, object, at, 'installedBytes', asPackBytes);
  const files = required(reading, object, at, 'files', readFiles);
  const licence = required(reading, object, at, 'licence', readLicence);
  const runtime = required(reading, object, at, 'runtime', readRuntime);
  const tiers = required(reading, object, at, 'tiers', readTiers);
  const serves = required(reading, object, at, 'serves', readServes);
  if (
    format === undefined ||
    id === undefined ||
    name === undefined ||
    purpose === undefined ||
    version === undefined ||
    downloadBytes === undefined ||
    installedBytes === undefined ||
    files === undefined ||
    licence === undefined ||
    runtime === undefined ||
    tiers === undefined ||
    serves === undefined
  ) {
    return undefined;
  }
  if (!sizesHold(reading, at, files, downloadBytes, installedBytes)) return undefined;
  return {
    id,
    name,
    purpose,
    version,
    downloadBytes,
    installedBytes,
    files,
    licence,
    runtime,
    tiers,
    serves,
  };
};

/** The manifest a parsed document holds, or every problem with it. */
function manifestFromJson(value: JsonValue): DomainResult<ModelPackManifest> {
  const reading = startReading();
  return reading.outcome(manifestConverter(reading, value, '', 'manifest'));
}

/** Reads a manifest from its text, refusing it with every reason it is not one. */
export function readModelPackManifest(text: string): DomainResult<ModelPackManifest> {
  const parsed = parseJson(text, MANIFEST_LIMITS);
  return parsed.ok ? manifestFromJson(parsed.value) : parsed;
}
