/**
 * The values a tool reads and makes (REQ-EDIT-065): a pointer event as the
 * tools read it, what the view knows at a press, the intents the application
 * carries out through its commands, what a drag shows before it is let go,
 * and the press in progress between events. What each tool does with them is
 * `pointer-tools.ts`.
 */

import type { MarkerId, RegionBoundary, RegionId, SampleCount } from '@audiogubbins/domain';
import type { PointerKind } from '@audiogubbins/input';
import type { BoundaryRange, SelectionSet } from '@audiogubbins/timeline';

import type { HitTarget } from './hit-testing.js';
import type { DrawnShape, SpectralToolContext, Trail } from './spectral-tools.js';
import type { ToolId } from './view-state.js';

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
  /**
   * How hard the pointer acts, from 0 to 1, as the input model's
   * `toolStrength` gives it: a pen's pressure where the person allows it,
   * and the fixed strength otherwise.
   */
  readonly strength: number;
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
  /** What a spectral tool reads. */
  readonly spectral: SpectralToolContext;
}

/** What the application does, through its commands. */
export type ToolIntent =
  | {
      readonly kind: 'select-time';
      readonly range: BoundaryRange;
      readonly channels: readonly number[] | undefined;
    }
  | { readonly kind: 'select-marker'; readonly id: MarkerId; readonly add: boolean }
  | { readonly kind: 'select-region'; readonly id: RegionId; readonly add: boolean }
  | { readonly kind: 'set-playhead'; readonly position: SampleCount }
  | { readonly kind: 'move-marker'; readonly id: MarkerId; readonly to: SampleCount }
  | {
      readonly kind: 'move-region-boundary';
      readonly id: RegionId;
      readonly boundary: RegionBoundary;
      readonly to: SampleCount;
    }
  | { readonly kind: 'add-marker'; readonly at: SampleCount }
  | { readonly kind: 'scroll'; readonly dx: number }
  | { readonly kind: 'zoom-to-range'; readonly range: BoundaryRange }
  | { readonly kind: 'zoom-step'; readonly x: number; readonly direction: 'in' | 'out' }
  | { readonly kind: 'split-at'; readonly position: SampleCount }
  | { readonly kind: 'make-region'; readonly range: BoundaryRange }
  | { readonly kind: 'select-spectral'; readonly drawn: DrawnShape };

/** What the view draws while a drag is under way, before anything is committed. */
export type ToolPreview =
  | {
      readonly kind: 'time-range';
      readonly range: BoundaryRange;
      readonly channels: readonly number[] | undefined;
    }
  | { readonly kind: 'marker'; readonly id: MarkerId; readonly position: SampleCount }
  | {
      readonly kind: 'region-boundary';
      readonly id: RegionId;
      readonly boundary: RegionBoundary;
      readonly position: SampleCount;
    }
  | { readonly kind: 'zoom-range'; readonly range: BoundaryRange }
  | { readonly kind: 'razor'; readonly position: SampleCount }
  | {
      readonly kind: 'spectral-shape';
      readonly drawn: DrawnShape;
      /** The selection as the shape, let go now, would leave it. */
      readonly selection: SelectionSet;
    };

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
      /** The points a lasso or a brush has passed through, from the press. */
      readonly trail: Trail | undefined;
    };

/** A press in progress, with its tool and where it began. */
export type Pressed = Extract<Interaction, { kind: 'pressed' }>;

/** No press under way. */
export const IDLE: Interaction = { kind: 'idle' };

/** A step of an interaction: what it is now, what to draw, and what to do. */
export interface ToolStep {
  readonly interaction: Interaction;
  readonly preview: ToolPreview | undefined;
  readonly intents: readonly ToolIntent[];
}
