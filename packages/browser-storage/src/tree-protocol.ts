/**
 * The messages between the page and the worker that keeps the origin-private
 * file system, and the checks each side reads the other's with.
 *
 * A message crosses a trust boundary, so each is validated when it arrives
 * rather than believed for its type (REQ-EXEC-136.12). Every request carries an
 * id and is answered exactly once, by a message with that id; a `cancel` names
 * the request it abandons and is not answered itself. Bytes travel as an
 * `ArrayBuffer` the sender gives up, so a chunk is moved, never copied again
 * (G4). A path is a tree path, and a file's path is not the root.
 */

import {
  TreeFailureKind,
  isTreePath,
  isTreeSegment,
  type TreeEntry,
} from '@audiogubbins/project-format';

import { isArrayBuffer } from './array-buffer-views.js';

/** A request the page sends, apart from its id. */
export type TreeCall =
  | { readonly type: 'read-file'; readonly path: string }
  | { readonly type: 'open-file'; readonly path: string }
  | {
      readonly type: 'read-range';
      readonly path: string;
      readonly offset: number;
      readonly length: number;
    }
  | { readonly type: 'write-file'; readonly path: string; readonly bytes: ArrayBuffer }
  | { readonly type: 'create-file'; readonly path: string }
  | { readonly type: 'write-chunk'; readonly sink: number; readonly bytes: ArrayBuffer }
  | { readonly type: 'close-file'; readonly sink: number }
  | { readonly type: 'abort-file'; readonly sink: number }
  | { readonly type: 'remove'; readonly path: string }
  | { readonly type: 'list'; readonly path: string };

/** A request the page sends: a call and the id its answer carries. */
export type TreeRequest = TreeCall & { readonly id: number };

/** Abandons a request that has not been answered. */
export interface TreeCancel {
  readonly type: 'cancel';
  readonly target: number;
}

/** Anything the page sends. */
export type PageMessage = TreeRequest | TreeCancel;

/** A request done, with what it found. */
export type TreeAnswer =
  | { readonly type: 'bytes'; readonly id: number; readonly bytes: ArrayBuffer }
  | { readonly type: 'absent'; readonly id: number }
  | { readonly type: 'size'; readonly id: number; readonly size: number }
  | { readonly type: 'done'; readonly id: number }
  | { readonly type: 'entries'; readonly id: number; readonly entries: readonly TreeEntry[] };

/**
 * A request that did not succeed.
 *
 * - `failed`: the platform refused, for the reason the kind classifies, with
 *   its error's name and message, from which the page rebuilds the cause.
 * - `cancelled`: the page abandoned it first.
 * - `fault`: the worker met something no platform refusal explains, such as a
 *   request whose fields the protocol does not allow, and says what.
 */
export type TreeRefusal =
  | {
      readonly type: 'failed';
      readonly id: number;
      readonly kind: TreeFailureKind;
      readonly name: string;
      readonly message: string;
    }
  | { readonly type: 'cancelled'; readonly id: number }
  | { readonly type: 'fault'; readonly id: number; readonly message: string };

/**
 * A message from the page the worker could not read even an id from, so no
 * request can be answered with why.
 */
export interface UnreadableMessage {
  readonly type: 'unreadable';
  readonly message: string;
}

/** Anything the worker sends. */
export type WorkerMessage = TreeAnswer | TreeRefusal | UnreadableMessage;

/** The buffers a message gives up as it is sent. */
export function transferOf(message: PageMessage | WorkerMessage): Transferable[] {
  return 'bytes' in message ? [message.bytes] : [];
}

