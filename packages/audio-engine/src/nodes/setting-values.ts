/**
 * Reading a node's settings: each by a rule that states what it must be.
 *
 * REQ-ARCH-140 asks for a refused graph to say what to change, so a setting is
 * never quietly defaulted over or ignored. A value of the wrong kind names the
 * kind the type needs, and a setting the type does not take is refused rather
 * than skipped, because a misspelt name would otherwise run the node on its
 * default and sound like a defect somewhere else.
 */

import { sampleCount, type SampleCount } from '@audiogubbins/domain';
import type { SettingValue } from '@audiogubbins/audio-graph';

import type { NodeProblem, NodeShape } from './node-shape.js';

/** What one setting must be, and the value read from it when it is. */
export interface SettingRule<TValue> {
  /** What the setting must be, as a message ends "… needs ___ there". */
  readonly describes: string;

  /** The value, or `undefined` when the setting breaks the rule. */
  read(value: SettingValue): TValue | undefined;
}

export const FINITE_NUMBER: SettingRule<number> = {
  describes: 'a finite number',
  read: (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined),
};

/** A whole number of frames, zero or more. */
export const FRAME_COUNT: SettingRule<SampleCount> = {
  describes: 'a whole number of frames, zero or more',
  read: (value) => {
    if (typeof value !== 'number') return undefined;
    const count = sampleCount(value);
    return count.ok ? count.value : undefined;
  },
};

export const FLAG: SettingRule<boolean> = {
  describes: 'true or false',
  read: (value) => (typeof value === 'boolean' ? value : undefined),
};

/** Any text, such as a name the type looks up. */
export const TEXT: SettingRule<string> = {
  describes: 'text',
  read: (value) => (typeof value === 'string' ? value : undefined),
};

/**
 * Whether a setting is a list of numbers. Samples are a whole-pass
 * processor's measurement, which no built-in node takes, so a rule for a
 * list reads only a list.
 */
export function isNumberList(value: SettingValue): value is readonly number[] {
  return Array.isArray(value);
}

/** A list of `length` finite numbers. */
export function finiteNumbers(length: number, of: string): SettingRule<readonly number[]> {
  return {
    describes: `a list of ${String(length)} finite numbers, one for each ${of}`,
    read: (value) =>
      isNumberList(value) && value.length === length && value.every((one) => Number.isFinite(one))
        ? value
        : undefined,
  };
}

/** A setting's value as a message shows it. */
function shown(value: SettingValue): string {
  if (typeof value === 'string') return `"${value}"`;
  // A stream's samples would make a message of megabytes.
  if (value instanceof Float32Array) return `${String(value.length)} samples`;
  if (typeof value === 'object') return `[${value.join(', ')}]`;
  return String(value);
}

/** Notes a problem with a setting whose value breaks its rule. */
function breaks(
  shape: NodeShape,
  name: string,
  value: SettingValue,
  describes: string,
  remedy: string,
  problems: NodeProblem[],
): void {
  problems.push({
    code: 'node-settings-invalid',
    message: `Node ${shape.id} has the "${name}" setting ${shown(value)}, but a ${shape.type} node needs ${describes} there. ${remedy}`,
    node: shape.id,
  });
}

/** A setting's value, or `undefined` if it is absent or breaks its rule, which is noted. */
export function optionalSetting<TValue>(
  shape: NodeShape,
  name: string,
  rule: SettingRule<TValue>,
  problems: NodeProblem[],
): TValue | undefined {
  const value = shape.settings[name];
  if (value === undefined) return undefined;
  const read = rule.read(value);
  if (read === undefined) {
    breaks(
      shape,
      name,
      value,
      rule.describes,
      'Correct it, or remove it for the default.',
      problems,
    );
  }
  return read;
}

/** A setting's value, or `undefined` with the problem noted if it is absent or breaks its rule. */
export function requiredSetting<TValue>(
  shape: NodeShape,
  name: string,
  rule: SettingRule<TValue>,
  problems: NodeProblem[],
): TValue | undefined {
  const value = shape.settings[name];
  if (value === undefined) {
    problems.push({
      code: 'node-settings-invalid',
      message: `Node ${shape.id} is a ${shape.type} node without the "${name}" setting, which it needs. Set it to ${rule.describes}.`,
      node: shape.id,
    });
    return undefined;
  }
  const read = rule.read(value);
  if (read === undefined) breaks(shape, name, value, rule.describes, 'Correct it.', problems);
  return read;
}

/** Notes a problem for each setting a node has that its type does not take. */
export function refuseOtherSettings(
  shape: NodeShape,
  takes: ReadonlySet<string>,
  problems: NodeProblem[],
): void {
  const taken =
    takes.size === 0
      ? 'It takes no settings.'
      : `It takes ${[...takes].map((name) => `"${name}"`).join(', ')}.`;
  for (const name of Object.keys(shape.settings)) {
    if (takes.has(name)) continue;
    problems.push({
      code: 'node-settings-invalid',
      message: `Node ${shape.id} has the setting "${name}", which a ${shape.type} node does not take. Remove it, or correct its name. ${taken}`,
      node: shape.id,
    });
  }
}
