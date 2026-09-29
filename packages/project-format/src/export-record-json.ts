/**
 * Writing and reading an export record as JSON, for the documents that keep a
 * project's export log (REQ-STOR-197, REQ-EXEC-136.12).
 *
 * A record is written as an object whose maps are lists sorted by name, and is
 * read back through the same validation as the project document, so a record
 * kept in a checkpoint or a bundle is held to one rule wherever it is kept.
 */

import type { JsonObject, JsonValue } from './canonical-json.js';
import { stateFingerprintFrom, type StateFingerprint } from './content-identity.js';
import {
  listConverter,
  listOf,
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import {
  asContentId,
  asId,
  integerConverter,
  oneOfConverter,
  textConverter,
} from './scalar-reading.js';
import { presentMembers, sortedBy } from './document-writing.js';
import {
  ExportDestinationKind,
  ExportStatus,
  type ExportDestination,
  type ExportOutput,
  type ExportRecipeReference,
  type ExportRecord,
  type GodotLinkage,
} from './export-provenance.js';
import {
  MAXIMUM_NESTED_ITEMS,
  NAME_RULE,
  asKey,
  asName,
  asWholeQuantity,
} from './value-reading.js';

const RECORD_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'at',
  'stateFingerprint',
  'historyNodeId',
  'recipe',
  'engineVersions',
  'output',
  'destination',
  'outputContentId',
  'godot',
  'status',
  'problems',
]);
const RECIPE_MEMBERS: ReadonlySet<string> = new Set(['id', 'version']);
const OUTPUT_MEMBERS: ReadonlySet<string> = new Set(['container', 'settings']);
const DESTINATION_MEMBERS: ReadonlySet<string> = new Set(['kind', 'label']);
const GODOT_MEMBERS: ReadonlySet<string> = new Set(['projectLabel', 'resources']);
const ENGINE_MEMBERS: ReadonlySet<string> = new Set(['name', 'version']);
const SETTING_MEMBERS: ReadonlySet<string> = new Set(['name', 'value']);

const asStatus = oneOfConverter(Object.values(ExportStatus));
const asDestinationKind = oneOfConverter(Object.values(ExportDestinationKind));
const asVersionText = textConverter({ maximumLength: 64 });
const asRecipeVersion = integerConverter(0, Number.MAX_SAFE_INTEGER);
const asProblems = listConverter(MAXIMUM_NESTED_ITEMS, textConverter(NAME_RULE));
const asResources = listConverter(
  MAXIMUM_NESTED_ITEMS,
  textConverter({
    maximumLength: NAME_RULE.maximumLength,
    pattern: /^res:\/\/\P{Cc}*$/u,
    shape: 'a res:// path',
  }),
);

/** Writes an export record. */
export function writeExportRecord(record: ExportRecord): JsonObject {
  return presentMembers({
    id: record.id,
    at: record.at,
    stateFingerprint: record.stateFingerprint,
    historyNodeId: record.historyNodeId,
    recipe:
      record.recipe === undefined
        ? undefined
        : { id: record.recipe.id, version: record.recipe.version },
    engineVersions: sortedBy(
      record.engineVersions,
      ([name]) => name,
      ([name, version]) => ({ name, version }),
    ),
    output: {
      container: record.output.container,
      settings: sortedBy(
        record.output.settings,
        ([name]) => name,
        ([name, value]) => ({ name, value }),
      ),
    },
    destination: presentMembers({ kind: record.destination.kind, label: record.destination.label }),
    outputContentId: record.outputContentId,
    godot:
      record.godot === undefined
        ? undefined
        : { projectLabel: record.godot.projectLabel, resources: [...record.godot.resources] },
    status: record.status,
    problems: [...record.problems],
  });
}

