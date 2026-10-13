/**
 * The checks of the settings every format shares: the dither against the
 * depth and the rate, the metadata edits against the policy, and the file
 * name template against the range.
 */

import type { DomainFailure } from '@audiogubbins/domain';

import type { DitherSettings, ExportRange, MetadataSettings } from './export-settings.js';
import { readFileNameTemplate, templateNames } from './file-name-template.js';
import { shapingDesignedRate } from './noise-shaping.js';
import { refusal } from './refusal.js';

/** The widest rectangular component a dither takes, in steps of the depth. */
const WIDEST_DITHER = 4;

const LARGEST_SEED = 2 ** 32 - 1;

/** A control character, which no metadata text holds beside a tab and the line breaks. */
const CONTROL = /\p{Cc}/u;

/** The control characters text may hold: a tab and the line breaks. */
const LAYOUT_CONTROLS = /[\t\n\r]/gu;

/** The longest text a metadata field takes, in UTF-16 code units. */
const LONGEST_FIELD = 4096;

/** Every problem with a dither, for an encoder taking `depth`-bit integers or floating point. */
export function ditherProblems(
  dither: DitherSettings,
  depth: number | undefined,
  sampleRate: number,
): readonly DomainFailure[] {
  if (dither.kind === 'none') return [];
  const problems: DomainFailure[] = [];
  if (depth === undefined) {
    problems.push(
      refusal(
        'dither-without-integers',
        'Dither is added before integer quantisation, and this format takes floating-point samples; choose no dither.',
      ),
    );
  }
  if (
    !Number.isFinite(dither.amplitude) ||
    dither.amplitude <= 0 ||
    dither.amplitude > WIDEST_DITHER
  ) {
    problems.push(
      refusal(
        'dither-amplitude-invalid',
        `A dither's amplitude is more than 0 and at most ${String(WIDEST_DITHER)} steps of the depth.`,
      ),
    );
  }
  if (!Number.isInteger(dither.seed) || dither.seed < 0 || dither.seed > LARGEST_SEED) {
    problems.push(
      refusal('dither-seed-invalid', 'A dither seed is a whole number from 0 to 4294967295.'),
    );
  }
  const designed = shapingDesignedRate(dither.shaping);
  if (designed !== undefined && designed !== sampleRate) {
    problems.push(
      refusal(
        'shaping-rate-unsupported',
        `This noise shaping was designed for ${String(designed)} Hz and would shape the noise wrongly at ${String(sampleRate)} Hz; choose first-order shaping or none.`,
        { rate: sampleRate },
      ),
    );
  }
  return problems;
}

/** Every problem with the metadata settings. */
export function metadataProblems(metadata: MetadataSettings): readonly DomainFailure[] {
  const problems: DomainFailure[] = [];
  if (metadata.policy === 'none' && metadata.edits.length > 0) {
    problems.push(
      refusal(
        'metadata-edits-with-none',
        'Metadata fields are edited for a file that carries none; choose minimal or full metadata, or remove the edits.',
      ),
    );
  }
  const seen = new Set<string>();
  for (const edit of metadata.edits) {
    if (seen.has(edit.key)) {
      problems.push(
        refusal(
          'metadata-edit-repeated',
          `The ${edit.key} field is edited twice; keep one edit of it.`,
          {
            key: edit.key,
          },
        ),
      );
    }
    seen.add(edit.key);
    if (
      edit.kind === 'set' &&
      (edit.value.trim() === '' ||
        edit.value.length > LONGEST_FIELD ||
        CONTROL.test(edit.value.replace(LAYOUT_CONTROLS, '')))
    ) {
      problems.push(
        refusal(
          'metadata-value-invalid',
          `The ${edit.key} field takes text of 1 to ${String(LONGEST_FIELD)} characters with no control characters; remove the field rather than empty it.`,
          { key: edit.key },
        ),
      );
    }
  }
  return problems;
}

/** Every problem with a file name template for a range. */
export function fileNameProblems(template: string, range: ExportRange): readonly DomainFailure[] {
  const read = readFileNameTemplate(template);
  if (!read.ok) return read.failures;
  const regional = range.kind === 'region' || range.kind === 'every-region';
  if (templateNames(read.value, 'region') && !regional) {
    return [
      refusal(
        'file-name-region-without-region',
        'The file name names {region}, but the export is not of a region.',
      ),
    ];
  }
  if (
    range.kind === 'every-region' &&
    !templateNames(read.value, 'region') &&
    !templateNames(read.value, 'index')
  ) {
    return [
      refusal(
        'file-names-not-distinct',
        'Every region is exported to a file of its own, so the file name needs {region} or {index} to tell them apart.',
      ),
    ];
  }
  return [];
}
