/**
 * What two opened projects must agree on to be the same project: the whole
 * model, each part as the format writes it to be kept. Every part goes through
 * its canonical writer, so a field the format comes to keep is compared as soon
 * as it is written, and the summary is built member by member over every member
 * of the model, so a member added to the model fails to compile here until it
 * is compared. The fingerprints a checkpoint adds to nodes are left out, since
 * they record where a state is kept, not what the project is.
 */

import { historyRecordOf, type History } from '@audiogubbins/history';
import {
  canonicalJson,
  writeBackupPolicy,
  writeComparisonChoice,
  writeExportRecord,
  writeHistoryRecord,
  writeProjectDocument,
  writeRetentionPolicy,
  type HistoryNodeRecord,
  type JsonValue,
} from '@audiogubbins/project-format';

import { choiceOf } from '../comparison-record.js';
import type { ProjectModel } from '../project-model.js';

/** A comparable summary of a project. */
export function summaryOf(model: ProjectModel): string {
  const summary: { readonly [Member in keyof Required<ProjectModel>]: JsonValue } = {
    state: writeProjectDocument(model.state),
    history: historyWithoutFingerprints(model.history),
    exports: model.exports.map(writeExportRecord),
    retention: writeRetentionPolicy(model.retention),
    backup: writeBackupPolicy(model.backup),
    comparison:
      model.comparison === undefined ? null : writeComparisonChoice(choiceOf(model.comparison)),
  };
  return canonicalJson(summary);
}

/** The history as it is written, without the fingerprints its nodes learned. */
function historyWithoutFingerprints(history: History): JsonValue {
  const record = historyRecordOf(history);
  return writeHistoryRecord({ ...record, nodes: record.nodes.map(withoutFingerprint) });
}

function withoutFingerprint(node: HistoryNodeRecord): HistoryNodeRecord {
  const { stateFingerprint: _learned, ...rest } = node;
  return rest;
}
