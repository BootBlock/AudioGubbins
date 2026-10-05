/**
 * A call into the DSP module, as `readDspExports` reads every export: no
 * export takes more than five arguments, and each is given all of its own.
 */
export type Call = (
  first?: number,
  second?: number,
  third?: number,
  fourth?: number,
  fifth?: number,
) => number;
