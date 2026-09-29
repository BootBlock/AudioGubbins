/**
 * The types of the node implementations the engine is built with.
 *
 * Written once, so the executor, the renderer and the tests name a type by
 * this constant rather than repeating a string that could drift from the one
 * the implementation declares.
 */

export const BuiltInNodeType = {
  /** Audio from outside the graph, read from the feed the host binds. */
  GraphInput: 'graph-input',

  /** Where the graph's audio is delivered, to the target the host binds. */
  Output: 'output',
  Gain: 'gain',
  Mix: 'mix',
  ChannelMap: 'channel-map',
  Matrix: 'matrix',
  Delay: 'delay',
  Tone: 'tone',
  Meter: 'meter',
} as const;

/** The type of one built-in node implementation. */
export type BuiltInNodeType = (typeof BuiltInNodeType)[keyof typeof BuiltInNodeType];
