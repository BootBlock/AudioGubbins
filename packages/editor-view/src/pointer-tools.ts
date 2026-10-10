/**
 * What a press, a drag and a release do with each tool (REQ-EDIT-065).
 *
 * The explicit tools and the contextual behaviour (a held space bar for the
 * hand, a drag on a selection's edge to move it, a drag on a marker or on a
 * region's end in the strip to move it, shift to extend) resolve here to the
 * same intents, which the application carries out through the same commands a
 * key press or the palette runs, so a selection made with the time-selection
 * tool and one made by a shortcut are the same thing. This is a value in, value
 * out: the view keeps the interaction between events, and nothing here reads
 * the pointer or the page.
 *
 * A press becomes a drag once the pointer has moved past a few pixels, more for
 * a finger than for a mouse, so a tap is never read as a tiny drag. A tap on a
 * marker selects it, and a tap on a region's span or end in the strip selects
 * the region, shift adding it to those selected, with every tool but the hand
 * and zoom, which act on the view, and, for a region, the marker tool, which
 * places a marker there.
 *
 * The spectral marquee, lasso and brush draw a shape on a spectrogram lane
 * (`spectral-tools.ts`), which becomes a `select-spectral` intent on release;
 * the brush marks a single dab where it is clicked. Elsewhere they act as the
 * time-selection tool does on a click, and select what is tapped.
 */

import type { SampleCount } from '@audiogubbins/domain';
import { PointerKind } from '@audiogubbins/input';
import type { BoundaryRange } from '@audiogubbins/timeline';

import type { HitTarget } from './hit-testing.js';
import {
  drawnShapeOf,
  isSpectralTool,
  showsSpectrogram,
  startedTrail,
  tracedTrail,
  withDrawnShape,
  type DrawnShape,
} from './spectral-tools.js';
import {
  IDLE,
  type Interaction,
  type Pressed,
  type ToolContext,
  type ToolInput,
  type ToolIntent,
  type ToolPreview,
  type ToolStep,
} from './tool-values.js';
import { ToolId } from './view-state.js';

/** How far a pointer moves before a press is a drag, by kind. */
const DRAG_START: Readonly<Record<PointerKind, number>> = {
  [PointerKind.Mouse]: 3,
  [PointerKind.Pen]: 4,
  [PointerKind.Touch]: 8,
};

function range(one: SampleCount, other: SampleCount): BoundaryRange {
  return one <= other ? { start: one, end: other } : { start: other, end: one };
}

/** The channels between the lanes a drag started and is over, or every channel. */
function draggedChannels(
  context: ToolContext,
  from: number | undefined,
  to: number | undefined,
): readonly number[] | undefined {
  const visible = context.visibleChannels;
  const first = from === undefined ? -1 : visible.indexOf(from);
  const last = to === undefined ? first : visible.indexOf(to);
  if (first < 0 || last < 0) return undefined;
  const spanned = visible.slice(Math.min(first, last), Math.max(first, last) + 1);
  return spanned.length === visible.length ? undefined : spanned;
}

/** The tool a press uses: the hand while space is held, the tool chosen otherwise. */
function effectiveTool(context: ToolContext): ToolId {
  return context.panning ? ToolId.Hand : context.tool;
}

/** Whether a press with `tool` draws a spectral shape: a spectral tool's, in a spectrogram. */
function drawsSpectrally(tool: ToolId, context: ToolContext): boolean {
  return (
    isSpectralTool(tool) &&
    showsSpectrogram(context.spectral.lane) &&
    (context.hit.kind === 'lane' || context.hit.kind === 'selection-edge')
  );
}

/** A press. */
export function press(context: ToolContext, input: ToolInput): ToolStep {
  const tool = effectiveTool(context);
  const interaction: Interaction = {
    kind: 'pressed',
    tool,
    hit: context.hit,
    start: input,
    context,
    dragging: false,
    lastX: input.x,
    trail: drawsSpectrally(tool, context) ? startedTrail(tool, context.spectral, input) : undefined,
  };
  return { interaction, preview: undefined, intents: [] };
}

/** `state` with `input` traced onto its trail, where it has one; `final` at a release. */
function traced(state: Pressed, input: ToolInput, final: boolean): Pressed {
  const trail = tracedTrail(state.trail, state.tool, state.context.spectral, input, final);
  return trail === state.trail ? state : { ...state, trail };
}

