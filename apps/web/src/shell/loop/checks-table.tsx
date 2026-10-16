/**
 * A loop's checks as a table (ADR-0103): each check, its verdict in words,
 * its value, the threshold it is judged by, the audio the seam was compared
 * with, and the channel where it is worst. A verdict is a word in a cell of
 * its own, never a colour alone.
 */

import type { ReactNode } from 'react';

import type { LoopMetrics } from '@audiogubbins/loop-analysis';

import { VERDICT_WORDS, checkRows } from './loop-words.js';

/** The checks of `metrics`, under `caption`; `channels` names each channel. */
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
    <table className="ag-loop-checks">
      <caption>{caption}</caption>
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
            <td>{VERDICT_WORDS[row.verdict]}</td>
            <td>{row.value}</td>
            <td>{row.threshold}</td>
            <td>{row.reference ?? 'Not a seam check'}</td>
            <td>{row.channel ?? 'Not by channel'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
