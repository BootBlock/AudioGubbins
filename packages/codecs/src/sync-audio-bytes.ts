/**
 * The synchronous byte port the codec worker decodes through (ADR-0090).
 *
 * A decoder compiled to WebAssembly reads its file from inside a synchronous
 * call, which cannot wait on a promise. A dedicated worker can read a file
 * synchronously (`FileReaderSync` over a file's slice, or an origin-private
 * file's sync access handle), so the codec worker hands its decoder this port.
 * Nothing on the page or an audio thread uses it.
 */

/**
 * The bytes of one file, read synchronously.
 *
 * `size` is the true size of the file. `readInto` copies the bytes at `offset`
 * into `into` and answers how many it copied: fewer than `into.length` only at
 * the end of the file. A reader treats a shorter answer before the end as the
 * file having changed under it.
 */
export interface SyncAudioBytes {
  readonly size: number;
  readInto(offset: number, into: Uint8Array): number;
}
