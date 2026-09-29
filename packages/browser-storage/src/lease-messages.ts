/**
 * What the windows of one browser profile say to each other about a project's
 * write lease, and reading what another window sent (REQ-STOR-098).
 *
 * A window may run another version of the application, or be anything else of
 * the origin that posts to the channel, so a message is read by checking each
 * member, and one that does not match is ignored rather than trusted. The
 * protocol name changes whenever a message changes meaning, so two versions
 * never misread each other: they only fail to identify one another, which the
 * coordinator already treats as a window it cannot describe.
 */

import type { LeaseOwner, TransferAnswer, TransferRequest } from '@audiogubbins/storage';

/** Names this form of the messages. */
const PROTOCOL = 'audiogubbins.lease/1';

/** The longest label or identifier read from another window. */
const LONGEST_TEXT = 200;

/** A message between the windows of one profile, about one project. */
export type LeaseMessage =
  /** Asks whoever writes the project to say who it is. */
  | { readonly kind: 'who-owns'; readonly question: string }
  | { readonly kind: 'owner'; readonly question: string; readonly owner: LeaseOwner }
  /** Sent just before taking the project, so its writer can say who took it. */
  | { readonly kind: 'taking'; readonly by: LeaseOwner }
  | { readonly kind: 'transfer-request'; readonly request: TransferRequest }
  | { readonly kind: 'transfer-answer'; readonly request: string; readonly answer: TransferAnswer };

/** A message as it is posted. */
export function postedForm(message: LeaseMessage): object {
  return { protocol: PROTOCOL, ...message };
}

function member(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= LONGEST_TEXT
    ? value
    : undefined;
}

function ownerOf(value: unknown): LeaseOwner | undefined {
  const instance = textOf(member(value, 'instance'));
  const label = textOf(member(value, 'label'));
  return instance === undefined || label === undefined ? undefined : { instance, label };
}

function answerOf(value: unknown): TransferAnswer | undefined {
  return value === 'granted' || value === 'declined' ? value : undefined;
}

function requestOf(value: unknown): TransferRequest | undefined {
  const id = textOf(member(value, 'id'));
  const from = ownerOf(member(value, 'from'));
  return id === undefined || from === undefined ? undefined : { id, from };
}

/** Reads a message another window posted, or `undefined` where it is not one. */
export function readLeaseMessage(data: unknown): LeaseMessage | undefined {
  if (member(data, 'protocol') !== PROTOCOL) return undefined;
  const question = textOf(member(data, 'question'));
  switch (member(data, 'kind')) {
    case 'who-owns':
      return question === undefined ? undefined : { kind: 'who-owns', question };
    case 'owner': {
      const owner = ownerOf(member(data, 'owner'));
      return question === undefined || owner === undefined
        ? undefined
        : { kind: 'owner', question, owner };
    }
    case 'taking': {
      const by = ownerOf(member(data, 'by'));
      return by === undefined ? undefined : { kind: 'taking', by };
    }
    case 'transfer-request': {
      const request = requestOf(member(data, 'request'));
      return request === undefined ? undefined : { kind: 'transfer-request', request };
    }
    case 'transfer-answer': {
      const request = textOf(member(data, 'request'));
      const answer = answerOf(member(data, 'answer'));
      return request === undefined || answer === undefined
        ? undefined
        : { kind: 'transfer-answer', request, answer };
    }
    default:
      return undefined;
  }
}
