/**
 * What the Export dialog exports (ADR-0092, REQ-EDIT-014): the whole asset,
 * one of its regions, every region a file each, or the selection the dialog
 * was opened with.
 */

import type { ReactNode } from 'react';

import type { RegionId } from '@audiogubbins/domain';
import type { ExportContext, ExportRange, ExportSettings } from '@audiogubbins/import-export';

import { rangeWords } from './export-words.js';
import { ChoiceField, type Choice } from './setting-fields.js';

/** The ranges offered: the whole asset, each region, every region, and the selection where one is. */
function rangeChoices(
  context: ExportContext,
  selection: Extract<ExportRange, { readonly kind: 'selection' }> | undefined,
  current: ExportRange,
): readonly Choice<ExportRange>[] {
  const { regions } = context.source;
  const shown = selection ?? (current.kind === 'selection' ? current : undefined);
  const names = new Map(regions.map((region) => [region.id, region.name]));
  const nameOf = (id: RegionId): string | undefined => names.get(id);
  const choice = (value: ExportRange): Choice<ExportRange> => ({
    value,
    label: rangeWords(value, nameOf),
  });
  return [
    choice({ kind: 'project' }),
    ...regions.map((region) => choice({ kind: 'region', region: region.id })),
    ...(regions.length === 0 ? [] : [choice({ kind: 'every-region' })]),
    ...(shown === undefined ? [] : [choice(shown)]),
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
