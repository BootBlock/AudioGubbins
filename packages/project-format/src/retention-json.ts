/**
 * Writing and reading a project's history retention policy as JSON
 * (REQ-STOR-055, REQ-EXEC-136.12).
 */

import type { JsonObject } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  listOf,
  pathOf,
  required,
  type Converter,
} from './document-reading.js';
import type { RetentionPolicy, RetentionRule } from './history-record.js';
import { integerConverter, oneOfConverter } from './scalar-reading.js';
import { asWholeQuantity } from './value-reading.js';

/** The most rules one policy holds: one of each kind, with room to spare. */
const MAXIMUM_RULES = 16;

const POLICY_KINDS = ['unlimited', 'budget', 'rules'] as const;
const RULE_KINDS = ['recent-changes', 'recent-days'] as const;

const UNLIMITED_MEMBERS: ReadonlySet<string> = new Set(['kind']);
const BUDGET_MEMBERS: ReadonlySet<string> = new Set(['kind', 'bytes']);
const RULES_MEMBERS: ReadonlySet<string> = new Set(['kind', 'rules']);
const CHANGES_MEMBERS: ReadonlySet<string> = new Set(['kind', 'count']);
const DAYS_MEMBERS: ReadonlySet<string> = new Set(['kind', 'days']);

const asPolicyKind = oneOfConverter(POLICY_KINDS);
const asRuleKind = oneOfConverter(RULE_KINDS);

/**
 * At least one of something a rule keeps: a rule that kept none would let
 * automatic compaction remove every change the project could undo.
 */
const asPositiveCount = integerConverter(1, Number.MAX_SAFE_INTEGER);

/** Writes a retention policy. */
export function writeRetentionPolicy(policy: RetentionPolicy): JsonObject {
  switch (policy.kind) {
    case 'unlimited':
      return { kind: policy.kind };
    case 'budget':
      return { kind: policy.kind, bytes: policy.bytes };
    case 'rules':
      return { kind: policy.kind, rules: policy.rules.map(writeRule) };
  }
}

function writeRule(rule: RetentionRule): JsonObject {
  return rule.kind === 'recent-changes'
    ? { kind: rule.kind, count: rule.count }
    : { kind: rule.kind, days: rule.days };
}

/** Reads a retention policy. */
export const readRetentionPolicy: Converter<RetentionPolicy> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asPolicyKind);
  switch (kind) {
    case undefined:
      return undefined;
    case 'unlimited':
      checkMembers(reading, object, at, UNLIMITED_MEMBERS);
      return { kind };
    case 'budget': {
      checkMembers(reading, object, at, BUDGET_MEMBERS);
      const bytes = required(reading, object, at, 'bytes', asWholeQuantity);
      return bytes === undefined ? undefined : { kind, bytes };
    }
    case 'rules': {
      checkMembers(reading, object, at, RULES_MEMBERS);
      const rules = required(reading, object, at, 'rules', asRules);
      return rules === undefined ? undefined : { kind, rules };
    }
  }
};

const asRules: Converter<readonly [RetentionRule, ...RetentionRule[]]> = (
  reading,
  value,
  parent,
  key,
) => {
  const list = listOf(reading, value, parent, key, MAXIMUM_RULES);
  if (list === undefined) return undefined;
  const at = pathOf(parent, key);
  const rules: RetentionRule[] = [];
  let whole = true;
  for (const [index, item] of list.entries()) {
    const rule = asRule(reading, item, at, index);
    if (rule === undefined) whole = false;
    else rules.push(rule);
  }
  const [first, ...rest] = rules;
  if (whole && first === undefined) {
    reading.refuse('retention.no-rule', 'A policy of rules holds at least one rule.', at);
  }
  return whole && first !== undefined ? [first, ...rest] : undefined;
};

const asRule: Converter<RetentionRule> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asRuleKind);
  if (kind === undefined) return undefined;
  if (kind === 'recent-changes') {
    checkMembers(reading, object, at, CHANGES_MEMBERS);
    const count = required(reading, object, at, 'count', asPositiveCount);
    return count === undefined ? undefined : { kind, count };
  }
  checkMembers(reading, object, at, DAYS_MEMBERS);
  const days = required(reading, object, at, 'days', asPositiveCount);
  return days === undefined ? undefined : { kind, days };
};
