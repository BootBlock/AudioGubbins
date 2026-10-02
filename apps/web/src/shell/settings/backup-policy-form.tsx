/**
 * The form a project's backup policy is set with: whether backups are made on
 * their own, after how much work, how many are kept, and whether each is also
 * copied to the backups folder where the browser gives one (REQ-STOR-105,
 * REQ-STOR-106). The numbers are sent as typed, the size in megabytes as the
 * bytes it is, and checked by the command that sets the policy.
 */

import { useState, type ReactNode } from 'react';

import { Button, OptionSelect, TextField, ToggleSwitch } from '@audiogubbins/design-system';
import type { BackupPolicy } from '@audiogubbins/project-format';

import type { RunCommand } from './section.js';

/** The policy's numbers as the form holds them, a blank for one not set. */
interface PolicyForm {
  readonly kind: string;
  readonly everyMinutes: string;
  readonly everyChanges: string;
  readonly keepCount: string;
  readonly keepDays: string;
  readonly keepMegabytes: string;
  readonly external: boolean;
}

/** The bytes in a megabyte, as the size a policy keeps is typed in. */
const MEGABYTE = 2 ** 20;

/** The form a policy starts it from. */
function formOf(policy: BackupPolicy): PolicyForm {
  if (policy.kind === 'off') {
    return {
      kind: 'off',
      everyMinutes: '',
      everyChanges: '',
      keepCount: '',
      keepDays: '',
      keepMegabytes: '',
      external: false,
    };
  }
  const text = (value: number | undefined): string => (value === undefined ? '' : String(value));
  return {
    kind: 'automatic',
    everyMinutes: text(policy.trigger.everyMinutes),
    everyChanges: text(policy.trigger.everyChanges),
    keepCount: text(policy.retention.count),
    keepDays: text(policy.retention.days),
    keepMegabytes: text(
      policy.retention.bytes === undefined ? undefined : policy.retention.bytes / MEGABYTE,
    ),
    external: policy.external === true,
  };
}

/** The fields of the form, and what each is called. */
const FIELDS = [
  ['everyMinutes', 'After this many minutes of work'],
  ['everyChanges', 'After this many changes'],
  ['keepCount', 'Keep the newest'],
  ['keepDays', 'Keep those from the last days'],
  ['keepMegabytes', 'Keep as many as fit in this many MB'],
] as const;

/** The policy's numbers as the command takes them, from the form. */
function numbersOf(form: PolicyForm): Readonly<Record<string, number>> {
  return {
    everyMinutes: Number(form.everyMinutes),
    everyChanges: Number(form.everyChanges),
    keepCount: Number(form.keepCount),
    keepDays: Number(form.keepDays),
    keepBytes: Math.round(Number(form.keepMegabytes) * MEGABYTE),
  };
}

/** When automatic backups are made, how many are kept, and whether each is copied out. */
function AutomaticFields({
  form,
  canCopyOut,
  onChange,
}: {
  readonly form: PolicyForm;
  readonly canCopyOut: boolean;
  readonly onChange: (form: PolicyForm) => void;
}): ReactNode {
  return (
    <>
      <div className="ag-settings-row">
        {FIELDS.map(([field, label]) => (
          <TextField
            key={field}
            label={label}
            value={form[field]}
            onValueChange={(typed) => {
              onChange({ ...form, [field]: typed });
            }}
          />
        ))}
      </div>
      {canCopyOut && (
        <ToggleSwitch
          label="Also copy each backup to the backups folder"
          description="Written as a bundle, which brings the project back wherever it is imported. Nothing in the folder is ever removed."
          checked={form.external}
          onCheckedChange={(external) => {
            onChange({ ...form, external });
          }}
        />
      )}
    </>
  );
}

/** When backups are made, and how many are kept. */
export function PolicyFormView({
  policy,
  canCopyOut,
  run,
}: {
  readonly policy: BackupPolicy;

  /** Whether this browser can give a folder to copy backups to. */
  readonly canCopyOut: boolean;
  readonly run: RunCommand;
}): ReactNode {
  const [form, setForm] = useState(formOf(policy));
  return (
    <div className="ag-settings-section">
      <OptionSelect
        label="Back the project up"
        value={form.kind}
        options={[
          { value: 'automatic', label: 'On its own, as set below' },
          { value: 'off', label: 'Only when I ask' },
        ]}
        onValueChange={(kind) => {
          setForm({ ...form, kind });
        }}
      />
      {form.kind === 'automatic' && (
        <AutomaticFields form={form} canCopyOut={canCopyOut} onChange={setForm} />
      )}
      <Button
        onClick={() =>
          run('backup.set-policy', {
            kind: form.kind,
            ...numbersOf(form),
            external: form.external,
          })
        }
      >
        Save the backup settings
      </Button>
    </div>
  );
}
