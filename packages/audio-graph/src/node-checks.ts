/**
 * The checks on each node of a flattened graph taken alone: that its
 * identifier is its own, that its type has a contract, that its ports have
 * names that tell them apart and suit its role, and whatever its contract
 * checks of its settings and layouts.
 */

import type { ProcessingNodeDescriptor } from './descriptor.js';
import type { GraphDiagnostic } from './diagnostic.js';
import { NodeRole, type NodeCatalogue, type NodeContract } from './node-contract.js';
import type { NodeId } from './node-id.js';

/** A node whose identifier is its own, with the contract its type names, if any. */
export interface CheckedNode {
  readonly descriptor: ProcessingNodeDescriptor;
  readonly contract: NodeContract | undefined;
}

/** What checking the nodes found. */
export interface NodeCheck {
  /** The first node declared under each identifier, in declaration order. */
  readonly nodes: ReadonlyMap<NodeId, CheckedNode>;
  readonly diagnostics: readonly GraphDiagnostic[];
}

/** Which sides of a node each role gives ports to. */
const PORTS_OF_ROLE: Readonly<
  Record<NodeRole, { readonly inputs: boolean; readonly outputs: boolean }>
> = {
  [NodeRole.Source]: { inputs: false, outputs: true },
  [NodeRole.Processor]: { inputs: true, outputs: true },
  [NodeRole.Analysis]: { inputs: true, outputs: false },
  [NodeRole.Sink]: { inputs: true, outputs: false },
};

function duplicatePorts(
  node: ProcessingNodeDescriptor,
  side: 'inputs' | 'outputs',
): readonly GraphDiagnostic[] {
  const seen = new Set<string>();
  const found: GraphDiagnostic[] = [];
  for (const { name } of node[side]) {
    if (seen.has(name)) {
      found.push({
        code: 'port-name-duplicate',
        message: `Node ${node.id} has two ${side} named "${name}". Give each port on one side its own name.`,
        node: node.id,
        port: name,
      });
    }
    seen.add(name);
  }
  return found;
}

function rolePorts(node: ProcessingNodeDescriptor, role: NodeRole): readonly GraphDiagnostic[] {
  const expected = PORTS_OF_ROLE[role];
  return (['inputs', 'outputs'] satisfies readonly ('inputs' | 'outputs')[]).flatMap((side) => {
    const has = node[side].length > 0;
    if (has === expected[side]) return [];
    const wanted = expected[side] ? 'needs at least one' : 'cannot have';
    return [
      {
        code: 'role-ports-invalid',
        message: `Node ${node.id} is a ${role} of type "${node.type}", which ${wanted} ${side === 'inputs' ? 'input' : 'output'}. Give it the ports its type declares.`,
        node: node.id,
      },
    ];
  });
}

/** Every problem with one node whose identifier is its own. */
function problemsOf(
  node: ProcessingNodeDescriptor,
  contract: NodeContract | undefined,
): readonly GraphDiagnostic[] {
  const found = [...duplicatePorts(node, 'inputs'), ...duplicatePorts(node, 'outputs')];
  if (contract === undefined) {
    found.push({
      code: 'node-type-unknown',
      message: `Node ${node.id} has the type "${node.type}", which no processor in this build provides. Choose an available type, or remove the node.`,
      node: node.id,
    });
    return found;
  }
  found.push(...rolePorts(node, contract.role));
  // The contract names the node itself, so a diagnostic it forgot to place,
  // or placed on the wrong node, is still reported where it belongs.
  found.push(...contract.check(node).map((problem) => ({ ...problem, node: node.id })));
  return found;
}

function isKnown(contract: NodeContract | undefined): contract is NodeContract {
  return contract !== undefined;
}

/** Checks each node of a flattened graph, in declaration order. */
export function checkNodes(
  nodes: readonly ProcessingNodeDescriptor[],
  catalogue: NodeCatalogue,
): NodeCheck {
  const checked = new Map<NodeId, CheckedNode>();
  const diagnostics: GraphDiagnostic[] = [];
  for (const node of nodes) {
    if (checked.has(node.id)) {
      diagnostics.push({
        code: 'node-id-duplicate',
        message: `Two nodes are named ${node.id}. Give each node in the graph its own identifier.`,
        node: node.id,
      });
      continue;
    }
    const contract = catalogue.get(node.type);
    checked.set(node.id, { descriptor: node, contract });
    diagnostics.push(...problemsOf(node, contract));
  }
  const contracts = [...checked.values()].map((one) => one.contract);
  // Where a type is unknown, it may be the sink the graph was meant to have,
  // and saying there is none would send the reader after the wrong problem.
  if (contracts.every(isKnown) && !contracts.some((contract) => contract.role === NodeRole.Sink)) {
    diagnostics.push({
      code: 'no-sink',
      message:
        'The graph has no sink, so its audio goes nowhere. Connect the final output to a sink node.',
    });
  }
  return { nodes: checked, diagnostics };
}
