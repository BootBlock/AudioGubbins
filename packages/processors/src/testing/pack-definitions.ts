/**
 * A model pack's committed definition (`tools/model-packs/packs/<id>.json`),
 * which the pack build makes the pack's files from and checks them by, read
 * for the tests that hold a processor's model to the pack it names.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A pack's definition, so far as a model's tests read it. */
export interface PackDefinition {
  readonly id: string;
  readonly version: string;
  readonly serves: { readonly processors: readonly string[] };
  readonly files: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly make: { readonly export?: { readonly arguments: readonly string[] } };
  }[];
}

/** Whether `value` is an object, whose members can be read. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** The strings of `value`, or nothing where it is not an array of strings. */
function stringsOf(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((one) => typeof one === 'string') ? value : undefined;
}

/** A file of a definition, read, or nothing where it is not one. */
function fileOf(value: unknown): PackDefinition['files'][number] | undefined {
  if (!isRecord(value) || !isRecord(value['make'])) return undefined;
  const { path, sha256 } = value;
  const made = value['make']['export'];
  const exported = isRecord(made) ? stringsOf(made['arguments']) : undefined;
  if (typeof path !== 'string' || typeof sha256 !== 'string') return undefined;
  if (made !== undefined && exported === undefined) return undefined;
  return { path, sha256, make: exported === undefined ? {} : { export: { arguments: exported } } };
}

/** The definition of the pack `id`; throws where the file is not one. */
export function packDefinition(id: string): PackDefinition {
  const parsed: unknown = JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../../tools/model-packs/packs/${id}.json`, import.meta.url)),
      'utf8',
    ),
  );
  const fail = (): never => {
    throw new Error(`tools/model-packs/packs/${id}.json is not a pack definition.`);
  };
  if (!isRecord(parsed) || !isRecord(parsed['serves'])) return fail();
  const { version, files } = parsed;
  const processors = stringsOf(parsed['serves']['processors']);
  const read = Array.isArray(files) ? files.map(fileOf) : [];
  const found = read.filter((file) => file !== undefined);
  if (
    parsed['id'] !== id ||
    typeof version !== 'string' ||
    processors === undefined ||
    !Array.isArray(files) ||
    found.length !== read.length
  ) {
    return fail();
  }
  return { id, version, serves: { processors }, files: found };
}

/** The SHA-256 of `text`'s UTF-8 bytes, in lower-case hexadecimal, as `modelHashOf` takes it. */
export function textSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
