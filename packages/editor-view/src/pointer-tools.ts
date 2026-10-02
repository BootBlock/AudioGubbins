/**
 * What a press, a drag and a release do with each tool (REQ-EDIT-065).
 *
 * The explicit tools and the contextual behaviour (a held space bar for the
 * hand, a drag on a selection's edge to move it, a drag on a marker to move it,
 * shift to extend) resolve here to the same intents, which the application
 * carries out through the same commands a key press or the palette runs, so a
 * selection made with the time-selection tool and one made by a shortcut are
 * the same thing. This is a value in, value out: the view keeps the interaction
 * between events, and nothing here reads the pointer or the page.
 *
 * A press becomes a drag once the pointer has moved past a few pixels, more for
 * a finger than for a mouse, so a tap is never read as a tiny drag.
 */

import type { MarkerId, SampleCount } from '@audiogubbins/domain';
import { PointerKind } from '@audiogubbins/input';
import type { BoundaryRange } from '@audiogubbins/timeline';

import type { HitTarget } from './hit-testing.js';
import { ToolId } from './view-state.js';

/** A pointer event as the tools read it. */
export interface ToolInput {
  readonly x: number;
  readonly y: number;
  readonly pointer: PointerKind;
  /** The boundary under the pointer, snapped where snapping is on. */
  readonly boundary: SampleCount;
  /** The channel of the lane under the pointer, if it is over one. */
  readonly channel: number | undefined;
  readonly shift: boolean;
  readonly alt: boolean;
}

/** What the view knows that a press reads. */
export interface ToolContext {
  readonly tool: ToolId;
  /** A held space bar, which makes any tool the hand until it is let go. */
  readonly panning: boolean;
  readonly hit: HitTarget;
  /** The time selection shown, which shift extends. */
  readonly selection: BoundaryRange | undefined;
  /** The channels shown, in the order their lanes are drawn. */
  readonly visibleChannels: readonly number[];
}

/** What the application does, through its commands. */
export type ToolIntent =
  | {
      readonly kind: 'select-time';
      readonly range: BoundaryRange;
      readonly channels: readonly number[] | undefined;
    }
  | { readonly kind: 'select-marker'; readonly id: MarkerId; readonly add: boolean }
  | { readonly kind: 'set-playhead'; readonly position: SampleCount }
  | { readonly kind: 'move-marker'; readonly id: MarkerId; readonly to: SampleCount }
  | { readonly kind: 'add-marker'; readonly at: SampleCount }
  | { readonly kind: 'scroll'; readonly dx: number }
  | { readonly kind: 'zoom-to-range'; readonly range: BoundaryRange }
  | { readonly kind: 'zoom-step'; readonly x: number; readonly direction: 'in' | 'out' }
  | { readonly kind: 'split-at'; readonly position: SampleCount }
  | { readonly kind: 'make-region'; readonly range: BoundaryRange };

/** What the view draws while a drag is under way, before anything is committed. */
export type ToolPreview =
  | {
      readonly kind: 'time-range';
      readonly range: BoundaryRange;
      readonly channels: readonly number[] | undefined;
    }
  | { readonly kind: 'marker'; readonly id: MarkerId; readonly position: SampleCount }
  | { readonly kind: 'zoom-range'; readonly range: BoundaryRange }
  | { readonly kind: 'razor'; readonly position: SampleCount };

/** A press in progress. */
export type Interaction =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'pressed';
      readonly tool: ToolId;
      readonly hit: HitTarget;
      readonly start: ToolInput;
      readonly context: ToolContext;
      readonly dragging: boolean;
      readonly lastX: number;
    };

export const IDLE: Interaction = { kind: 'idle' };

/** How far a pointer moves before a press is a drag, by kind. */
const DRAG_START: Readonly<Record<PointerKind, number>> = {
  [PointerKind.Mouse]: 3,
  [PointerKind.Pen]: 4,
  [PointerKind.Touch]: 8,
};

/** A step of an interaction: what it is now, what to draw, and what to do. */
export interface ToolStep {
  readonly interaction: Interaction;
  readonly preview: ToolPreview | undefined;
  readonly intents: readonly ToolIntent[];
}

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

/** A press. */
export function press(context: ToolContext, input: ToolInput): ToolStep {
  const interaction: Interaction = {
    kind: 'pressed',
    tool: effectiveTool(context),
    hit: context.hit,
    start: input,
    context,
    dragging: false,
    lastX: input.x,
  };
  return { interaction, preview: undefined, intents: [] };
}

/** The anchor a time selection is dragged from: the far edge when shift extends one. */
function anchorOf(state: Extract<Interaction, { kind: 'pressed' }>): SampleCount {
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

function dragPreview(
  state: Extract<Interaction, { kind: 'pressed' }>,
  input: ToolInput,
): ToolPreview | undefined {
  const { hit, tool, context } = state;
  if (hit.kind === 'marker' && (tool === ToolId.Select || tool === ToolId.Marker)) {
    return { kind: 'marker', id: hit.id, position: input.boundary };
  }
  if (hit.kind === 'ruler') return undefined;
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
  const next = { ...interaction, dragging, lastX: input.x };
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

function clicked(state: Extract<Interaction, { kind: 'pressed' }>): readonly ToolIntent[] {
  const { hit, tool, start } = state;
  if (hit.kind === 'ruler') return [{ kind: 'set-playhead', position: start.boundary }];
  if (hit.kind === 'marker' && tool !== ToolId.Hand && tool !== ToolId.Zoom) {
    return [{ kind: 'select-marker', id: hit.id, add: start.shift }];
  }
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
  const preview = dragPreview(interaction, input);
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
    case 'zoom-range':
      if (preview.range.end > preview.range.start)
        intents.push({ kind: 'zoom-to-range', range: preview.range });
      break;
    case 'razor':
      intents.push({ kind: 'split-at', position: preview.position });
      break;
    case undefined:
      if (interaction.hit.kind === 'ruler')
        intents.push({ kind: 'set-playhead', position: input.boundary });
      break;
  }
  return { interaction: IDLE, preview: undefined, intents };
}
