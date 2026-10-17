/**
 * The seam as it is heard (ADR-0103): the loop's last window of audio, then
 * its first, as the engine plays them when it jumps from the loop's end back
 * to its start, one trace a channel, the seam marked between them and the
 * jump across it shown by the two samples either side. It is drawn in the
 * display palette, the light one in the light theme (design language,
 * section 8). A drawing alone says nothing to a screen reader, so the figure
 * is named by what it shows and each channel's jump is said in words, which
 * the drawing shows to a sighted reader.
 */

import { useId, type CSSProperties, type ReactNode } from 'react';

import type { LoopAnalysis } from '@audiogubbins/loop-analysis';

import { millisecondsWords } from './loop-words.js';

/** The drawing's width and each channel's height, in its own units. */
const WIDTH = 400;
const CHANNEL_HEIGHT = 60;

/** How far beside the seam the jump across it is drawn, in the drawing's units. */
const JUMP_OFFSET = 6;

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

/** Where a sample value of the channel drawn from `top` sits on the drawing. */
function heightOf(value: number, top: number): number {
  return top + CHANNEL_HEIGHT / 2 - (value * CHANNEL_HEIGHT) / 2;
}

/** How many channels the drawing holds, which the stylesheet sizes it by. */
function channelsStyle(
  channels: number,
): CSSProperties & { readonly '--ag-seam-channels': number } {
  return { '--ag-seam-channels': channels };
}

/** The tail then the head of each channel, as one array. */
function joined(tail: Float32Array, head: Float32Array): Float32Array {
  const stream = new Float32Array(tail.length + head.length);
  stream.set(tail, 0);
  stream.set(head, tail.length);
  return stream;
}

/**
 * One channel of the seam, from `top`: its centre line, its trace, and the
 * jump across the seam between the last sample and the first.
 */
function SeamChannel({
  tail,
  head,
  top,
}: {
  readonly tail: Float32Array;
  readonly head: Float32Array;
  readonly top: number;
}): ReactNode {
  const ends = heightOf(tail.at(-1) ?? 0, top);
  const starts = heightOf(head[0] ?? 0, top);
  return (
    <g>
      <line
        className="ag-loop-seam-centre"
        x1={0}
        x2={WIDTH}
        y1={top + CHANNEL_HEIGHT / 2}
        y2={top + CHANNEL_HEIGHT / 2}
      />
      <polyline className="ag-loop-seam-trace" points={outline(joined(tail, head), top)} />
      <line
        className="ag-loop-seam-jump"
        x1={WIDTH / 2 + JUMP_OFFSET}
        x2={WIDTH / 2 + JUMP_OFFSET}
        y1={ends}
        y2={starts}
      />
      <line className="ag-loop-seam-dot" x1={WIDTH / 2} x2={WIDTH / 2} y1={ends} y2={ends} />
      <line className="ag-loop-seam-dot" x1={WIDTH / 2} x2={WIDTH / 2} y1={starts} y2={starts} />
    </g>
  );
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
      <figcaption id={caption} className="ag-loop-seam-caption">
        {`The seam as it is heard: the loop’s last ${span}, then its first ${span}, the jump between them marked.`}
      </figcaption>
      <svg
        className="ag-loop-seam-drawing"
        viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
        preserveAspectRatio="none"
        style={channelsStyle(Math.max(1, tail.length))}
        aria-hidden="true"
        focusable="false"
      >
        {tail.map((samples, channel) => (
          <SeamChannel
            key={channels[channel] ?? String(channel)}
            tail={samples}
            head={head[channel] ?? new Float32Array()}
            top={channel * CHANNEL_HEIGHT}
          />
        ))}
        <line className="ag-loop-seam-mark" x1={WIDTH / 2} x2={WIDTH / 2} y1={0} y2={height} />
      </svg>
      <ul className="ag-visually-hidden">
        {tail.map((samples, channel) => (
          <li key={channels[channel] ?? String(channel)}>
            {`${channels[channel] ?? `Channel ${String(channel + 1)}`}: the loop ends at ${sampleWords(samples.at(-1) ?? 0)} and starts again at ${sampleWords(head[channel]?.[0] ?? 0)}.`}
          </li>
        ))}
      </ul>
    </figure>
  );
}
