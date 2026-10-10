/**
 * Whether an export can be made as its settings ask, before anything is
 * rendered (ADR-0092).
 *
 * Every problem is reported at once, so the person correcting the Export
 * dialog sees them all, and each is a refusal with its reason: nothing is
 * clamped, rounded or substituted. The checks are the codec's descriptor and
 * the layouts the format states (`codec-checks.ts`), the format's own encoding rules (`encoding-rules.ts`),
 * the channel conversion against the layout of every span the range covers
 * (`layout-conversion.ts`), and the dither, metadata and file name
 * (`settings-checks.ts`).
 */

import { fail, succeed, type DomainFailure, type DomainResult } from '@audiogubbins/domain';

import {
  channelProblems,
  layoutProblems,
  rateProblems,
  writingDirection,
  type Writing,
} from './codec-checks.js';
import { encodingProblems } from './encoding-rules.js';
import type { CodecLookup, ExportContext, ExportableAudio } from './export-context.js';
import { exportTarget, type ExportTarget } from './export-formats.js';
import { exportSpans } from './export-range.js';
import type { ExportSettings } from './export-settings.js';
import { layoutConversion } from './layout-conversion.js';
import { ditherProblems, fileNameProblems, metadataProblems } from './settings-checks.js';

/** The problems of one piece of audio: its conversion, and the channels it gives. */
function audioProblems(
  settings: ExportSettings,
  audio: ExportableAudio,
  target: ExportTarget,
  writing: Writing | undefined,
  codecs: CodecLookup,
): readonly DomainFailure[] {
  const conversion = layoutConversion(audio.layout, settings.channels);
  if (!conversion.ok) return conversion.failures;
  const layout = conversion.value.to;
  const channels = layout.roles.length;
  const fits = writing === undefined ? [] : channelProblems(writing, channels);
  // A layout of more channels than the codec holds is refused for its count alone.
  const stated = fits.length === 0 ? layoutProblems(target, layout, codecs) : [];
  return [...fits, ...stated, ...encodingProblems(settings, channels)];
}

/** Each failure once, by its code and sentence, in the order found. */
function distinct(failures: readonly DomainFailure[]): readonly DomainFailure[] {
  const seen = new Set<string>();
  return failures.filter((one) => {
    const key = `${one.code}\u0000${one.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The settings, where an export can be made by them from the context's source, or every reason it cannot. */
export function validateExportSettings(
  settings: ExportSettings,
  context: ExportContext,
): DomainResult<ExportSettings> {
  const target = exportTarget(settings);
  const found = writingDirection(target, context.codecs);
  const writing = found.ok ? found.value : undefined;
  const spans = exportSpans(settings.range, context.source);
  const problems: DomainFailure[] = [
    ...(found.ok ? rateProblems(found.value, settings.sampleRate) : found.failures),
    ...(spans.ok
      ? spans.value.flatMap((span) =>
          audioProblems(settings, span.audio, target, writing, context.codecs),
        )
      : spans.failures),
    ...ditherProblems(settings.dither, target.depth, settings.sampleRate),
    ...metadataProblems(settings.metadata),
    ...fileNameProblems(settings.fileName, settings.range),
  ];
  const [first, ...rest] = distinct(problems);
  return first === undefined ? succeed(settings) : fail(first, ...rest);
}
