/**
 * The runs a model pack's file is kept in while it arrives
 * (`model-pack-store.ts`): each run is named by the offset it starts at, in
 * twelve digits, so names sort by offset, and a file is its runs read in
 * order. A run past a gap, or one whose name is not an offset, is stranded:
 * nothing reads it, and the next append removes it.
 */

import type { ByteSource, StorageTree } from '@audiogubbins/project-format';

/** A run's name: the offset it starts at, in twelve digits, so names sort by offset. */
const RUN_NAME = /^[0-9]{12}$/u;
const RUN_DIGITS = 12;

/** One run of a file, and where it starts. */
interface Run {
  readonly offset: number;
  readonly path: string;
  readonly source: ByteSource;
}

/** The runs of a file that follow each other from its start, and those past a gap. */
export interface Runs {
  readonly whole: readonly Run[];
  readonly length: number;
  readonly stranded: readonly string[];
}

/** The name of the run that starts at `offset`. */
export function runName(offset: number): string {
  return String(offset).padStart(RUN_DIGITS, '0');
}

/** The runs kept in `directory`, in order of offset, by their sizes alone. */
export async function runsIn(tree: StorageTree, directory: string): Promise<Runs> {
  const whole: Run[] = [];
  const stranded: string[] = [];
  let length = 0;
  for (const entry of await tree.list(directory)) {
    const path = `${directory}/${entry.name}`;
    const source =
      entry.kind === 'file' && RUN_NAME.test(entry.name) ? await tree.openFile(path) : undefined;
    if (source === undefined || Number(entry.name) !== length || stranded.length > 0) {
      stranded.push(path);
      continue;
    }
    whole.push({ offset: length, path, source });
    length += source.size;
  }
  return { whole, length, stranded };
}

/** The bytes of runs read in order, as one source. */
export function joined(runs: readonly Run[], length: number): ByteSource {
  return {
    size: length,
    read: async (offset, wanted, signal) => {
      const end = Math.min(offset + wanted, length);
      const bytes = new Uint8Array(Math.max(0, end - offset));
      let filled = 0;
      for (const run of runs) {
        const runEnd = run.offset + run.source.size;
        if (runEnd <= offset + filled || run.offset >= end) continue;
        const from = offset + filled - run.offset;
        const take = Math.min(runEnd, end) - (offset + filled);
        const part = await run.source.read(from, take, signal);
        bytes.set(part, filled);
        filled += part.length;
        // A run that came back short changed under the reader, which reads
        // on no further, so the caller sees a short read.
        if (part.length !== take) return bytes.slice(0, filled);
      }
      return bytes;
    },
  };
}