/** Reads an export record. */
export const readExportRecord: Converter<ExportRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RECORD_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const id = required(reading, object, at, 'id', asId<'ExportRecordId'>);
  const time = required(reading, object, at, 'at', asWholeQuantity);
  const stateFingerprint = required(reading, object, at, 'stateFingerprint', asFingerprint);
  const historyNodeId = optional(reading, object, at, 'historyNodeId', asId<'HistoryNodeId'>);
  const recipe = optional(reading, object, at, 'recipe', asRecipe);
  const engineVersions = required(reading, object, at, 'engineVersions', asEngineVersions);
  const output = required(reading, object, at, 'output', asOutput);
  const destination = required(reading, object, at, 'destination', asDestination);
  const outputContentId = optional(reading, object, at, 'outputContentId', asContentId);
  const godot = optional(reading, object, at, 'godot', asGodot);
  const status = required(reading, object, at, 'status', asStatus);
  const problems = required(reading, object, at, 'problems', asProblems);

  if (
    id === undefined ||
    time === undefined ||
    stateFingerprint === undefined ||
    engineVersions === undefined ||
    output === undefined ||
    destination === undefined ||
    status === undefined ||
    problems === undefined
  ) {
    return undefined;
  }
  return {
    id,
    at: time,
    stateFingerprint,
    ...(historyNodeId === undefined ? {} : { historyNodeId }),
    ...(recipe === undefined ? {} : { recipe }),
    engineVersions,
    output,
    destination,
    ...(outputContentId === undefined ? {} : { outputContentId }),
    ...(godot === undefined ? {} : { godot }),
    status,
    problems,
  };
};

const asFingerprint: Converter<StateFingerprint> = (reading, value, parent, key) => {
  const read = typeof value === 'string' ? stateFingerprintFrom(value) : undefined;
  if (read?.ok === true) return read.value;
  reading.refuse(
    'schema.malformed-fingerprint',
    'A state fingerprint is expected here.',
    pathOf(parent, key),
  );
  return undefined;
};

const asRecipe: Converter<ExportRecipeReference> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RECIPE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const id = required(reading, object, at, 'id', asKey);
  const version = required(reading, object, at, 'version', asRecipeVersion);
  return id === undefined || version === undefined ? undefined : { id, version };
};

/**
 * Reads a list of named entries into a map, refusing a name read already.
 * `entry` reads one entry's value from its object.
 */
function namedEntries<TValue>(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
  members: ReadonlySet<string>,
  valueKey: string,
  convert: Converter<TValue>,
): ReadonlyMap<string, TValue> | undefined {
  const list = listOf(reading, value, parent, key, MAXIMUM_NESTED_ITEMS);
  if (list === undefined) return undefined;
  const at = pathOf(parent, key);

  const entries = new Map<string, TValue>();
  let whole = true;
  for (const [index, item] of list.entries()) {
    const object = objectOf(reading, item, at, index, members);
    const itemAt = pathOf(at, index);
    const name =
      object === undefined ? undefined : required(reading, object, itemAt, 'name', asKey);
    const read =
      object === undefined ? undefined : required(reading, object, itemAt, valueKey, convert);
    if (name === undefined || read === undefined) {
      whole = false;
    } else if (entries.has(name)) {
      reading.refuse(
        'schema.duplicate-name',
        'Another entry in this list has the same name.',
        pathOf(itemAt, 'name'),
      );
      whole = false;
    } else {
      entries.set(name, read);
    }
  }
  return whole ? entries : undefined;
}

const asEngineVersions: Converter<ReadonlyMap<string, string>> = (reading, value, parent, key) =>
  namedEntries(reading, value, parent, key, ENGINE_MEMBERS, 'version', asVersionText);

const asSettingValue: Converter<string | number | boolean> = (reading, value, parent, key) => {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string' && value.length <= NAME_RULE.maximumLength) return value;
  reading.refuse(
    'schema.unknown-value',
    'A setting is a number, text of bounded length, or true or false.',
    pathOf(parent, key),
  );
  return undefined;
};

const asOutput: Converter<ExportOutput> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, OUTPUT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const container = required(reading, object, at, 'container', asKey);
  const settings = required(reading, object, at, 'settings', (inner, list, listParent, name) =>
    namedEntries(inner, list, listParent, name, SETTING_MEMBERS, 'value', asSettingValue),
  );
  return container === undefined || settings === undefined ? undefined : { container, settings };
};

const asDestination: Converter<ExportDestination> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, DESTINATION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asDestinationKind);
  const label = optional(reading, object, at, 'label', asName);
  return kind === undefined ? undefined : { kind, ...(label === undefined ? {} : { label }) };
};

const asGodot: Converter<GodotLinkage> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, GODOT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const projectLabel = required(reading, object, at, 'projectLabel', asName);
  const resources = required(reading, object, at, 'resources', asResources);
  return projectLabel === undefined || resources === undefined
    ? undefined
    : { projectLabel, resources };
};
