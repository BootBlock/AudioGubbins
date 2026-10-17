/**
 * Single glyphs Lucide lacks, drawn by AudioGubbins. A family of them (the
 * fades, a filter's bands, the dock's drop targets) has a module of its own.
 *
 * Drawn on Lucide's 24-unit grid and to its rules: stroked shapes at the set's
 * one stroke with round caps and joins, inside the 2-unit margin, as node data
 * of the same shape as Lucide's own, so the vocabulary measures and draws them
 * exactly as it does the rest. Licensed under ISC like the set they join
 * (ADR-0108), not under the repository's Apache-2.0.
 */

import type { LucideIconData } from 'lucide-react';

/**
 * A panel that failed: a panel's frame and title bar, Lucide's window, with
 * the set's alert mark where its content would be, because what failed is the
 * one panel and not the application around it.
 */
export const PANEL_FAILURE: LucideIconData = {
  name: 'panel-failure',
  size: 24,
  node: [
    ['rect', { x: '2', y: '4', width: '20', height: '16', rx: '2', key: 'frame' }],
    ['path', { d: 'M2 8h20', key: 'title-bar' }],
    ['path', { d: 'M12 11v3', key: 'alert' }],
    ['path', { d: 'M12 17h.01', key: 'alert-point' }],
  ],
};

/**
 * Sample rate: a wave taken at evenly spaced instants, one stem and head per
 * sample, as a sampling diagram draws it. The heads are small rings, which the
 * set's stroke all but closes into dots, because Lucide's `h.01` point would be
 * lost behind its stem's round cap. The samples at the wave's
 * zero crossings have no stem to draw, only their head on the axis.
 */
export const SAMPLE_RATE: LucideIconData = {
  name: 'sample-rate',
  size: 24,
  node: [
    ['path', { d: 'M4 12V7.5', key: 'first-stem' }],
    ['circle', { cx: '4', cy: '6', r: '1.5', key: 'first' }],
    ['circle', { cx: '8', cy: '12', r: '1.5', key: 'second' }],
    ['path', { d: 'M12 12v4.5', key: 'third-stem' }],
    ['circle', { cx: '12', cy: '18', r: '1.5', key: 'third' }],
    ['circle', { cx: '16', cy: '12', r: '1.5', key: 'fourth' }],
    ['path', { d: 'M20 12V7.5', key: 'fifth-stem' }],
    ['circle', { cx: '20', cy: '6', r: '1.5', key: 'fifth' }],
  ],
};

/**
 * Channels: two signals one above the other, as the editor stacks a recording's
 * channels, rather than a speaker, which would read as level or as listening.
 */
export const CHANNELS: LucideIconData = {
  name: 'channels',
  size: 24,
  node: [
    ['path', { d: 'M3 8c2-4 4-4 6 0s4 4 6 0s4-4 6 0', key: 'upper' }],
    ['path', { d: 'M3 16c2-4 4-4 6 0s4 4 6 0s4-4 6 0', key: 'lower' }],
  ],
};
