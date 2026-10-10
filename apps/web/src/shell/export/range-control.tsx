/**
 * What the Export dialog exports (ADR-0092, REQ-EDIT-014): the whole asset,
 * one of its regions, every region a file each, or the selection the dialog
 * was opened with.
 */

import type { ReactNode } from 'react';

import type { ExportContext, ExportRange, ExportSettings } from '@audiogubbins/import-export';

import { ChoiceField, type Choice } from './setting-fields.js';

/** The ranges offered: the whole asset, each region, every region, and the selection where one is. */
function rangeChoices(
  context: ExportContext,
  selection: Extract<ExportRange, { readonly kind: 'selection' }> | undefined,
  current: ExportRange,
): readonly Choice<ExportRange>[] {
  const { regions } = context.source;
  const shown = selection ?? (current.kind === 'selection' ? current : undefined);
  return [
    { value: { kind: 'project' }, label: 'The whole asset' },
    ...regions.map((region) => ({
      value: { kind: 'region', region: region.id } as const,
      label: `The region “${region.name}”`,
    })),
    ...(regions.length === 0
      ? []
      : [{ value: { kind: 'every-region' } as const, label: 'Every region, a file each' }]),
    ...(shown === undefined ? [] : [{ value: shown, label: 'The selection' }]),
  ];
}

/** Whether two ranges are the same. */
function sameRange(left: ExportRange, right: ExportRange): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The range control, which sets the range as the dialog's store does. */
export function RangeControl({
  settings,
  context,
  selection,
  onRange,
}: {
  readonly settings: ExportSettings;
  readonly context: ExportContext;
  readonly selection: Extract<ExportRange, { readonly kind: 'selection' }> | undefined;
  readonly onRange: (range: ExportRange) => void;
}): ReactNode {
  const choices = rangeChoices(context, selection, settings.range);
  const chosen = choices.find((choice) => sameRange(choice.value, settings.range));
  return (
    <ChoiceField
      label="Export"
      value={chosen?.value ?? settings.range}
      choices={choices}
      onChoose={onRange}
    />
  );
}
