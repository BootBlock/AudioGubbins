/**
 * How a node in a processing graph is named, and how an edge names a port.
 *
 * A node's identifier is one or more lower-case segments joined by `/`. The
 * slash is what flattening a reusable subgraph writes between the subgraph's
 * identifier and its inner node's, so every node of a flattened graph keeps a
 * name that says where it came from, and two placements of one subgraph cannot
 * collide (REQ-ARCH-140).
 */

import { failure, FailureKind, type DomainResult, fail, succeed } from '@audiogubbins/domain';

declare const NodeIdTag: unique symbol;

/** Identifies one node of a processing graph. */
export type NodeId = string & { readonly [NodeIdTag]: 'NodeId' };

/** One port of one node, as an edge or a subgraph's boundary names it. */
export interface PortReference {
  readonly node: NodeId;
  readonly port: string;
}

/**
 * The shape of a node identifier.
 *
 * Each segment starts with a letter or a digit, so neither an empty segment
 * nor a leading hyphen can make two spellings of one path.
 */
const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;

/** Builds a validated {@link NodeId}. */
export function nodeId(value: string): DomainResult<NodeId> {
  if (!NODE_ID_PATTERN.test(value)) {
    return fail(
      failure(
        'graph.node-id-invalid',
        FailureKind.Rejected,
        'A node identifier is one or more segments of lower-case letters, digits and hyphens, joined by "/", each starting with a letter or a digit.',
        { details: { value } },
      ),
    );
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a brand is minted here, after the check above
  return succeed(value as NodeId);
}

/**
 * The identifier an inner node of a subgraph takes once the subgraph is
 * flattened into the graph that places it.
 */
export function childNodeId(parent: NodeId, child: NodeId): NodeId {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- two well-formed identifiers joined by "/" are one by the pattern above
  return `${parent}/${child}` as NodeId;
}
