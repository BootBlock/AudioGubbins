/**
 * The shell's icons: windows, panels, lists, the dock's drop targets and
 * states. Part of the icon vocabulary (`vocabulary.ts`), which joins the parts
 * into one map whose keys are the names a feature may use.
 */

import { __iconData as appWindowGlyph } from 'lucide-react/dist/esm/icons/app-window.mjs';
import { __iconData as arrowRightGlyph } from 'lucide-react/dist/esm/icons/arrow-right.mjs';
import { __iconData as arrowUpGlyph } from 'lucide-react/dist/esm/icons/arrow-up.mjs';
import { __iconData as arrowUpRightGlyph } from 'lucide-react/dist/esm/icons/arrow-up-right.mjs';
import { __iconData as banGlyph } from 'lucide-react/dist/esm/icons/ban.mjs';
import { __iconData as checkGlyph } from 'lucide-react/dist/esm/icons/check.mjs';
import { __iconData as chevronDownGlyph } from 'lucide-react/dist/esm/icons/chevron-down.mjs';
import { __iconData as chevronRightGlyph } from 'lucide-react/dist/esm/icons/chevron-right.mjs';
import { __iconData as chevronUpGlyph } from 'lucide-react/dist/esm/icons/chevron-up.mjs';
import { __iconData as chevronsDownGlyph } from 'lucide-react/dist/esm/icons/chevrons-down.mjs';
import { __iconData as circleAlertGlyph } from 'lucide-react/dist/esm/icons/circle-alert.mjs';
import { __iconData as circleCheckGlyph } from 'lucide-react/dist/esm/icons/circle-check.mjs';
import { __iconData as circleDashedGlyph } from 'lucide-react/dist/esm/icons/circle-dashed.mjs';
import { __iconData as circleXGlyph } from 'lucide-react/dist/esm/icons/circle-x.mjs';
import { __iconData as ellipsisGlyph } from 'lucide-react/dist/esm/icons/ellipsis.mjs';
import { __iconData as gripVerticalGlyph } from 'lucide-react/dist/esm/icons/grip-vertical.mjs';
import { __iconData as infoGlyph } from 'lucide-react/dist/esm/icons/info.mjs';
import { __iconData as layoutPanelLeftGlyph } from 'lucide-react/dist/esm/icons/layout-panel-left.mjs';
import { __iconData as lifeBuoyGlyph } from 'lucide-react/dist/esm/icons/life-buoy.mjs';
import { __iconData as lockGlyph } from 'lucide-react/dist/esm/icons/lock.mjs';
import { __iconData as maximizeGlyph } from 'lucide-react/dist/esm/icons/maximize.mjs';
import { __iconData as menuGlyph } from 'lucide-react/dist/esm/icons/menu.mjs';
import { __iconData as minusGlyph } from 'lucide-react/dist/esm/icons/minus.mjs';
import { __iconData as moveHorizontalGlyph } from 'lucide-react/dist/esm/icons/move-horizontal.mjs';
import { __iconData as moveLeftGlyph } from 'lucide-react/dist/esm/icons/move-left.mjs';
import { __iconData as moveRightGlyph } from 'lucide-react/dist/esm/icons/move-right.mjs';
import { __iconData as pinGlyph } from 'lucide-react/dist/esm/icons/pin.mjs';
import { __iconData as radioGlyph } from 'lucide-react/dist/esm/icons/radio.mjs';
import { __iconData as shieldCheckGlyph } from 'lucide-react/dist/esm/icons/shield-check.mjs';
import { __iconData as triangleAlertGlyph } from 'lucide-react/dist/esm/icons/triangle-alert.mjs';
import { __iconData as xGlyph } from 'lucide-react/dist/esm/icons/x.mjs';

import { PANEL_FAILURE } from './custom-glyphs.js';
import { DOCK_BOTTOM, DOCK_CENTRE, DOCK_LEFT, DOCK_RIGHT, DOCK_TOP } from './dock-glyphs.js';
import { stroked } from './placed-glyph.js';

export const SHELL_ICONS = {
  // Windows, panels and lists
  close: stroked(xGlyph),
  cancel: stroked(xGlyph),
  remove: stroked(xGlyph),
  clear: stroked(xGlyph),
  more: stroked(ellipsisGlyph),
  hint: stroked(infoGlyph),
  information: stroked(infoGlyph),
  expand: stroked(chevronRightGlyph),
  collapse: stroked(chevronDownGlyph),
  submenu: stroked(chevronRightGlyph),
  'open-list': stroked(chevronDownGlyph),
  'close-list': stroked(chevronUpGlyph),
  'step-up': stroked(chevronUpGlyph),
  'step-down': stroked(chevronDownGlyph),
  'more-below': stroked(chevronsDownGlyph),
  'chain-next': stroked(chevronRightGlyph),
  'leads-to': stroked(arrowRightGlyph),
  'go-to': stroked(arrowUpRightGlyph),
  'drag-handle': stroked(gripVerticalGlyph),
  dock: stroked(pinGlyph),
  'full-screen': stroked(maximizeGlyph),
  'empty-panel': stroked(layoutPanelLeftGlyph),
  'open-view': stroked(appWindowGlyph),
  menus: stroked(menuGlyph),
  'too-narrow': stroked(moveHorizontalGlyph),
  'move-left': stroked(moveLeftGlyph),
  'move-right': stroked(moveRightGlyph),

  // The dock's drop targets, each drawn as the group it would make
  'dock-left': stroked(DOCK_LEFT),
  'dock-right': stroked(DOCK_RIGHT),
  'dock-top': stroked(DOCK_TOP),
  'dock-bottom': stroked(DOCK_BOTTOM),
  'dock-centre': stroked(DOCK_CENTRE),

  // States
  warning: stroked(triangleAlertGlyph),
  error: stroked(circleXGlyph),
  success: stroked(circleCheckGlyph),
  'check-passes': stroked(circleCheckGlyph),
  'check-warns': stroked(circleAlertGlyph),
  'check-fails': stroked(circleXGlyph),
  unavailable: stroked(circleAlertGlyph),
  'field-error': stroked(circleAlertGlyph),
  refused: stroked(banGlyph),
  waiting: stroked(circleDashedGlyph),
  'not-measured': stroked(circleDashedGlyph),
  skipped: stroked(minusGlyph),
  checked: stroked(checkGlyph),
  apply: stroked(checkGlyph),
  saved: stroked(checkGlyph),
  'not-saved': stroked(circleXGlyph),
  'read-only': stroked(lockGlyph),
  inherited: stroked(arrowUpGlyph),
  recovered: stroked(lifeBuoyGlyph),
  verified: stroked(shieldCheckGlyph),
  'diagnostic-mode': stroked(radioGlyph),
  'panel-failure': stroked(PANEL_FAILURE),
} as const;
