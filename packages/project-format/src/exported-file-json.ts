/**
 * Writing and reading the audio file an export wrote, as its export record
 * keeps it (`export-provenance.ts`, ADR-0092, REQ-STOR-197): the settings it
 * was made with, its name where provenance keeps it, its size and SHA-256,
 * the codec and its version, and whether its bytes are reproducible.
 */

import type { JsonObject } from './canonical-json.js';
import { asCodec, asImplementation } from './codec-names-reading.js';
import { DIGEST_HEX } from './content-identity.js';
import { objectOf, optional, pathOf, required, type Converter } from './document-reading.js';
import { presentMembers } from './document-writing.js';
import type { ExportCodec, ExportedAudioFile } from './export-provenance.js';
import { readExportSettings, writeExportSettings } from './export-settings-json.js';
import { asBoolean, textConverter } from './scalar-reading.js';
import { asFileName } from './source-rules.js';
import { asWholeQuantity } from './value-reading.js';

const FILE_MEMBERS: ReadonlySet<string> = new Set([
  'settings',
  'fileName',
  'byteLength',
  'sha256',
  'codec',
  'reproducible',
]);
const CODEC_MEMBERS: ReadonlySet<string> = new Set(['id', 'implementation', 'version']);
const asSha256 = textConverter({
  maximumLength: 64,
  pattern: DIGEST_HEX,
  shape: '64 lower-case hexadecimal digits',
});

const asCodecVersion = textConverter({ maximumLength: 256 });

const asExportCodec: Converter<ExportCodec> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, CODEC_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const id = required(reading, object, at, 'id', asCodec);
  const implementation = required(reading, object, at, 'implementation', asImplementation);
  const version = required(reading, object, at, 'version', asCodecVersion);
  return id === undefined || implementation === undefined || version === undefined
    ? undefined
    : { id, implementation, version };
};

/** Reads the audio file an export wrote. */
export const readExportedFile: Converter<ExportedAudioFile> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, FILE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const settings = required(reading, object, at, 'settings', readExportSettings);
  const fileName = optional(reading, object, at, 'fileName', asFileName);
  const byteLength = required(reading, object, at, 'byteLength', asWholeQuantity);
  const sha256 = required(reading, object, at, 'sha256', asSha256);
  const codec = required(reading, object, at, 'codec', asExportCodec);
  const reproducible = required(reading, object, at, 'reproducible', asBoolean);
  if (
    settings === undefined ||
    byteLength === undefined ||
    sha256 === undefined ||
    codec === undefined ||
    reproducible === undefined
  ) {
    return undefined;
  }
  return {
    settings,
    ...(fileName === undefined ? {} : { fileName }),
    byteLength,
    sha256,
    codec,
    reproducible,
  };
};

/** Writes the audio file an export wrote. */
export function writeExportedFile(file: ExportedAudioFile): JsonObject {
  return presentMembers({
    settings: writeExportSettings(file.settings),
    fileName: file.fileName,
    byteLength: file.byteLength,
    sha256: file.sha256,
    codec: {
      id: file.codec.id,
      implementation: file.codec.implementation,
      version: file.codec.version,
    },
    reproducible: file.reproducible,
  });
}
