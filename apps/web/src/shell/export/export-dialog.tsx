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

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  Banner,
  BannerTone,
  Button,
  ButtonTone,
  Icon,
  ModalDialog,
  Section,
  TextField,
} from '@audiogubbins/design-system';

import { ExportCommand } from '../../commands/import-export-ids.js';
import { exportBlockers, keptFolders } from '../../export/export-blockers.js';
import type { CodecServices } from '../../codecs/codec-services.js';
import { EXPORT_DIALOG_WORDS } from '../../import-export-words.js';
import type { ExportDialogStore, OpenExportDialog } from '../../state/export-dialog-store.js';
import type { OwnExportPreset } from '../../state/stored-export-presets.js';
import type { TrustedFoldersStore } from '../../state/trusted-folders-store.js';
import type { RunCommand } from '../settings/section.js';
import { CommonControls } from './common-controls.js';
import { DestinationControls } from './destination-controls.js';
import { EncodingControls } from './encoding-controls.js';
import { whatWillHappen } from './export-words.js';
import { FormatControl } from './format-control.js';
import { Presets } from './preset-choice.js';
import { RangeControl } from './range-control.js';
import { SettingGroup } from './setting-fields.js';

/** What the dialog reads and runs. */
export interface ExportDialogProps {
  readonly dialog: ExportDialogStore;
  /** What this browser's codecs can write, which the formats are offered by. */
  readonly codecs: CodecServices;

  /** The folders kept trusted, offered as destinations. */
  readonly trusted: TrustedFoldersStore;

  /** The person's own presets, as their preferences keep them. */
  readonly presets: readonly OwnExportPreset[];
  readonly run: RunCommand;

  /** Why a command cannot run now, or `undefined` where it can. */
  readonly unavailableReason: (id: string) => string | undefined;
}

/** Keeping the settings as a preset of the person's, under a name they give. */
function SavePreset({ run }: { readonly run: RunCommand }): ReactNode {
  const [name, setName] = useState('');
  const save = (): void => {
    if (run(ExportCommand.SavePreset, { name })) setName('');
  };
  return (
    <div className="ag-dialogue-with-action ag-export-save-preset">
      <TextField
        label="Preset name"
        description="Keeps these settings, but what is exported, as a preset of yours."
        value={name}
        onValueChange={setName}
        onSubmit={save}
      />
      <Button onClick={save}>Save as a preset</Button>
    </div>
  );
}

/** Every setting, disclosed on request: the format's encoding, what every format shares, and keeping them as a preset. */
function EverySetting({
  open,
  dialog,
  run,
}: {
  readonly open: OpenExportDialog;
  readonly dialog: ExportDialogStore;
  readonly run: RunCommand;
}): ReactNode {
  const set = (settings: OpenExportDialog['settings']): void => {
    dialog.edit(() => settings);
  };
  return (
    <Section title={EXPORT_DIALOG_WORDS.everySetting} defaultOpen={false}>
      <div className="ag-dialogue-stack">
        <SettingGroup title="Encoding">
          <EncodingControls settings={open.settings} context={open.context} onSettings={set} />
        </SettingGroup>
        <CommonControls settings={open.settings} context={open.context} onSettings={set} />
        <div className="ag-dialogue-form" data-ag-labels="wide">
          <SavePreset run={run} />
        </div>
      </div>
    </Section>
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
  const { dialog, codecs, presets } = props;
  const trustedState = useSyncExternalStore(props.trusted.subscribe, props.trusted.get);
  const trusted = keptFolders(trustedState);
  // Followed so the formats this browser cannot write are said as a module fails to load.
  useSyncExternalStore(codecs.environment.subscribe, codecs.environment.get);
  const blockers = exportBlockers(open, codecs, trustedState);
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
    <div className="ag-dialogue-stack ag-export-body">
      <div className="ag-dialogue-form">
        <RangeControl
          settings={open.settings}
          context={open.context}
          selection={open.selection}
          onRange={dialog.chooseRange}
        />
      </div>
      <Presets open={open} own={presets} dialog={dialog} />
      <div className="ag-dialogue-form">
        <FormatControl open={open} codecs={codecs} dialog={dialog} />
      </div>
      <EverySetting open={open} dialog={dialog} run={props.run} />
      <DestinationControls open={open} trusted={trusted} dialog={dialog} />
      <Outcome blockers={blockers} sentence={sentence} />
    </div>
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
      {sentence !== undefined && (
        <Banner tone={BannerTone.Success} icon="export-summary">
          {sentence}
        </Banner>
      )}
      {blockers.length > 0 && (
        <Banner tone={BannerTone.Warning} icon="warning">
          <ul className="ag-export-blockers" aria-label="Why this cannot be exported yet">
            {blockers.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Banner>
      )}
    </div>
  );
}

/** The Export dialog (see the module comment). */
export function ExportDialog(props: ExportDialogProps): ReactNode {
  const { dialog, run, unavailableReason } = props;
  const state = useSyncExternalStore(dialog.subscribe, dialog.get);
  const startReason = unavailableReason(ExportCommand.Start);
  return (
    <ModalDialog
      open={state.kind === 'open'}
      onOpenChange={(open) => {
        if (!open) run(ExportCommand.CloseDialog);
      }}
      title={EXPORT_DIALOG_WORDS.title}
      icon="export"
      description="Choose a preset, or set every value yourself; what the export will do is said before it starts."
      closeLabel="Close"
      status={startReason}
      actions={
        <>
          <Button
            onClick={() => {
              run(ExportCommand.CloseDialog);
            }}
          >
            Cancel
          </Button>
          <Button
            tone={ButtonTone.Primary}
            {...(startReason === undefined ? {} : { unavailableReason: startReason })}
            onClick={() => {
              run(ExportCommand.Start);
            }}
          >
            <Icon name="export" />
            {EXPORT_DIALOG_WORDS.start}
          </Button>
        </>
      }
    >
      {state.kind === 'open' && <OpenDialogBody open={state} props={props} />}
    </ModalDialog>
  );
}
