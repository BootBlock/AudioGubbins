/**
 * The dock's drop targets, drawn by AudioGubbins as the group each would make.
 *
 * Drawn on Lucide's 24-unit grid and to its rules, as node data of the same
 * shape as Lucide's own, so the vocabulary measures and draws them exactly as
 * it does the rest. Licensed under ISC like the set they join (ADR-0108), not
 * under the repository's Apache-2.0.
 *
 * Each is the group's outline, stroked like every glyph, and the part of the
 * group a dropped panel would take, filled. The fill is the part's own, not the
 * glyph's, because the outline around it must stay a stroke: a glyph filled as
 * play and pause are would fill the outline too. The part takes no stroke, which
 * keeps a clear gap between it and the outline at the set's stroke width; it
 * lies inside the outline, so the outline alone sets the ink the vocabulary
 * centres. The geometry is the design language's compass diagram's, and how
 * strongly the outline and the part show is left to the target's stylesheet,
 * which dims both at rest and shows both at full strength on the lit target.
 */

import type { LucideIconData, LucideIconNode } from 'lucide-react';

const GROUP_OUTLINE: LucideIconNode = [
  'rect',
  { x: '2.5', y: '2.5', width: '19', height: '19', rx: '3', key: 'group' },
];

function dropTarget(name: string, part: readonly LucideIconNode[]): LucideIconData {
  return { name, size: 24, node: [GROUP_OUTLINE, ...part] };
}

/** The part a dropped panel would take, filled with the glyph's colour and unstroked. */
function takenPart(x: string, y: string, width: string, height: string): LucideIconNode {
  return [
    'rect',
    { x, y, width, height, rx: '1.5', fill: 'currentColor', stroke: 'none', key: 'taken' },
  ];
}

/** Docked on the group's left, taking its left side. */
export const DOCK_LEFT = dropTarget('dock-left', [takenPart('4', '4', '7', '16')]);

/** Docked on the group's right, taking its right side. */
export const DOCK_RIGHT = dropTarget('dock-right', [takenPart('13', '4', '7', '16')]);

/** Docked above the group, taking its top. */
export const DOCK_TOP = dropTarget('dock-top', [takenPart('4', '4', '16', '7')]);

/** Docked below the group, taking its bottom. */
export const DOCK_BOTTOM = dropTarget('dock-bottom', [takenPart('4', '13', '16', '7')]);

/**
 * Joined to the group as a tab: the panel takes the whole group, under the tab
 * line that says it shares the group rather than splitting it.
 */
export const DOCK_CENTRE = dropTarget('dock-centre', [
  ['path', { d: 'M4 5.5h5', key: 'tab' }],
  takenPart('4', '7.5', '16', '12.5'),
]);
