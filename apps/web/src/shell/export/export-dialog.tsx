/**
 * The Export dialog (ADR-0092, REQ-UX-005): what is exported, the presets,
 * each saying what it sets, the format with what this browser cannot write
 * and what it can instead, every setting disclosed on request, where the
 * files go, and before anything starts, what the export will do or every
 * reason it cannot.
 *
 * The dialog shows the settings its store holds and changes them through it;
 * every action that does something, starting, closing and keeping a preset,
 * runs a command, so the palette and a shortcut reach the same action.
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, ButtonTone, ModalDialog, TextField } from '@audiogubbins/design-system';
import {
  BUILT_IN_PRESETS,
  defaultExportSettings,
  exportTarget,
  formatName,
  type CollisionPolicy,
  type ExportFormat,
} from '@audiogubbins/import-export';

import { ExportCommand } from '../../commands/import-export-ids.js';
import { exportBlockers, unavailableSentence } from '../../export/export-blockers.js';
import { presetSettingsOver, type OfferedPreset } from '../../export/export-draft.js';
import type { ExportServices } from '../../export/export-types.js';
import { EXPORT_DIALOG_WORDS } from '../../import-export-words.js';
import type {
  ExportDestinationDraft,
  ExportDialogStore,
  OpenExportDialog,
} from '../../state/export-dialog-store.js';
import type { OwnExportPreset } from '../../state/stored-export-presets.js';
import { NotedButton } from '../settings/reasoned-button.js';
import type { RunCommand } from '../settings/section.js';
import { CommonControls, RangeControl } from './common-controls.js';
import { EncodingControls } from './encoding-controls.js';
import {
  FORMAT_ORDER,
  POLICY_WORDS,
  ownPresetSentence,
  presetSentence,
  whatWillHappen,
} from './export-words.js';
import { ChoiceField, type Choice } from './setting-fields.js';

/** What the dialog reads and runs. */
export interface ExportDialogProps {
  readonly dialog: ExportDialogStore;
  readonly exports: ExportServices;

  /** The person's own presets, as their preferences keep them. */
  readonly presets: readonly OwnExportPreset[];
  readonly run: RunCommand;

  /** Why a command cannot run now, or `undefined` where it can. */
  readonly unavailableReason: (id: string) => string | undefined;
}

/** One preset the dialog lists, by the key its radio is told apart by. */
interface ListedPreset {
  readonly key: string;
  readonly name: string;
  readonly sentence: string;
  readonly choose: () => void;
}

/** The presets listed: AudioGubbins's, the person's, and their edited settings where they edited any. */
function listedPresets(
  open: OpenExportDialog,
  own: readonly OwnExportPreset[],
  dialog: ExportDialogStore,
): readonly ListedPreset[] {
  const offered: readonly OfferedPreset[] = [
    ...BUILT_IN_PRESETS.map((preset) => ({ kind: 'built-in', preset }) as const),
    ...own.map((preset) => ({ kind: 'own', preset }) as const),
  ];
  return [
    ...offered.map((one) => ({
      key: one.preset.id,
      name: one.preset.name,
      sentence:
        one.kind === 'own'
          ? ownPresetSentence(one.preset.settings)
          : presetSentence(one.preset, presetSettingsOver(one, open.context, open.settings.range)),
      choose: () => {
        dialog.choosePreset(one);
      },
    })),
    ...(open.edited === undefined
      ? []
      : [
          {
            key: 'edited',
            name: 'Your edited settings',
            sentence: 'The settings as you last set them in this dialog.',
            choose: dialog.chooseEdited,
          },
        ]),
  ];
}

/** The key of the listed preset the settings came from, where they came from one. */
function chosenKey(open: OpenExportDialog): string | undefined {
  switch (open.source.kind) {
    case 'preset':
      return open.source.id;
    case 'edited':
      return 'edited';
    default:
      return undefined;
  }
}