/** The shape a spectral drag has drawn by `input`, and how it joins the selection. */
function drawnShape(state: Pressed, input: ToolInput): DrawnShape | undefined {
  const { context, start, tool, trail } = state;
  const channels = draggedChannels(context, start.channel, start.channel);
  return drawnShapeOf({ tool, spectral: context.spectral, start, trail, channels }, input);
}

function spectralPreview(state: Pressed, input: ToolInput): ToolPreview | undefined {
  const drawn = drawnShape(state, input);
  if (drawn === undefined) return undefined;
  const { spectral } = state.context;
  return {
    kind: 'spectral-shape',
    drawn,
    selection: withDrawnShape(spectral.selection, drawn, spectral.channelCount),
  };
}

/**
 * A spectral tool's click: the brush marks one dab where it lands on a
 * spectrogram, and each places the playhead where it is clicked elsewhere in
 * a lane, as the time-selection tool does.
 */
function spectralClick(state: Pressed): readonly ToolIntent[] {
  if (state.tool === ToolId.SpectralBrush && drawsSpectrally(state.tool, state.context)) {
    const drawn = drawnShape(state, state.start);
    return drawn === undefined ? [] : [{ kind: 'select-spectral', drawn }];
  }
  return state.hit.kind === 'lane' || state.hit.kind === 'selection-edge'
    ? [{ kind: 'set-playhead', position: state.start.boundary }]
    : [];
}

/** The anchor a time selection is dragged from: the far edge when shift extends one. */
function anchorOf(state: Pressed): SampleCount {
  const { selection } = state.context;
  if (state.hit.kind === 'selection-edge' && selection !== undefined) {
    return state.hit.edge === 'start' ? selection.end : selection.start;
  }
  if (state.start.shift && selection !== undefined) {
    const toStart = Math.abs(state.start.boundary - selection.start);
    const toEnd = Math.abs(state.start.boundary - selection.end);
    return toStart <= toEnd ? selection.end : selection.start;
  }
  return state.start.boundary;
}

function dragPreview(state: Pressed, input: ToolInput): ToolPreview | undefined {
  const { hit, tool, context } = state;
  if (hit.kind === 'marker' && (tool === ToolId.Select || tool === ToolId.Marker)) {
    return { kind: 'marker', id: hit.id, position: input.boundary };
  }
  if (hit.kind === 'region-edge' && (tool === ToolId.Select || tool === ToolId.Region)) {
    return {
      kind: 'region-boundary',
      id: hit.id,
      boundary: hit.boundary,
      position: input.boundary,
    };
  }
  if (hit.kind === 'ruler') return undefined;
  if (drawsSpectrally(tool, context)) return spectralPreview(state, input);
  switch (tool) {
    case ToolId.Select:
    case ToolId.TimeSelect: {
      if (hit.kind !== 'lane' && hit.kind !== 'selection-edge') return undefined;
      const channels =
        tool === ToolId.TimeSelect || hit.kind === 'selection-edge'
          ? undefined
          : draggedChannels(context, state.start.channel, input.channel);
      return { kind: 'time-range', range: range(anchorOf(state), input.boundary), channels };
    }
    case ToolId.Region:
      return hit.kind === 'lane' || hit.kind === 'selection-edge'
        ? {
            kind: 'time-range',
            range: range(state.start.boundary, input.boundary),
            channels: undefined,
          }
        : undefined;
    case ToolId.Zoom:
      return { kind: 'zoom-range', range: range(state.start.boundary, input.boundary) };
    case ToolId.Razor:
      return { kind: 'razor', position: input.boundary };
    default:
      return undefined;
  }
}

