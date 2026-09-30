/**
 * The accelerators a node type may declare a path for, beside its canonical
 * kernel (`accelerated-paths.ts` chooses between them).
 */

/** An accelerator a node type may declare a path for. */
export const Accelerator = {
  Gpu: 'gpu',
} as const;

export type Accelerator = (typeof Accelerator)[keyof typeof Accelerator];
