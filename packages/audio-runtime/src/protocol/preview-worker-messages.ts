/**
 * The messages between the page and the preview worker, which holds the
 * cached preview producer (ADR-0061).
 *
 * The page connects each worker that reads edited sound, the feeder, the peak
 * worker and the detection worker, to the preview worker by a channel of its
 * own, sending one end here with what that worker reads renders for, and the
 * other to the worker; and lets the connection go when that worker goes. The
 * preview worker tells the page how far each render it keeps has come, which
 * the Transport panel shows. One discriminated union each way, each message
 * read field by field on arrival.
 */

import type { DomainResult } from '@audiogubbins/domain';
import { CachePurpose, RenderPhase, type RenderReport } from '@audiogubbins/audio-engine';

import {
  MalformedMessage,
  countAt,
  itemsAt,
  listAt,
  oneOf,
  optionalTextAt,
  portAt,
  readMessage,
  type Fields,
} from './message-reading.js';

/** The kinds of message the page sends the preview worker. */
export const ToPreviewWorkerKind = {
  Connect: 'connect',
  Disconnect: 'disconnect',
} as const;

/** A message the page sends the preview worker. */
export type ToPreviewWorker =
  | {
      /** Serves the renders a worker reads for `purpose` over `port`, named `connection`. */
      readonly kind: typeof ToPreviewWorkerKind.Connect;
      readonly connection: number;
      readonly purpose: CachePurpose;
      readonly port: MessagePort;
    }
  | {
      /** Lets go of everything connection `connection` held: its worker has gone. */
      readonly kind: typeof ToPreviewWorkerKind.Disconnect;
      readonly connection: number;
    };

/** The kinds of message the preview worker sends the page. */
export const FromPreviewWorkerKind = { Renders: 'renders' } as const;

/** A message the preview worker sends the page. */
export interface FromPreviewWorker {
  /** How far each render kept has come, and how many renders were begun in all. */
  readonly kind: typeof FromPreviewWorkerKind.Renders;
  readonly renders: readonly RenderReport[];
  readonly begun: number;
}

/** A purpose a render is read for, read from the item of a list named `name`. */
function purposeFrom(item: unknown, name: string): CachePurpose {
  const purpose = Object.values(CachePurpose).find((one) => one === item);
  if (purpose === undefined) {
    throw new MalformedMessage(name, `one of ${Object.values(CachePurpose).join(', ')}`);
  }
  return purpose;
}

function reportFrom(fields: Fields): RenderReport {
  return {
    id: countAt(fields, 'id'),
    phase: oneOf(fields, 'phase', RenderPhase),
    reached: countAt(fields, 'reached'),
    length: countAt(fields, 'length'),
    purposes: itemsAt(fields, 'purposes', purposeFrom),
    reason: optionalTextAt(fields, 'reason'),
    failure: optionalTextAt(fields, 'failure'),
  };
}

function toPreviewWorkerFrom(fields: Fields): ToPreviewWorker {
  const kind = oneOf(fields, 'kind', ToPreviewWorkerKind);
  switch (kind) {
    case ToPreviewWorkerKind.Connect:
      return {
        kind,
        connection: countAt(fields, 'connection'),
        purpose: oneOf(fields, 'purpose', CachePurpose),
        port: portAt(fields, 'port'),
      };
    case ToPreviewWorkerKind.Disconnect:
      return { kind, connection: countAt(fields, 'connection') };
  }
}

function fromPreviewWorkerFrom(fields: Fields): FromPreviewWorker {
  return {
    kind: oneOf(fields, 'kind', FromPreviewWorkerKind),
    renders: listAt(fields, 'renders', reportFrom),
    begun: countAt(fields, 'begun'),
  };
}

/** A message the preview worker received, read, or why it cannot be. */
export function readToPreviewWorker(value: unknown): DomainResult<ToPreviewWorker> {
  return readMessage(value, 'protocol.preview-worker-message-malformed', toPreviewWorkerFrom);
}

/** A message the page received from the preview worker, read, or why it cannot be. */
export function readFromPreviewWorker(value: unknown): DomainResult<FromPreviewWorker> {
  return readMessage(value, 'protocol.preview-worker-reply-malformed', fromPreviewWorkerFrom);
}
