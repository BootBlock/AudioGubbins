/**
 * What two opened projects must agree on to be the same project: the state's
 * canonical text, the cursor, every node, branch name and snapshot, the export
 * log, the policies and the comparison. The fingerprints a checkpoint adds to
 * nodes are left out, since they record where a state is kept, not what the
 * project is.
 */

import {
  canonicalJson,
  compareCodeUnits,
  writeProjectDocument,
} from '@audiogubbins/project-format';

import type { ProjectModel } from '../project-model.js';

/** A comparable summary of a project. */
export function summaryOf(model: ProjectModel): string {
  const { history } = model;
  const nodes = [...history.nodes.values()]
    .map((node) =>
      node.kind === 'origin'
        ? `${node.id} origin`
        : `${node.id} < ${String(node.parent)} ${node.description} ${JSON.stringify(node.forward)} ${JSON.stringify(node.inverse)}`,
    )
    .sort(compareCodeUnits);
  const snapshots = [...history.snapshots.values()]
    .map(
      (snapshot) => `${snapshot.id} ${snapshot.node} ${snapshot.name} ${snapshot.stateFingerprint}`,
    )
    .sort(compareCodeUnits);
  const branches = [...history.branchNames]
    .map(([node, name]) => `${node} ${name}`)
    .sort(compareCodeUnits);
  return JSON.stringify({
    state: canonicalJson(writeProjectDocument(model.state)),
    cursor: history.cursor,
    preferred: [...history.preferred.entries()]
      .map(([node, child]) => `${node} ${child}`)
      .sort(compareCodeUnits),
    nodes,
    snapshots,
    branches,
    exports: model.exports.map((record) => record.id),
    retention: model.retention,
    backup: model.backup,
    comparison:
      model.comparison === undefined
        ? null
        : [model.comparison.a.node, model.comparison.b.node, model.comparison.listening],
  });
}
