/**
 * The seam as it is heard (ADR-0103): the loop's last window of audio, then
 * its first, as the engine plays them when it jumps from the loop's end back
 * to its start, one trace a channel, the seam marked between them. A drawing
 * alone says nothing to a screen reader, so the figure is named by what it
 * shows and each channel's jump is said in words beside it.
 */

import { useId, type ReactNode } from 'react';

import type { LoopAnalysis } from '@audiogubbins/loop-analysis';

import { millisecondsWords } from './loop-words.js';

/** The drawing's width and each channel's height, in its own units. */
const WIDTH = 400;
const CHANNEL_HEIGHT = 60;

/** The most columns a trace is drawn with: one a unit of width. */
const COLUMNS = WIDTH;

const SAMPLE = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** A sample value with the typographic minus. */
function sampleWords(value: number): string {
  return SAMPLE.format(value).replace('-', '−');
}

/**
 * The outline of `samples` across the drawing, a column's least and greatest
 * joined, so a window of thousands of frames draws in a few hundred points.
 */
function outline(samples: Float32Array, top: number): string {
  const columns = Math.min(COLUMNS, samples.length);
  const points: string[] = [];
  const middle = top + CHANNEL_HEIGHT / 2;
  const scale = CHANNEL_HEIGHT / 2;
  for (let column = 0; column < columns; column += 1) {
    const from = Math.floor((column * samples.length) / columns);
    const to = Math.max(from + 1, Math.floor(((column + 1) * samples.length) / columns));
    let least = Number.POSITIVE_INFINITY;
    let greatest = Number.NEGATIVE_INFINITY;
    for (let index = from; index < to; index += 1) {
      const value = samples[index] ?? 0;
      if (value < least) least = value;
      if (value > greatest) greatest = value;
    }
    const x = ((column + 0.5) * WIDTH) / columns;
    points.push(`${x.toFixed(1)},${(middle - greatest * scale).toFixed(1)}`);
    if (least !== greatest) points.push(`${x.toFixed(1)},${(middle - least * scale).toFixed(1)}`);
  }
  return points.join(' ');
}

/** The tail then the head of each channel, as one array. */
function joined(tail: Float32Array, head: Float32Array): Float32Array {
  const stream = new Float32Array(tail.length + head.length);
  stream.set(tail, 0);
  stream.set(head, tail.length);
  return stream;
}

/** The loop's seam as heard, drawn and said. */
export function SeamView({
  analysis,
  channels,
}: {
  readonly analysis: LoopAnalysis;
  /** Each channel's name, by index. */
  readonly channels: readonly string[];
}): ReactNode {
  const caption = useId();
  const { tail, head } = analysis.seam;
  const span = millisecondsWords(analysis.windowFrames, analysis.sampleRate);
  const height = CHANNEL_HEIGHT * Math.max(1, tail.length);
  return (
    <figure className="ag-loop-seam" aria-labelledby={caption}>
      <figcaption id={caption}>
        {`The seam as it is heard: the loop’s last ${span}, then its first ${span}, the jump between them marked.`}
      </figcaption>
      <svg viewBox={`0 0 ${String(WIDTH)} ${String(height)}`} aria-hidden="true" focusable="false">
        {tail.map((samples, channel) => (
          <polyline
            key={channels[channel] ?? String(channel)}
            points={outline(
              joined(samples, head[channel] ?? new Float32Array()),
              channel * CHANNEL_HEIGHT,
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
          />
        ))}
        <line
          x1={WIDTH / 2}
          x2={WIDTH / 2}
          y1={0}
          y2={height}
          stroke="currentColor"
          strokeDasharray="4 3"
        />
      </svg>
      <ul className="ag-loop-seam-words">
        {tail.map((samples, channel) => (
          <li key={channels[channel] ?? String(channel)}>
            {`${channels[channel] ?? `Channel ${String(channel + 1)}`}: the loop ends at ${sampleWords(samples.at(-1) ?? 0)} and starts again at ${sampleWords(head[channel]?.[0] ?? 0)}.`}
          </li>
        ))}
      </ul>
    </figure>
  );
}
