/**
 * A loop's checks as a table (ADR-0103): each check, its verdict in words
 * beside the glyph of its kind, its value, the threshold it is judged by, the
 * audio the seam was compared with, and the channel where it is worst. A
 * verdict is a word, never a colour alone.
 *
 * Drawn in the design language's table, each check the header of its row.
 */

import type { ReactNode } from 'react';

import { Verdict, VerdictKind } from '@audiogubbins/design-system';
import type { LoopMetrics, Verdict as LoopVerdict } from '@audiogubbins/loop-analysis';

import { VERDICT_WORDS, checkRows } from './loop-words.js';

/** The glyph each verdict of a check is drawn with. */
const VERDICT_KINDS: Readonly<Record<LoopVerdict, VerdictKind>> = {
  pass: VerdictKind.Passes,
  warn: VerdictKind.Warns,
  fail: VerdictKind.Fails,
  'not-applicable': VerdictKind.None,
};

/** The checks of `metrics`, named by `caption`; `channels` names each channel. */
export function ChecksTable({
  metrics,
  channels,
  caption,
}: {
  readonly metrics: LoopMetrics;
  readonly channels: readonly string[];
  readonly caption: string;
}): ReactNode {
  return (
    <div className="ag-table-frame">
      <table className="ag-table ag-row-headed-table ag-loop-checks">
        <caption className="ag-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col">Verdict</th>
            <th scope="col">Value</th>
            <th scope="col">Threshold</th>
            <th scope="col">Compared with</th>
            <th scope="col">Worst channel</th>
          </tr>
        </thead>
        <tbody>
          {checkRows(metrics, channels).map((row) => (
            <tr key={row.key} data-ag-verdict={row.verdict}>
              <th scope="row">{row.label}</th>
              <td data-ag-kind="verdict">
                <Verdict kind={VERDICT_KINDS[row.verdict]}>{VERDICT_WORDS[row.verdict]}</Verdict>
              </td>
              <td className="ag-figure">{row.value}</td>
              <td data-ag-quiet="">{row.threshold}</td>
              <td data-ag-quiet="">{row.reference ?? 'Not a seam check'}</td>
              <td data-ag-quiet="">{row.channel ?? 'Not by channel'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The worst verdict among `metrics`' checks, which the loop's verdict line is drawn in. */
export function worstVerdict(
  metrics: LoopMetrics,
  channels: readonly string[],
): 'fail' | 'warn' | 'pass' {
  const verdicts = new Set(checkRows(metrics, channels).map((row) => row.verdict));
  if (verdicts.has('fail')) return 'fail';
  return verdicts.has('warn') ? 'warn' : 'pass';
}
