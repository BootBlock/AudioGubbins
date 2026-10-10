/**
 * The Export dialog's format (ADR-0090, ADR-0092): every format, each saying
 * where this browser cannot write it, and for the one chosen, why not and
 * the codecs it can write instead.
 */

import type { ReactNode } from 'react';

import {
  defaultExportSettings,
  exportTarget,
  formatName,
  type ExportFormat,
} from '@audiogubbins/import-export';

import { unavailableSentence } from '../../export/export-blockers.js';
import type { ExportServices } from '../../export/export-types.js';
import type { ExportDialogStore, OpenExportDialog } from '../../state/export-dialog-store.js';
import { FORMAT_ORDER } from './export-words.js';
import { ChoiceField, type Choice } from './setting-fields.js';

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
export function FormatControl({
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
