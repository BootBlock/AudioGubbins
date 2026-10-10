/**
 * The spans an export's range covers: one for the project, a region or the
 * selection, and one for each region, in timeline order, when every region is
 * exported, each becoming a file and a job of a batch (REQ-EDIT-014).
 *
 * A span is in the frames of the audio it is rendered from, at that audio's
 * rate, so a region of an asset with a rate of its own is rendered from the
 * asset as it is.
 */

import {
  ZERO_SAMPLES,
  fail,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import type { ExportSource, ExportableAudio, ExportableRegion } from './export-context.js';
import type { ExportRange } from './export-settings.js';
import { refusal } from './refusal.js';

/** One file's worth of an export: the audio, the frames of it, and the region it is, if one. */
export interface ExportSpan {
  readonly audio: ExportableAudio;
  readonly start: SampleCount;
  readonly length: SampleCount;
  readonly region: ExportableRegion | undefined;
}

function regionSpan(region: ExportableRegion): ExportSpan {
  return { audio: region, start: region.start, length: region.length, region };
}

function projectSpan(source: ExportSource): DomainResult<readonly ExportSpan[]> {
  if (source.length === 0) {
    return fail(
      refusal('range-empty', 'The project holds no audio yet, so there is nothing to export.'),
    );
  }
  return succeed([
    { audio: source, start: ZERO_SAMPLES, length: source.length, region: undefined },
  ]);
}

function selectionSpan(
  source: ExportSource,
  start: SampleCount,
  length: SampleCount,
): DomainResult<readonly ExportSpan[]> {
  if (length === 0) {
    return fail(refusal('range-empty', 'The selection is empty, so there is nothing to export.'));
  }
  if (start + length > source.length) {
    return fail(
      refusal('range-outside', 'The selection runs past the end of the project; select again.', {
        start,
        length,
        projectLength: source.length,
      }),
    );
  }
  return succeed([{ audio: source, start, length, region: undefined }]);
}

/** The spans `range` covers in `source`, or why it covers none. */
export function exportSpans(
  range: ExportRange,
  source: ExportSource,
): DomainResult<readonly ExportSpan[]> {
  switch (range.kind) {
    case 'project':
      return projectSpan(source);
    case 'selection':
      return selectionSpan(source, range.start, range.length);
    case 'region': {
      const region = source.regions.find((one) => one.id === range.region);
      return region === undefined
        ? fail(
            refusal(
              'range-region-unknown',
              'The region chosen for export is no longer in the project; choose another.',
              { region: range.region },
            ),
          )
        : succeed([regionSpan(region)]);
    }
    case 'every-region':
      return source.regions.length === 0
        ? fail(refusal('range-no-regions', 'The project has no regions to export one by one.'))
        : succeed(source.regions.map(regionSpan));
  }
}
