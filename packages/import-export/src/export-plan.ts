/**
 * An export, planned: from settings the person chose to a file for each span
 * its range covers, each with its render, its name and its dither's key, or
 * every reason the settings cannot be made, before anything renders.
 */

import { combine, flatMapResult, mapResult, type DomainResult } from '@audiogubbins/domain';

import { ditherKey } from './dither-key.js';
import type { ExportContext } from './export-context.js';
import { exportTarget, type ExportTarget } from './export-formats.js';
import { exportSpans, type ExportSpan } from './export-range.js';
import { exportRenderPlan, type ExportRenderPlan } from './export-render-plan.js';
import type { ExportSettings } from './export-settings.js';
import type { ExportFileName } from './file-name-safety.js';
import {
  fillFileNameTemplate,
  readFileNameTemplate,
  type ExportClock,
} from './file-name-template.js';
import { validateExportSettings } from './settings-validation.js';

/** One file of an export. */
export interface PlannedFile {
  readonly span: ExportSpan;
  readonly render: ExportRenderPlan;

  /** The name the file is wanted under, made safe as it is delivered (`decideCollision`). */
  readonly name: ExportFileName;
  readonly target: ExportTarget;

  /** The key the file's dither draws under (`Quantiser`). */
  readonly ditherKey: number;
}

/** The files `settings` make from the context's project, asked for at `clock`, or why none can be. */
export function planExport(
  settings: ExportSettings,
  context: ExportContext,
  clock: ExportClock,
): DomainResult<readonly PlannedFile[]> {
  const target = exportTarget(settings);
  const key = ditherKey(settings);
  return flatMapResult(validateExportSettings(settings, context), () =>
    flatMapResult(readFileNameTemplate(settings.fileName), (template) =>
      flatMapResult(exportSpans(settings.range, context.source), (spans) =>
        combine(
          spans.map((span, index) =>
            mapResult(exportRenderPlan(span, settings.sampleRate, settings.channels), (render) => ({
              span,
              render,
              name: {
                stem: fillFileNameTemplate(template, {
                  project: context.source.name,
                  region: span.region?.name,
                  index: index + 1,
                  count: spans.length,
                  clock,
                  extension: target.extension,
                }),
                extension: target.extension,
              },
              target,
              ditherKey: key,
            })),
          ),
        ),
      ),
    ),
  );
}