/** A move while pressed, or a hover. */
export function move(interaction: Interaction, input: ToolInput): ToolStep {
  if (interaction.kind === 'idle') return { interaction, preview: undefined, intents: [] };
  const dragging =
    interaction.dragging ||
    Math.abs(input.x - interaction.start.x) + Math.abs(input.y - interaction.start.y) >=
      DRAG_START[input.pointer];
  const next = {
    ...(dragging ? traced(interaction, input, false) : interaction),
    dragging,
    lastX: input.x,
  };
  if (!dragging) return { interaction: next, preview: undefined, intents: [] };
  if (interaction.tool === ToolId.Hand) {
    // The view follows the pointer: dragging right shows what is to the left.
    return {
      interaction: next,
      preview: undefined,
      intents: [{ kind: 'scroll', dx: interaction.lastX - input.x }],
    };
  }
  if (interaction.hit.kind === 'ruler') {
    return {
      interaction: next,
      preview: undefined,
      intents: [{ kind: 'set-playhead', position: input.boundary }],
    };
  }
  return { interaction: next, preview: dragPreview(next, input), intents: [] };
}

const STRIP: HitTarget = { kind: 'strip' };

function clicked(state: Pressed): readonly ToolIntent[] {
  const { tool, start } = state;
  const selects = tool !== ToolId.Hand && tool !== ToolId.Zoom;
  const onRegion = state.hit.kind === 'region-edge' || state.hit.kind === 'region';
  if (onRegion && selects && tool !== ToolId.Marker) {
    return [{ kind: 'select-region', id: state.hit.id, add: start.shift }];
  }
  const hit = onRegion ? STRIP : state.hit;
  if (hit.kind === 'ruler') return [{ kind: 'set-playhead', position: start.boundary }];
  if (hit.kind === 'marker' && selects) {
    return [{ kind: 'select-marker', id: hit.id, add: start.shift }];
  }
  if (isSpectralTool(tool)) return spectralClick(state);
  switch (tool) {
    case ToolId.Select:
    case ToolId.TimeSelect:
      if (start.shift && state.context.selection !== undefined) {
        return [
          {
            kind: 'select-time',
            range: range(anchorOf(state), start.boundary),
            channels: undefined,
          },
        ];
      }
      return hit.kind === 'lane' || hit.kind === 'selection-edge'
        ? [{ kind: 'set-playhead', position: start.boundary }]
        : [];
    case ToolId.Marker:
      return hit.kind === 'lane' || hit.kind === 'strip'
        ? [{ kind: 'add-marker', at: start.boundary }]
        : [];
    case ToolId.Zoom:
      return [{ kind: 'zoom-step', x: start.x, direction: start.alt ? 'out' : 'in' }];
    case ToolId.Razor:
      return hit.kind === 'lane' ? [{ kind: 'split-at', position: start.boundary }] : [];
    case ToolId.Region:
      // A click makes no region of nothing; it places the playhead, as a drag's start.
      return hit.kind === 'lane' ? [{ kind: 'set-playhead', position: start.boundary }] : [];
    case ToolId.Hand:
      return [];
  }
}

/** A release: the intents the press or drag ends with. */
export function release(interaction: Interaction, input: ToolInput): ToolStep {
  if (interaction.kind === 'idle') return { interaction, preview: undefined, intents: [] };
  if (!interaction.dragging)
    return { interaction: IDLE, preview: undefined, intents: clicked(interaction) };
  const preview = dragPreview(traced(interaction, input, true), input);
  const intents: ToolIntent[] = [];
  switch (preview?.kind) {
    case 'time-range':
      if (preview.range.end <= preview.range.start) break;
      intents.push(
        interaction.tool === ToolId.Region
          ? { kind: 'make-region', range: preview.range }
          : { kind: 'select-time', range: preview.range, channels: preview.channels },
      );
      break;
    case 'marker':
      intents.push({ kind: 'move-marker', id: preview.id, to: preview.position });
      break;
    case 'region-boundary':
      intents.push({
        kind: 'move-region-boundary',
        id: preview.id,
        boundary: preview.boundary,
        to: preview.position,
      });
      break;
    case 'zoom-range':
      if (preview.range.end > preview.range.start)
        intents.push({ kind: 'zoom-to-range', range: preview.range });
      break;
    case 'razor':
      intents.push({ kind: 'split-at', position: preview.position });
      break;
    case 'spectral-shape':
      intents.push({ kind: 'select-spectral', drawn: preview.drawn });
      break;
    case undefined:
      if (interaction.hit.kind === 'ruler')
        intents.push({ kind: 'set-playhead', position: input.boundary });
      break;
  }
  return { interaction: IDLE, preview: undefined, intents };
}
