/**
 * Where a project names a take stack: the punch edits that read its chosen
 * take (ADR-0072). A stack a punch edit names cannot be removed while the
 * edit does, and a change to the stack's choice reaches each of them.
 */

import type { AssetId, EditOperationId, TakeStackId } from '../identity/branded-id.js';
import type { EditOperation, EditRange } from '../editing/operations.js';
import type { Project } from './project.js';

/** A punch edit naming a stack: the asset it is made on and where, at the place it was made. */
export interface StackUse {
  readonly asset: AssetId;
  readonly operation: EditOperationId;
  readonly range: EditRange;
}

/** The take stack `operation` punches with, where it is a punch edit. */
export function punchStackOf(operation: EditOperation): TakeStackId | undefined {
  return operation.kind === 'process' && operation.edit.kind === 'punch'
    ? operation.edit.stack
    : undefined;
}

/** Every punch edit of the project that names `stack`, asset by asset in chain order. */
export function stackUsers(project: Project, stack: TakeStackId): readonly StackUse[] {
  const uses: StackUse[] = [];
  for (const asset of project.assets.values()) {
    for (const operation of asset.edits) {
      if (operation.kind !== 'process' || operation.edit.kind !== 'punch') continue;
      if (operation.edit.stack !== stack) continue;
      uses.push({ asset: asset.id, operation: operation.id, range: operation.range });
    }
  }
  return uses;
}
