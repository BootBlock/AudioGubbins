/**
 * The shape of a table of operations and of a table of streams, which both
 * sides of the port compile from, and of the handlers that serve operations.
 *
 * An operation is named by an `area.verb` string and pairs the argument a call
 * sends with the answer it is owed, so the side that calls and the side that
 * serves are held to one description of each payload, and a payload is read by
 * neither (ADR-0022). A stream is named likewise and types the value each of
 * its events carries. Each side has tables of its own: the operations it
 * serves and the streams it sends, the page's for the worker and the worker's
 * for the page.
 */

/** An operation's argument and its answer, as types alone. */
export interface Operation<TArgument, TAnswer> {
  readonly argument: TArgument;
  readonly answer: TAnswer;
}

/**
 * The operations one side calls on the other, by name. Written as a type
 * alias, since an interface has no index signature to meet this with.
 */
export type OperationTable = Readonly<Record<string, Operation<unknown, unknown>>>;

/** The value each event of a stream carries, as a type alone. */
export interface Stream<TValue> {
  readonly value: TValue;
}

/**
 * The streams one side sends the other, by name. A stream of one thing, such
 * as one project's, is named by its kind and that thing's key, `kind:key`, and
 * the table names every stream of the kind at once with a template pattern, so
 * an event is typed by its kind whatever its key.
 */
export type StreamTable = Readonly<Record<string, Stream<unknown>>>;

/** What one side of the port offers the other: the operations it serves, the streams it sends. */
export interface PortSide {
  readonly operations: OperationTable;
  readonly streams: StreamTable;
}

/**
 * An answer, with the buffers it gives up as it is sent: a buffer transferred
 * is moved to the caller and emptied here, rather than copied (G4).
 */
export class Transferring<TValue> {
  readonly value: TValue;
  readonly transfer: readonly Transferable[];

  constructor(value: TValue, transfer: readonly Transferable[]) {
    this.value = value;
    this.transfer = transfer;
  }
}

/** What a handler answers: its value, or its value with buffers to transfer. */
export type Answered<TValue> = TValue | Transferring<TValue>;

/** What a handler is given beside its argument. */
export interface ServeContext {
  /** Aborted when the caller abandons the call, with why. */
  readonly signal: AbortSignal;
}

/**
 * A handler for each operation of a table. A handler that rejects with its
 * signal's reason is answered as cancelled, and one that rejects with a
 * refusal of the storage tree is answered as that refusal.
 */
export type Handlers<TTable extends OperationTable> = {
  readonly [TName in keyof TTable]: (
    argument: TTable[TName]['argument'],
    context: ServeContext,
  ) => Promise<Answered<TTable[TName]['answer']>>;
};
