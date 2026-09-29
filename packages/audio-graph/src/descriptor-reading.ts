/**
 * Reading a graph descriptor out of an untrusted value.
 *
 * A descriptor posted to a worker or an AudioWorklet arrives as a structured
 * clone, typed as nothing (REQ-EXEC-136.12). This reads it field by field and
 * builds a new descriptor from what it read, so a field the type does not name
 * is left behind and a value that only looks right, such as a forged layout, is
 * rebuilt by the code that owns it. Every problem is reported, each at the path
 * in the value where it was found.
 *
 * A structured clone keeps shared and circular references, so a subgraph that
 * contains itself can arrive. It is refused where it recurs rather than read
 * until the stack runs out.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import {
  GRAPH_DESCRIPTOR_VERSION,
  type EdgeDescriptor,
  type GraphDescriptor,
  type NodeDescriptor,
  type PortDescriptor,
  type ProcessingNodeDescriptor,
  type SettingValue,
  type SubgraphInput,
  type SubgraphNodeDescriptor,
  type SubgraphOutput,
} from './descriptor.js';
import { readLayout } from './layout-reading.js';
import { nodeId, type NodeId, type PortReference } from './node-id.js';
import {
  type FieldRecord,
  type Problems,
  readEach,
  readFiniteNumber,
  readName,
  readRecord,
  readText,
  report,
} from './value-reading.js';

/** The graphs a subgraph being read sits inside, which it may not be one of. */
type Ancestors = ReadonlySet<FieldRecord>;

function readNodeId(value: unknown, path: string, problems: Problems): NodeId | undefined {
  if (typeof value !== 'string') {
    report(problems, 'shape-invalid', path, 'expected a node identifier.');
    return undefined;
  }
  const id = nodeId(value);
  if (id.ok) return id.value;
  report(problems, 'node-id-invalid', path, id.failures[0].summary, id.failures[0]);
  return undefined;
}

function readReference(
  value: unknown,
  path: string,
  problems: Problems,
): PortReference | undefined {
  const record = readRecord(value, path, problems);
  if (record === undefined) return undefined;
  const node = readNodeId(record['node'], `${path}.node`, problems);
  const port = readName(record['port'], `${path}.port`, problems);
  return node === undefined || port === undefined ? undefined : { node, port };
}

/** Reads the name and layout every port has, a subgraph's boundary ports among them. */
function readPortFields(
  record: FieldRecord,
  path: string,
  problems: Problems,
): PortDescriptor | undefined {
  const name = readName(record['name'], `${path}.name`, problems);
  const layout = readLayout(record['layout'], `${path}.layout`, problems);
  return name === undefined || layout === undefined ? undefined : { name, layout };
}

function readPorts(
  value: unknown,
  path: string,
  problems: Problems,
): readonly PortDescriptor[] | undefined {
  return readEach(value, path, problems, (port, portPath) => {
    const record = readRecord(port, portPath, problems);
    return record === undefined ? undefined : readPortFields(record, portPath, problems);
  });
}

function readSetting(value: unknown, path: string, problems: Problems): SettingValue | undefined {
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return readEach(value, path, problems, (element, elementPath) =>
      readFiniteNumber(element, elementPath, problems),
    );
  }
  return readFiniteNumber(value, path, problems);
}

function readSettings(
  value: unknown,
  path: string,
  problems: Problems,
): Readonly<Record<string, SettingValue>> | undefined {
  const record = readRecord(value, path, problems);
  if (record === undefined) return undefined;
  const settings: [string, SettingValue][] = [];
  let complete = true;
  for (const [key, setting] of Object.entries(record)) {
    const name = readName(key, `${path}.${key}`, problems);
    const read = readSetting(setting, `${path}.${key}`, problems);
    if (name === undefined || read === undefined) complete = false;
    else settings.push([name, read]);
  }
  return complete ? Object.fromEntries(settings) : undefined;
}

function readProcessingNode(
  record: FieldRecord,
  path: string,
  problems: Problems,
): ProcessingNodeDescriptor | undefined {
  const id = readNodeId(record['id'], `${path}.id`, problems);
  const type = readText(record['type'], `${path}.type`, problems);
  const inputs = readPorts(record['inputs'], `${path}.inputs`, problems);
  const outputs = readPorts(record['outputs'], `${path}.outputs`, problems);
  const settings = readSettings(record['settings'], `${path}.settings`, problems);
  if (id === undefined || type === undefined || settings === undefined) return undefined;
  if (inputs === undefined || outputs === undefined) return undefined;
  return { kind: 'processing', id, type, inputs, outputs, settings };
}

