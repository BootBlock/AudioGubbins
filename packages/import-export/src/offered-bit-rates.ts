/**
 * The constant bit rates an export's encoder codes the stream its settings
 * make (ADR-0092): the settings' rate, and the channels the project's layout
 * becomes by their conversion. What the Export dialog offers, read from the
 * same descriptor validation holds the settings to, so the dialog offers what
 * validation takes.
 */

import { constantBitRates } from '@audiogubbins/codecs';
import { channelCount } from '@audiogubbins/domain';

import type { ExportContext } from './export-context.js';
import { exportTarget } from './export-formats.js';
import type { ExportSettings } from './export-settings.js';
import { layoutConversion } from './layout-conversion.js';

/**
 * The constant bit rates, in kbit/s and ascending, the encoder of `settings`'
 * codec codes their stream at; `undefined` where its descriptor states none,
 * so the format's own rules decide.
 */
export function offeredBitRates(
  settings: ExportSettings,
  context: ExportContext,
): readonly number[] | undefined {
  const write = context.codecs(exportTarget(settings).codec)?.write;
  if (write === undefined) return undefined;
  const { layout } = context.source;
  const converted = layoutConversion(layout, settings.channels);
  const channels = channelCount(converted.ok ? converted.value.to : layout);
  return constantBitRates(write, { sampleRate: settings.sampleRate, channels });
}