/** A field of a message that has not yet been checked. */
function field(message: object, name: string): unknown {
  return Reflect.get(message, name);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function pathIn(message: object): string | undefined {
  const path = field(message, 'path');
  return typeof path === 'string' && isTreePath(path) ? path : undefined;
}

function filePathIn(message: object): string | undefined {
  const path = pathIn(message);
  return path === '' ? undefined : path;
}

function bytesIn(message: object): ArrayBuffer | undefined {
  const bytes = field(message, 'bytes');
  return isArrayBuffer(bytes) ? bytes : undefined;
}

function countIn(message: object, name: string): number | undefined {
  const value = field(message, name);
  return isCount(value) ? value : undefined;
}

/** Reads each call from a message whose type names it, or `undefined`. */
const CALLS: Readonly<Record<TreeCall['type'], (message: object) => TreeCall | undefined>> = {
  'read-file': (m) => {
    const path = filePathIn(m);
    return path === undefined ? undefined : { type: 'read-file', path };
  },
  'open-file': (m) => {
    const path = filePathIn(m);
    return path === undefined ? undefined : { type: 'open-file', path };
  },
  'read-range': (m) => {
    const path = filePathIn(m);
    const offset = countIn(m, 'offset');
    const length = countIn(m, 'length');
    return path === undefined || offset === undefined || length === undefined
      ? undefined
      : { type: 'read-range', path, offset, length };
  },
  'write-file': (m) => {
    const path = filePathIn(m);
    const bytes = bytesIn(m);
    return path === undefined || bytes === undefined
      ? undefined
      : { type: 'write-file', path, bytes };
  },
  'create-file': (m) => {
    const path = filePathIn(m);
    return path === undefined ? undefined : { type: 'create-file', path };
  },
  'write-chunk': (m) => {
    const sink = countIn(m, 'sink');
    const bytes = bytesIn(m);
    return sink === undefined || bytes === undefined
      ? undefined
      : { type: 'write-chunk', sink, bytes };
  },
  'close-file': (m) => {
    const sink = countIn(m, 'sink');
    return sink === undefined ? undefined : { type: 'close-file', sink };
  },
  'abort-file': (m) => {
    const sink = countIn(m, 'sink');
    return sink === undefined ? undefined : { type: 'abort-file', sink };
  },
  remove: (m) => {
    const path = pathIn(m);
    return path === undefined ? undefined : { type: 'remove', path };
  },
  list: (m) => {
    const path = pathIn(m);
    return path === undefined ? undefined : { type: 'list', path };
  },
};

function isCallType(type: unknown): type is TreeCall['type'] {
  return typeof type === 'string' && Object.hasOwn(CALLS, type);
}

/**
 * What the page sent, checked, or the answer that says why it cannot be read: a
 * fault of its request where it has an id, and `unreadable` where not.
 */
export type PageMessageReading =
  | { readonly ok: true; readonly message: PageMessage }
  | { readonly ok: false; readonly answer: UnreadableMessage | TreeRefusal };

function unreadable(message: string): PageMessageReading {
  return { ok: false, answer: { type: 'unreadable', message } };
}

function faulty(id: number, message: string): PageMessageReading {
  return { ok: false, answer: { type: 'fault', id, message } };
}

/** Reads a message the page sent, refusing anything the protocol does not allow. */
export function readPageMessage(data: unknown): PageMessageReading {
  if (typeof data !== 'object' || data === null) return unreadable('A request is an object.');
  const type = field(data, 'type');
  if (type === 'cancel') {
    const target = countIn(data, 'target');
    return target === undefined
      ? unreadable('A cancel names the request it abandons.')
      : { ok: true, message: { type: 'cancel', target } };
  }
  const id = countIn(data, 'id');
  if (id === undefined) return unreadable('A request carries a whole, non-negative id.');
  if (!isCallType(type)) return faulty(id, 'A request names an operation.');
  const call = CALLS[type](data);
  return call === undefined
    ? faulty(id, `A ${type} request has a field the protocol does not allow.`)
    : { ok: true, message: { ...call, id } };
}

function entriesIn(message: object): readonly TreeEntry[] | undefined {
  const entries = field(message, 'entries');
  if (!Array.isArray(entries)) return undefined;
  const listed: readonly unknown[] = entries;
  const checked: TreeEntry[] = [];
  for (const entry of listed) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const name = field(entry, 'name');
    const kind = field(entry, 'kind');
    if (typeof name !== 'string' || !isTreeSegment(name)) return undefined;
    if (kind !== 'file' && kind !== 'directory') return undefined;
    checked.push({ name, kind });
  }
  return checked;
}

const FAILURE_KINDS: ReadonlySet<unknown> = new Set(Object.values(TreeFailureKind));

function isFailureKind(kind: unknown): kind is TreeFailureKind {
  return FAILURE_KINDS.has(kind);
}

/** Reads each answer from a message whose type names it, given its id. */
const ANSWERS: Readonly<
  Record<
    (TreeAnswer | TreeRefusal)['type'],
    (message: object, id: number) => TreeAnswer | TreeRefusal | undefined
  >
> = {
  bytes: (m, id) => {
    const bytes = bytesIn(m);
    return bytes === undefined ? undefined : { type: 'bytes', id, bytes };
  },
  absent: (_m, id) => ({ type: 'absent', id }),
  size: (m, id) => {
    const size = countIn(m, 'size');
    return size === undefined ? undefined : { type: 'size', id, size };
  },
  done: (_m, id) => ({ type: 'done', id }),
  entries: (m, id) => {
    const entries = entriesIn(m);
    return entries === undefined ? undefined : { type: 'entries', id, entries };
  },
  failed: (m, id) => {
    const kind = field(m, 'kind');
    const name = field(m, 'name');
    const message = field(m, 'message');
    return isFailureKind(kind) && typeof name === 'string' && typeof message === 'string'
      ? { type: 'failed', id, kind, name, message }
      : undefined;
  },
  cancelled: (_m, id) => ({ type: 'cancelled', id }),
  fault: (m, id) => {
    const message = field(m, 'message');
    return typeof message === 'string' ? { type: 'fault', id, message } : undefined;
  },
};

function isAnswerType(type: unknown): type is (TreeAnswer | TreeRefusal)['type'] {
  return typeof type === 'string' && Object.hasOwn(ANSWERS, type);
}

/** Reads a message the worker sent, or `undefined` where the protocol does not allow it. */
export function readWorkerMessage(data: unknown): WorkerMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const type = field(data, 'type');
  if (type === 'unreadable') {
    const message = field(data, 'message');
    return typeof message === 'string' ? { type, message } : undefined;
  }
  if (!isAnswerType(type)) return undefined;
  const id = field(data, 'id');
  return isCount(id) ? ANSWERS[type](data, id) : undefined;
}
