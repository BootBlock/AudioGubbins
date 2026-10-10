/**
 * What every encoder of a stream's frames is: the blocks it writes, and the
 * frames it holds until a block is whole (`frame-encoding.ts`).
 */

/** An encoder of one stream's frames into its file's blocks. */
export interface FrameEncoder {
  readonly blockBytes: number;
  readonly framesPerBlock: number;

  /** The bytes of every block the frames complete, in order; a block code may hold some back. */
  encode(channels: readonly Float32Array[], frames: number): Uint8Array;

  /** The bytes of the last block, its missing frames silence, or none where no frame waits. */
  finish(): Uint8Array;
}
