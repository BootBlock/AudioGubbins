/**
 * What this package's tests read a tree with: the Node digest, and the port
 * over the commands their histories record, each declaring the provenance its
 * arguments hold as a project command declares its own.
 */

import {
  ProvenanceArgument,
  invocationProvenance,
  type InvocationProvenance,
} from '../invocation-provenance.js';
import type { TreeReadingServices } from '../project-tree-reading.js';
import { nodeDigest } from './node-digest.js';

/** The port over the test histories' commands. */
export const TEST_INVOCATION_PROVENANCE: InvocationProvenance = invocationProvenance(
  new Map([
    ['project.rename', {}],
    ['test.add-asset', { asset: ProvenanceArgument.AssetRecord }],
    ['test.set-media', { media: ProvenanceArgument.MediaSource }],
    ['test.relink', { identity: ProvenanceArgument.ExternalIdentity }],
  ]),
);

/** What the tests read a tree with. */
export const TREE_READING: TreeReadingServices = {
  digest: nodeDigest,
  invocationProvenance: TEST_INVOCATION_PROVENANCE,
};