/** The presets, as radios, each saying what it sets. */
function Presets({
  open,
  own,
  dialog,
}: {
  readonly open: OpenExportDialog;
  readonly own: readonly OwnExportPreset[];
  readonly dialog: ExportDialogStore;
}): ReactNode {
  const name = useId();
  const chosen = chosenKey(open);
  const from =
    open.source.kind === 'kept'
      ? 'The settings start as this project was last exported with.'
      : open.source.kind === 'default'
        ? 'The settings start at the highest quality for this asset.'
        : undefined;
  return (
    <fieldset className="ag-settings-group">
      <legend>Preset</legend>
      {from !== undefined && <p className="ag-panel-note">{from}</p>}
      {listedPresets(open, own, dialog).map((preset) => {
        const said = `${name}-${preset.key}`;
        const named = `${said}-name`;
        return (
          <label key={preset.key} className="ag-export-preset">
            <input
              type="radio"
              name={name}
              checked={preset.key === chosen}
              aria-labelledby={named}
              aria-describedby={said}
              onChange={preset.choose}
            />
            <span className="ag-export-preset-name" id={named}>
              {preset.name}
            </span>
            <span className="ag-panel-note" id={said}>
              {preset.sentence}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Each format, saying where this browser cannot write it. */
function formatChoices(
  open: OpenExportDialog,
  exports: ExportServices,
): readonly Choice<ExportFormat>[] {
  return FORMAT_ORDER.map((format) => {
    const codec = exportTarget(defaultExportSettings(format, open.context)).codec;
    const capability = exports.codecs.capability(codec, 'write');
    return {
      value: format,
      label:
        capability.kind === 'available'
          ? formatName(format)
          : `${formatName(format)}, which this browser cannot write`,
    };
  });
}

/** The format, and why this browser cannot write it where it cannot. */
function FormatControl({
  open,
  exports,
  dialog,
}: {
  readonly open: OpenExportDialog;
  readonly exports: ExportServices;
  readonly dialog: ExportDialogStore;
}): ReactNode {
  const capability = exports.codecs.capability(exportTarget(open.settings).codec, 'write');
  return (
    <>
      <ChoiceField
        label="Format"
        value={open.settings.format}
        choices={formatChoices(open, exports)}
        onChoose={dialog.chooseFormat}
      />
      {capability.kind === 'unavailable' && (
        <p className="ag-panel-note" data-ag-status="unavailable">
          {unavailableSentence(capability, open.context.codecs)}
        </p>
      )}
    </>
  );
}

const POLICIES: readonly Choice<CollisionPolicy>[] = (
  ['prompt', 'rename', 'skip', 'overwrite'] as const
).map((value) => ({
  value,
  label: `${POLICY_WORDS[value].charAt(0).toUpperCase()}${POLICY_WORDS[value].slice(1)}`,
}));

/** A destination, as the dialog lists it. */
interface DestinationChoice {
  readonly key: string;
  readonly label: string;
  readonly draft: (policy: CollisionPolicy) => ExportDestinationDraft;
}

/** The destinations this browser offers: a file and a folder where it gives dialogs, each trusted folder, a download. */
function destinationChoices(
  dialogs: boolean,
  trusted: readonly { readonly key: string; readonly name: string }[],
): readonly DestinationChoice[] {
  return [
    ...(dialogs
      ? [
          { key: 'file', label: 'A file you name', draft: () => ({ kind: 'file' }) as const },
          {
            key: 'folder',
            label: 'A folder you choose',
            draft: (policy: CollisionPolicy) => ({ kind: 'folder', policy }) as const,
          },
        ]
      : []),
    ...trusted.map((folder) => ({
      key: `trusted:${folder.key}`,
      label: `“${folder.name}”, kept trusted`,
      draft: (policy: CollisionPolicy) =>
        ({ kind: 'trusted-folder', key: folder.key, policy }) as const,
    })),
    { key: 'download', label: 'A download', draft: () => ({ kind: 'download' }) as const },
  ];
}

/** The key a destination is listed by. */
function destinationKey(destination: ExportDestinationDraft): string {
  return destination.kind === 'trusted-folder' ? `trusted:${destination.key}` : destination.kind;
}

/** Where the files go, and what is done with a name taken there. */
function DestinationControls({
  open,
  exports,
  dialog,
}: {
  readonly open: OpenExportDialog;
  readonly exports: ExportServices;
  readonly dialog: ExportDialogStore;
}): ReactNode {
  const trusted = useSyncExternalStore(
    exports.destinations.trusted.subscribe,
    exports.destinations.trusted.get,
  );
  const choices = destinationChoices(open.dialogs, trusted);
  const { destination } = open;
  const policy =
    destination.kind === 'folder' || destination.kind === 'trusted-folder'
      ? destination.policy
      : 'prompt';
  const key = destinationKey(destination);
  return (
    <fieldset className="ag-settings-group">
      <legend>Destination</legend>
      <ChoiceField
        label="Deliver to"
        value={choices.find((choice) => choice.key === key) ?? choices[0]}
        choices={choices.map((choice) => ({ value: choice, label: choice.label }))}
        onChoose={(choice) => {
          if (choice !== undefined) dialog.chooseDestination(choice.draft(policy));
        }}
      />
      {(destination.kind === 'folder' || destination.kind === 'trusted-folder') && (
        <ChoiceField
          label="Where a name is taken"
          value={policy}
          choices={POLICIES}
          onChoose={(chosen) => {
            dialog.chooseDestination({ ...destination, policy: chosen });
          }}
        />
      )}
    </fieldset>
  );
}

/** Keeping the settings as a preset of the person's, under a name they give. */
function SavePreset({ run }: { readonly run: RunCommand }): ReactNode {
  const [name, setName] = useState('');
  const save = (): void => {
    if (run(ExportCommand.SavePreset, { name })) setName('');
  };
  return (
    <div className="ag-export-save-preset">
      <TextField
        label="Preset name"
        description="Keeps these settings, but what is exported, as a preset of yours."
        value={name}
        onValueChange={setName}
        onSubmit={save}
      />
      <Button compact onClick={save}>
        Save as a preset
      </Button>
    </div>
  );
}

/** What the open dialog holds. */
function OpenDialogBody({
  open,
  props,
}: {
  readonly open: OpenExportDialog;
  readonly props: ExportDialogProps;
}): ReactNode {
  const { dialog, exports, presets } = props;
  const trusted = useSyncExternalStore(
    exports.destinations.trusted.subscribe,
    exports.destinations.trusted.get,
  );
  // Followed so the formats this browser cannot write are said as a module fails to load.
  useSyncExternalStore(exports.codecs.environment.subscribe, exports.codecs.environment.get);
  const blockers = exportBlockers(open, exports);
  const sentence =
    blockers.length === 0 && open.planned.ok
      ? whatWillHappen(
          open.settings,
          open.planned.value,
          open.destination,
          (key) => trusted.find((folder) => folder.key === key)?.name,
        )
      : undefined;
  return (
    <>
      <RangeControl
        settings={open.settings}
        context={open.context}
        selection={open.selection}
        onRange={dialog.chooseRange}
      />
      <Presets open={open} own={presets} dialog={dialog} />
      <FormatControl open={open} exports={exports} dialog={dialog} />
      <details className="ag-export-every-setting">
        <summary>{EXPORT_DIALOG_WORDS.everySetting}</summary>
        <fieldset className="ag-settings-group">
          <legend>Encoding</legend>
          <EncodingControls
            settings={open.settings}
            onSettings={(settings) => {
              dialog.edit(() => settings);
            }}
          />
        </fieldset>
        <CommonControls
          settings={open.settings}
          context={open.context}
          onSettings={(settings) => {
            dialog.edit(() => settings);
          }}
        />
        <SavePreset run={props.run} />
      </details>
      <DestinationControls open={open} exports={exports} dialog={dialog} />
      <Outcome blockers={blockers} sentence={sentence} />
    </>
  );
}

/** What the export will do, or every reason it cannot, said as it changes. */
function Outcome({
  blockers,
  sentence,
}: {
  readonly blockers: readonly string[];
  readonly sentence: string | undefined;
}): ReactNode {
  return (
    <div className="ag-export-outcome" aria-live="polite">
      {sentence !== undefined && <p className="ag-export-sentence">{sentence}</p>}
      {blockers.length > 0 && (
        <ul
          id={OUTCOME_ID}
          className="ag-export-blockers"
          aria-label="Why this cannot be exported yet"
        >
          {blockers.map((reason) => (
            <li key={reason} data-ag-status="unavailable">
              {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The list of reasons, which the Export button is described by while it cannot be pressed. */
const OUTCOME_ID = 'ag-export-blockers';

/** The Export dialog (see the module comment). */
export function ExportDialog(props: ExportDialogProps): ReactNode {
  const { dialog, run, unavailableReason } = props;
  const state = useSyncExternalStore(dialog.subscribe, dialog.get);
  const startReason = unavailableReason(ExportCommand.Start);
  const reasonId = useId();
  return (
    <ModalDialog
      open={state.kind === 'open'}
      onOpenChange={(open) => {
        if (!open) run(ExportCommand.CloseDialog);
      }}
      title={EXPORT_DIALOG_WORDS.title}
      description="Choose a preset, or set every value yourself; what the export will do is said before it starts."
      actions={
        <>
          {startReason !== undefined && (
            <p id={reasonId} className="ag-panel-note" data-ag-status="unavailable">
              {startReason}
            </p>
          )}
          <Button
            onClick={() => {
              run(ExportCommand.CloseDialog);
            }}
          >
            Cancel
          </Button>
          <NotedButton
            tone={ButtonTone.Primary}
            reasonId={startReason === undefined ? undefined : reasonId}
            onPress={() => {
              run(ExportCommand.Start);
            }}
          >
            {EXPORT_DIALOG_WORDS.start}
          </NotedButton>
        </>
      }
    >
      {state.kind === 'open' && <OpenDialogBody open={state} props={props} />}
    </ModalDialog>
  );
}
