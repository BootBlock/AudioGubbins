/**
 * Reading a project document's effect chains (REQ-STOR-026, REQ-EXEC-136.12).
 *
 * A processor's values are read as values a parameter may hold: a finite
 * number, a choice's key or a toggle. Whether each suits its parameter's range
 * and options is `validateProcessorInstance`'s question, which needs the
 * processor's descriptor, and descriptors belong to the processing registry
 * that loads a project, not to its file. A value in the file is never clamped
 * or repaired here.
 */

import type {
  EffectChain,
  ParameterId,
  ParameterValue,
  ProcessorId,
  ProcessorInstance,
} from '@audiogubbins/domain';

import type { JsonValue } from './canonical-json.js';
import {
  listOf,
  objectOf,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { asBoolean, asId } from './scalar-reading.js';
import { MAXIMUM_NESTED_ITEMS, NAME_RULE, asKey } from './value-reading.js';

const CHAIN_MEMBERS: ReadonlySet<string> = new Set(['id', 'processors']);
const PROCESSOR_MEMBERS: ReadonlySet<string> = new Set([
  'id',
  'typeKey',
  'enabled',
  'soloed',
  'values',
]);
const VALUE_MEMBERS: ReadonlySet<string> = new Set(['parameter', 'value']);

/**
 * A converter reading one effect chain. `processorIds` is shared by every chain
 * of the document, because a processor's identifier names it across the whole
 * project, not only within its chain.
 */
export function effectChainConverter(processorIds: Set<ProcessorId>): Converter<EffectChain> {
  const asProcessor = processorConverter(processorIds);

  return (reading, value, parent, key) => {
    const object = objectOf(reading, value, parent, key, CHAIN_MEMBERS);
    if (object === undefined) return undefined;
    const at = pathOf(parent, key);

    const id = required(reading, object, at, 'id', asId<'EffectChainId'>);
    const list = required(reading, object, at, 'processors', (inner, items, listParent, name) =>
      listOf(inner, items, listParent, name, MAXIMUM_NESTED_ITEMS),
    );
    if (id === undefined || list === undefined) return undefined;

    const listAt = pathOf(at, 'processors');
    const processors: ProcessorInstance[] = [];
    let whole = true;
    for (const [index, item] of list.entries()) {
      const processor = asProcessor(reading, item, listAt, index);
      if (processor === undefined) whole = false;
      else processors.push(processor);
    }
    return whole ? { id, processors } : undefined;
  };
}

/** A converter reading one processor, refusing an identifier already read. */
function processorConverter(processorIds: Set<ProcessorId>): Converter<ProcessorInstance> {
  return (reading, value, parent, key) => {
    const object = objectOf(reading, value, parent, key, PROCESSOR_MEMBERS);
    if (object === undefined) return undefined;
    const at = pathOf(parent, key);

    const id = required(reading, object, at, 'id', asId<'ProcessorId'>);
    const typeKey = required(reading, object, at, 'typeKey', asKey);
    const enabled = required(reading, object, at, 'enabled', asBoolean);
    const soloed = required(reading, object, at, 'soloed', asBoolean);
    const values = required(reading, object, at, 'values', readValues);

    if (id !== undefined) {
      if (processorIds.has(id)) {
        reading.refuse(
          'project.duplicate-processor',
          'Another processor in the project has the same identifier.',
          pathOf(at, 'id'),
        );
        return undefined;
      }
      processorIds.add(id);
    }
    if (
      id === undefined ||
      typeKey === undefined ||
      enabled === undefined ||
      soloed === undefined ||
      values === undefined
    ) {
      return undefined;
    }
    return { id, typeKey, enabled, soloed, values };
  };
}

/** Reads a processor's values, written as a list of parameter and value. */
function readValues(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
): ReadonlyMap<ParameterId, ParameterValue> | undefined {
  const list = listOf(reading, value, parent, key, MAXIMUM_NESTED_ITEMS);
  if (list === undefined) return undefined;
  const at = pathOf(parent, key);

  const values = new Map<ParameterId, ParameterValue>();
  let whole = true;
  for (const [index, item] of list.entries()) {
    const object = objectOf(reading, item, at, index, VALUE_MEMBERS);
    if (object === undefined) {
      whole = false;
      continue;
    }
    const itemAt = pathOf(at, index);
    const parameter = required(reading, object, itemAt, 'parameter', asId<'ParameterId'>);
    const parameterValue = required(reading, object, itemAt, 'value', asParameterValue);
    if (parameter === undefined || parameterValue === undefined) {
      whole = false;
    } else if (values.has(parameter)) {
      reading.refuse(
        'project.duplicate-parameter',
        'The processor holds two values for one parameter.',
        pathOf(itemAt, 'parameter'),
      );
      whole = false;
    } else {
      values.set(parameter, parameterValue);
    }
  }
  return whole ? values : undefined;
}

/** Reads a value a parameter may hold. */
const asParameterValue: Converter<ParameterValue> = (reading, value, parent, key) => {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string' && value.length <= NAME_RULE.maximumLength) return value;
  reading.refuse(
    'schema.unknown-value',
    'A parameter value is a number, a choice key of bounded length, or true or false.',
    pathOf(parent, key),
  );
  return undefined;
};