function readSubgraphInput(
  value: unknown,
  path: string,
  problems: Problems,
): SubgraphInput | undefined {
  const record = readRecord(value, path, problems);
  if (record === undefined) return undefined;
  const port = readPortFields(record, path, problems);
  const to = readEach(record['to'], `${path}.to`, problems, (target, targetPath) =>
    readReference(target, targetPath, problems),
  );
  return port === undefined || to === undefined ? undefined : { ...port, to };
}

function readSubgraphOutput(
  value: unknown,
  path: string,
  problems: Problems,
): SubgraphOutput | undefined {
  const record = readRecord(value, path, problems);
  if (record === undefined) return undefined;
  const port = readPortFields(record, path, problems);
  const from = readReference(record['from'], `${path}.from`, problems);
  return port === undefined || from === undefined ? undefined : { ...port, from };
}

function readSubgraphNode(
  record: FieldRecord,
  path: string,
  problems: Problems,
  ancestors: Ancestors,
): SubgraphNodeDescriptor | undefined {
  const id = readNodeId(record['id'], `${path}.id`, problems);
  const graph = readGraph(record['graph'], `${path}.graph`, problems, ancestors);
  const inputs = readEach(record['inputs'], `${path}.inputs`, problems, (input, inputPath) =>
    readSubgraphInput(input, inputPath, problems),
  );
  const outputs = readEach(record['outputs'], `${path}.outputs`, problems, (output, outputPath) =>
    readSubgraphOutput(output, outputPath, problems),
  );
  if (id === undefined || graph === undefined) return undefined;
  if (inputs === undefined || outputs === undefined) return undefined;
  return { kind: 'subgraph', id, graph, inputs, outputs };
}

function readNode(
  value: unknown,
  path: string,
  problems: Problems,
  ancestors: Ancestors,
): NodeDescriptor | undefined {
  const record = readRecord(value, path, problems);
  if (record === undefined) return undefined;
  const kind = record['kind'];
  if (kind === 'processing') return readProcessingNode(record, path, problems);
  if (kind === 'subgraph') return readSubgraphNode(record, path, problems, ancestors);
  report(problems, 'shape-invalid', `${path}.kind`, 'expected "processing" or "subgraph".');
  return undefined;
}

function readEdge(value: unknown, path: string, problems: Problems): EdgeDescriptor | undefined {
  const record = readRecord(value, path, problems);
  if (record === undefined) return undefined;
  const from = readReference(record['from'], `${path}.from`, problems);
  const to = readReference(record['to'], `${path}.to`, problems);
  return from === undefined || to === undefined ? undefined : { from, to };
}

function readGraph(
  value: unknown,
  path: string,
  problems: Problems,
  ancestors: Ancestors,
): GraphDescriptor | undefined {
  const record = readRecord(value, path, problems);
  if (record === undefined) return undefined;
  if (ancestors.has(record)) {
    report(
      problems,
      'subgraph-recursive',
      path,
      'a subgraph contains itself; place a copy of it instead.',
    );
    return undefined;
  }
  const version = record['version'];
  if (version !== GRAPH_DESCRIPTOR_VERSION) {
    report(
      problems,
      'version-unsupported',
      `${path}.version`,
      `this build reads graph descriptor version ${String(GRAPH_DESCRIPTOR_VERSION)}; send the descriptor from a build of the same version.`,
    );
  }
  const inner = new Set([...ancestors, record]);
  const nodes = readEach(record['nodes'], `${path}.nodes`, problems, (node, nodePath) =>
    readNode(node, nodePath, problems, inner),
  );
  const edges = readEach(record['edges'], `${path}.edges`, problems, (edge, edgePath) =>
    readEdge(edge, edgePath, problems),
  );
  if (version !== GRAPH_DESCRIPTOR_VERSION || nodes === undefined || edges === undefined) {
    return undefined;
  }
  return { version, nodes, edges };
}

/**
 * Reads a graph descriptor from a value of unknown shape, refusing it with
 * every problem found: a version this build does not read, a field of the
 * wrong shape, an ill-formed identifier or name, a number that is not finite,
 * a layout the domain would not build, or a subgraph that contains itself.
 */
export function readGraphDescriptor(value: unknown): DomainResult<GraphDescriptor> {
  const problems: Problems = [];
  const graph = readGraph(value, 'graph', problems, new Set());
  const [first, ...rest] = problems;
  if (first !== undefined) return fail(first, ...rest);
  if (graph === undefined) {
    throw new Error('A graph descriptor was refused without a reason being recorded.');
  }
  return succeed(graph);
}
