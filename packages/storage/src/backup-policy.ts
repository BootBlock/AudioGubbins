/**
 * A project's backup policy: whether automatic backup generations are made,
 * what makes one, and which are kept (REQ-STOR-105).
 *
 * Backup generations are distinct from the journal, the history and the
 * snapshots: a generation is a copy of a checkpoint and the states it keeps,
 * made so a project can be restored even when its working files are lost. The
 * policy is part of the project, recorded in its checkpoint and changed through
 * its journal, so it survives a reload and travels with the project. A
 * generation the person protects is never pruned by any retention limit.
 */

import {
  anyObjectOf,
  checkMembers,
  integerConverter,
  objectOf,
  oneOfConverter,
  optional,
  pathOf,
  presentMembers,
  required,
  type Converter,
  type JsonObject,
} from '@audiogubbins/project-format';

/** What makes an automatic generation: whichever comes first of those set. */
export interface BackupTrigger {
  /** A generation once this many minutes have passed with changes since the last. */
  readonly everyMinutes?: number;

  /** A generation once this many changes have been made since the last. */
  readonly everyChanges?: number;
}

/**
 * Which unprotected generations are kept: those within every limit set. With
 * none set, every generation is kept.
 */
export interface BackupRetention {
  /** The newest this many. */
  readonly count?: number;

  /** Those made in the last this many days. */
  readonly days?: number;

  /** As many of the newest as fit in this many bytes. */
  readonly bytes?: number;
}

/** A project's backup policy. */
export type BackupPolicy =
  | { readonly kind: 'off' }
  | {
      readonly kind: 'automatic';
      readonly trigger: BackupTrigger;
      readonly retention: BackupRetention;
    };

/**
 * The policy a project starts with: a generation after half an hour of work and
 * the newest ten kept, which favours recovery at a bounded cost.
 */
export const DEFAULT_BACKUP_POLICY: BackupPolicy = {
  kind: 'automatic',
  trigger: { everyMinutes: 30 },
  retention: { count: 10 },
};

const POLICY_KINDS = ['off', 'automatic'] as const;
const OFF_MEMBERS: ReadonlySet<string> = new Set(['kind']);
const AUTOMATIC_MEMBERS: ReadonlySet<string> = new Set(['kind', 'trigger', 'retention']);
const TRIGGER_MEMBERS: ReadonlySet<string> = new Set(['everyMinutes', 'everyChanges']);
const RETENTION_MEMBERS: ReadonlySet<string> = new Set(['count', 'days', 'bytes']);

const asPolicyKind = oneOfConverter(POLICY_KINDS);
const asLimit = integerConverter(1, Number.MAX_SAFE_INTEGER);

/** Writes a backup policy. */
export function writeBackupPolicy(policy: BackupPolicy): JsonObject {
  if (policy.kind === 'off') return { kind: policy.kind };
  return {
    kind: policy.kind,
    trigger: presentMembers({
      everyMinutes: policy.trigger.everyMinutes,
      everyChanges: policy.trigger.everyChanges,
    }),
    retention: presentMembers({
      count: policy.retention.count,
      days: policy.retention.days,
      bytes: policy.retention.bytes,
    }),
  };
}

/** Reads a backup policy. */
export const readBackupPolicy: Converter<BackupPolicy> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asPolicyKind);
  if (kind === undefined) return undefined;
  if (kind === 'off') {
    checkMembers(reading, object, at, OFF_MEMBERS);
    return { kind };
  }
  checkMembers(reading, object, at, AUTOMATIC_MEMBERS);
  const trigger = required(reading, object, at, 'trigger', asTrigger);
  const retention = required(reading, object, at, 'retention', asRetention);
  return trigger === undefined || retention === undefined
    ? undefined
    : { kind, trigger, retention };
};

const asTrigger: Converter<BackupTrigger> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, TRIGGER_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const everyMinutes = optional(reading, object, at, 'everyMinutes', asLimit);
  const everyChanges = optional(reading, object, at, 'everyChanges', asLimit);
  if (everyMinutes === undefined && everyChanges === undefined) {
    // A trigger of neither would make an automatic policy that never backs up.
    reading.refuse(
      'backup.no-trigger',
      'An automatic backup policy says what makes a generation.',
      at,
    );
    return undefined;
  }
  return {
    ...(everyMinutes === undefined ? {} : { everyMinutes }),
    ...(everyChanges === undefined ? {} : { everyChanges }),
  };
};

const asRetention: Converter<BackupRetention> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RETENTION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const count = optional(reading, object, at, 'count', asLimit);
  const days = optional(reading, object, at, 'days', asLimit);
  const bytes = optional(reading, object, at, 'bytes', asLimit);
  return {
    ...(count === undefined ? {} : { count }),
    ...(days === undefined ? {} : { days }),
    ...(bytes === undefined ? {} : { bytes }),
  };
};
