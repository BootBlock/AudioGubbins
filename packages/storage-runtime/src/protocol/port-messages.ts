/**
 * The messages between the page and the storage worker, in either direction,
 * and the reading of one that arrived.
 *
 * Each side calls the other: the page calls the storage operations, and the
 * worker calls back the ports only the page can serve. So one union carries
 * both directions: a call and the cancel that abandons it, the answer it is
 * owed, and an event that answers nothing. Every call carries an id and is
 * answered once, by an answer with that id; a cancel names the call it
 * abandons and is not answered itself.
 *
 * A message crosses a trust boundary, so its envelope is read field by field
 * rather than believed for its type (REQ-EXEC-136.12), and a malformed one is
 * refused with the field that was wrong. A call's argument, an answer's value
 * and an event's value are not read here: both sides compile from one table of
 * operations, which types each payload by its operation, so a payload is never
 * described twice (ADR-0022).
 */

import {
  countAt,
  fieldsAt,
  oneOf,
  readMessage,
  textAt,
  type DomainResult,
  type MessageFields,
} from '@audiogubbins/domain';
import { TreeFailureKind } from '@audiogubbins/project-format';

/**
 * What became of a call.
 *
 * - `value`: it was carried out, and this is its answer.
 * - `tree-refused`: the storage tree refused it, for the reason its kind
 *   classifies, which the caller rebuilds as the same failure.
 * - `cancelled`: the caller abandoned it first.
 * - `fault`: it failed for a reason no refusal of the tree explains.
 */
export type CallOutcome =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'tree-refused'; readonly failure: TreeFailureKind; readonly message: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'fault'; readonly message: string };

/** Anything either side sends the other (see the module comment). */
export type PortMessage =
  | {
      readonly type: 'call';
      readonly id: number;
      readonly operation: string;
      readonly argument: unknown;
    }
  | { readonly type: 'cancel'; readonly target: number }
  | { readonly type: 'answer'; readonly id: number; readonly outcome: CallOutcome }
  | { readonly type: 'event'; readonly stream: string; readonly value: unknown };

const MESSAGE_TYPES = { call: 'call', cancel: 'cancel', answer: 'answer', event: 'event' } as const;

const OUTCOME_KINDS = {
  value: 'value',
  treeRefused: 'tree-refused',
  cancelled: 'cancelled',
  fault: 'fault',
} as const;

/**
 * An answer's outcome. Its own fields are read under their full names,
 * `outcome.kind` and the like, so a refusal says which was wrong.
 */
function outcomeAt(fields: MessageFields): CallOutcome {
  const outcome = fieldsAt(fields, 'outcome');
  const named: MessageFields = {
    'outcome.kind': outcome['kind'],
    'outcome.failure': outcome['failure'],
    'outcome.message': outcome['message'],
  };
  const kind = oneOf(named, 'outcome.kind', OUTCOME_KINDS);
  switch (kind) {
    case 'value':
      return { kind, value: outcome['value'] };
    case 'tree-refused':
      return {
        kind,
        failure: oneOf(named, 'outcome.failure', TreeFailureKind),
        message: textAt(named, 'outcome.message'),
      };
    case 'cancelled':
      return { kind };
    case 'fault':
      return { kind, message: textAt(named, 'outcome.message') };
  }
}

function portMessageFrom(fields: MessageFields): PortMessage {
  const type = oneOf(fields, 'type', MESSAGE_TYPES);
  switch (type) {
    case 'call':
      return {
        type,
        id: countAt(fields, 'id'),
        operation: textAt(fields, 'operation'),
        argument: fields['argument'],
      };
    case 'cancel':
      return { type, target: countAt(fields, 'target') };
    case 'answer':
      return { type, id: countAt(fields, 'id'), outcome: outcomeAt(fields) };
    case 'event':
      return { type, stream: textAt(fields, 'stream'), value: fields['value'] };
  }
}

/**
 * A received message, or why the protocol does not allow it. Anything thrown
 * but a malformed field is a fault in the reading, and propagates.
 */
export function readPortMessage(data: unknown): DomainResult<PortMessage> {
  return readMessage(data, 'protocol.port-message-malformed', portMessageFrom);
}
