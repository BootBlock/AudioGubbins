/**
 * The icon vocabulary: every icon AudioGubbins draws, named in its own words.
 *
 * A feature names an icon by what it means here (`close`, `fade-in`,
 * `check-fails`), never by the glyph that draws it, so a glyph can be changed
 * in one place, and two meanings that share a glyph today can part tomorrow.
 * The names are this map's keys, so a name with no glyph is a type error rather
 * than a blank square at runtime. Each glyph is measured and placed as the map
 * is built, once, when the module loads.
 *
 * The geometry comes from Lucide's per-glyph modules, one static import each,
 * which keeps the bundle to the glyphs named here; the glyphs Lucide lacks
 * are drawn beside this module in the same node data. The knob, meter and
 * spectrogram glyphs are still to be drawn, and nothing stands in for them.
 */

import { __iconData as accessibilityGlyph } from 'lucide-react/dist/esm/icons/accessibility.mjs';
import { __iconData as activityGlyph } from 'lucide-react/dist/esm/icons/activity.mjs';
import { __iconData as alignCenterVerticalGlyph } from 'lucide-react/dist/esm/icons/align-center-vertical.mjs';
import { __iconData as appWindowGlyph } from 'lucide-react/dist/esm/icons/app-window.mjs';
import { __iconData as archiveGlyph } from 'lucide-react/dist/esm/icons/archive.mjs';
import { __iconData as archiveXGlyph } from 'lucide-react/dist/esm/icons/archive-x.mjs';
import { __iconData as arrowRightGlyph } from 'lucide-react/dist/esm/icons/arrow-right.mjs';
import { __iconData as arrowUpGlyph } from 'lucide-react/dist/esm/icons/arrow-up.mjs';
import { __iconData as arrowUpRightGlyph } from 'lucide-react/dist/esm/icons/arrow-up-right.mjs';
import { __iconData as audioLinesGlyph } from 'lucide-react/dist/esm/icons/audio-lines.mjs';
import { __iconData as audioWaveformGlyph } from 'lucide-react/dist/esm/icons/audio-waveform.mjs';
import { __iconData as banGlyph } from 'lucide-react/dist/esm/icons/ban.mjs';
import { __iconData as bandageGlyph } from 'lucide-react/dist/esm/icons/bandage.mjs';
import { __iconData as bookmarkGlyph } from 'lucide-react/dist/esm/icons/bookmark.mjs';
import { __iconData as bookmarkPlusGlyph } from 'lucide-react/dist/esm/icons/bookmark-plus.mjs';
import { __iconData as bracesGlyph } from 'lucide-react/dist/esm/icons/braces.mjs';
import { __iconData as bracketsGlyph } from 'lucide-react/dist/esm/icons/brackets.mjs';
import { __iconData as brainCircuitGlyph } from 'lucide-react/dist/esm/icons/brain-circuit.mjs';
import { __iconData as brushGlyph } from 'lucide-react/dist/esm/icons/brush.mjs';
import { __iconData as bugGlyph } from 'lucide-react/dist/esm/icons/bug.mjs';
import { __iconData as chartAreaGlyph } from 'lucide-react/dist/esm/icons/chart-area.mjs';
import { __iconData as chartSplineGlyph } from 'lucide-react/dist/esm/icons/chart-spline.mjs';
import { __iconData as checkGlyph } from 'lucide-react/dist/esm/icons/check.mjs';
import { __iconData as chevronDownGlyph } from 'lucide-react/dist/esm/icons/chevron-down.mjs';
import { __iconData as chevronRightGlyph } from 'lucide-react/dist/esm/icons/chevron-right.mjs';
import { __iconData as chevronUpGlyph } from 'lucide-react/dist/esm/icons/chevron-up.mjs';
import { __iconData as chevronsDownGlyph } from 'lucide-react/dist/esm/icons/chevrons-down.mjs';
import { __iconData as chevronsUpGlyph } from 'lucide-react/dist/esm/icons/chevrons-up.mjs';
import { __iconData as circleAlertGlyph } from 'lucide-react/dist/esm/icons/circle-alert.mjs';
import { __iconData as circleCheckGlyph } from 'lucide-react/dist/esm/icons/circle-check.mjs';
import { __iconData as circleDashedGlyph } from 'lucide-react/dist/esm/icons/circle-dashed.mjs';
import { __iconData as circlePlayGlyph } from 'lucide-react/dist/esm/icons/circle-play.mjs';
import { __iconData as circleXGlyph } from 'lucide-react/dist/esm/icons/circle-x.mjs';
import { __iconData as clapperboardGlyph } from 'lucide-react/dist/esm/icons/clapperboard.mjs';
import { __iconData as clipboardPasteGlyph } from 'lucide-react/dist/esm/icons/clipboard-paste.mjs';
import { __iconData as clockGlyph } from 'lucide-react/dist/esm/icons/clock.mjs';
import { __iconData as copyGlyph } from 'lucide-react/dist/esm/icons/copy.mjs';
import { __iconData as cpuGlyph } from 'lucide-react/dist/esm/icons/cpu.mjs';
import { __iconData as cropGlyph } from 'lucide-react/dist/esm/icons/crop.mjs';
import { __iconData as crosshairGlyph } from 'lucide-react/dist/esm/icons/crosshair.mjs';
import { __iconData as databaseGlyph } from 'lucide-react/dist/esm/icons/database.mjs';
import { __iconData as dicesGlyph } from 'lucide-react/dist/esm/icons/dices.mjs';
import { __iconData as doorClosedGlyph } from 'lucide-react/dist/esm/icons/door-closed.mjs';
import { __iconData as downloadGlyph } from 'lucide-react/dist/esm/icons/download.mjs';
import { __iconData as ellipsisGlyph } from 'lucide-react/dist/esm/icons/ellipsis.mjs';
import { __iconData as eraserGlyph } from 'lucide-react/dist/esm/icons/eraser.mjs';
import { __iconData as eyeOffGlyph } from 'lucide-react/dist/esm/icons/eye-off.mjs';
import { __iconData as fileCheckCornerGlyph } from 'lucide-react/dist/esm/icons/file-check-corner.mjs';
import { __iconData as fileDiffGlyph } from 'lucide-react/dist/esm/icons/file-diff.mjs';
import { __iconData as fileExclamationPointGlyph } from 'lucide-react/dist/esm/icons/file-exclamation-point.mjs';
import { __iconData as fileHeadphoneGlyph } from 'lucide-react/dist/esm/icons/file-headphone.mjs';
import { __iconData as fileHeartGlyph } from 'lucide-react/dist/esm/icons/file-heart.mjs';
import { __iconData as filePlusCornerGlyph } from 'lucide-react/dist/esm/icons/file-plus-corner.mjs';
import { __iconData as fileSymlinkGlyph } from 'lucide-react/dist/esm/icons/file-symlink.mjs';
import { __iconData as fileXCornerGlyph } from 'lucide-react/dist/esm/icons/file-x-corner.mjs';
import { __iconData as filesGlyph } from 'lucide-react/dist/esm/icons/files.mjs';
import { __iconData as filmGlyph } from 'lucide-react/dist/esm/icons/film.mjs';
import { __iconData as foldHorizontalGlyph } from 'lucide-react/dist/esm/icons/fold-horizontal.mjs';
import { __iconData as foldVerticalGlyph } from 'lucide-react/dist/esm/icons/fold-vertical.mjs';
import { __iconData as folderGlyph } from 'lucide-react/dist/esm/icons/folder.mjs';
import { __iconData as folderDownGlyph } from 'lucide-react/dist/esm/icons/folder-down.mjs';
import { __iconData as folderInputGlyph } from 'lucide-react/dist/esm/icons/folder-input.mjs';
import { __iconData as folderOpenGlyph } from 'lucide-react/dist/esm/icons/folder-open.mjs';
import { __iconData as folderPlusGlyph } from 'lucide-react/dist/esm/icons/folder-plus.mjs';
import { __iconData as folderTreeGlyph } from 'lucide-react/dist/esm/icons/folder-tree.mjs';
import { __iconData as folderXGlyph } from 'lucide-react/dist/esm/icons/folder-x.mjs';
import { __iconData as funnelGlyph } from 'lucide-react/dist/esm/icons/funnel.mjs';
import { __iconData as gamepad2Glyph } from 'lucide-react/dist/esm/icons/gamepad-2.mjs';
import { __iconData as gaugeGlyph } from 'lucide-react/dist/esm/icons/gauge.mjs';
import { __iconData as gitBranchGlyph } from 'lucide-react/dist/esm/icons/git-branch.mjs';
import { __iconData as gitCompareGlyph } from 'lucide-react/dist/esm/icons/git-compare.mjs';
import { __iconData as gitForkGlyph } from 'lucide-react/dist/esm/icons/git-fork.mjs';
import { __iconData as gripVerticalGlyph } from 'lucide-react/dist/esm/icons/grip-vertical.mjs';
import { __iconData as handGlyph } from 'lucide-react/dist/esm/icons/hand.mjs';
import { __iconData as hardDriveGlyph } from 'lucide-react/dist/esm/icons/hard-drive.mjs';
import { __iconData as headphonesGlyph } from 'lucide-react/dist/esm/icons/headphones.mjs';
import { __iconData as infoGlyph } from 'lucide-react/dist/esm/icons/info.mjs';
import { __iconData as keyRoundGlyph } from 'lucide-react/dist/esm/icons/key-round.mjs';
import { __iconData as keyboardGlyph } from 'lucide-react/dist/esm/icons/keyboard.mjs';
import { __iconData as lassoGlyph } from 'lucide-react/dist/esm/icons/lasso.mjs';
import { __iconData as layersGlyph } from 'lucide-react/dist/esm/icons/layers.mjs';
import { __iconData as layers2Glyph } from 'lucide-react/dist/esm/icons/layers-2.mjs';
import { __iconData as layoutDashboardGlyph } from 'lucide-react/dist/esm/icons/layout-dashboard.mjs';
import { __iconData as layoutPanelLeftGlyph } from 'lucide-react/dist/esm/icons/layout-panel-left.mjs';
import { __iconData as libraryGlyph } from 'lucide-react/dist/esm/icons/library.mjs';
import { __iconData as lifeBuoyGlyph } from 'lucide-react/dist/esm/icons/life-buoy.mjs';
import { __iconData as linkGlyph } from 'lucide-react/dist/esm/icons/link.mjs';
import { __iconData as link2OffGlyph } from 'lucide-react/dist/esm/icons/link-2-off.mjs';
import { __iconData as lockGlyph } from 'lucide-react/dist/esm/icons/lock.mjs';
import { __iconData as lockKeyholeGlyph } from 'lucide-react/dist/esm/icons/lock-keyhole.mjs';
import { __iconData as magnetGlyph } from 'lucide-react/dist/esm/icons/magnet.mjs';
import { __iconData as mapPinGlyph } from 'lucide-react/dist/esm/icons/map-pin.mjs';
import { __iconData as mapPinPlusGlyph } from 'lucide-react/dist/esm/icons/map-pin-plus.mjs';
import { __iconData as mapPinXGlyph } from 'lucide-react/dist/esm/icons/map-pin-x.mjs';
import { __iconData as maximizeGlyph } from 'lucide-react/dist/esm/icons/maximize.mjs';
import { __iconData as maximize2Glyph } from 'lucide-react/dist/esm/icons/maximize-2.mjs';
import { __iconData as menuGlyph } from 'lucide-react/dist/esm/icons/menu.mjs';
import { __iconData as messageSquareGlyph } from 'lucide-react/dist/esm/icons/message-square.mjs';
import { __iconData as micGlyph } from 'lucide-react/dist/esm/icons/mic.mjs';
import { __iconData as micOffGlyph } from 'lucide-react/dist/esm/icons/mic-off.mjs';
import { __iconData as minusGlyph } from 'lucide-react/dist/esm/icons/minus.mjs';
import { __iconData as monitorGlyph } from 'lucide-react/dist/esm/icons/monitor.mjs';
import { __iconData as mousePointer2Glyph } from 'lucide-react/dist/esm/icons/mouse-pointer-2.mjs';
import { __iconData as mousePointerClickGlyph } from 'lucide-react/dist/esm/icons/mouse-pointer-click.mjs';
import { __iconData as moveHorizontalGlyph } from 'lucide-react/dist/esm/icons/move-horizontal.mjs';
import { __iconData as moveLeftGlyph } from 'lucide-react/dist/esm/icons/move-left.mjs';
import { __iconData as moveRightGlyph } from 'lucide-react/dist/esm/icons/move-right.mjs';
import { __iconData as moveVerticalGlyph } from 'lucide-react/dist/esm/icons/move-vertical.mjs';
import { __iconData as packageGlyph } from 'lucide-react/dist/esm/icons/package.mjs';
import { __iconData as paletteGlyph } from 'lucide-react/dist/esm/icons/palette.mjs';
import { __iconData as pauseGlyph } from 'lucide-react/dist/esm/icons/pause.mjs';
import { __iconData as penToolGlyph } from 'lucide-react/dist/esm/icons/pen-tool.mjs';
import { __iconData as pencilGlyph } from 'lucide-react/dist/esm/icons/pencil.mjs';
import { __iconData as pinGlyph } from 'lucide-react/dist/esm/icons/pin.mjs';
import { __iconData as playGlyph } from 'lucide-react/dist/esm/icons/play.mjs';
import { __iconData as plugZapGlyph } from 'lucide-react/dist/esm/icons/plug-zap.mjs';
import { __iconData as plusGlyph } from 'lucide-react/dist/esm/icons/plus.mjs';
import { __iconData as powerGlyph } from 'lucide-react/dist/esm/icons/power.mjs';
import { __iconData as radioGlyph } from 'lucide-react/dist/esm/icons/radio.mjs';
import { __iconData as rectangleHorizontalGlyph } from 'lucide-react/dist/esm/icons/rectangle-horizontal.mjs';
import { __iconData as redo2Glyph } from 'lucide-react/dist/esm/icons/redo-2.mjs';
import { __iconData as refreshCwGlyph } from 'lucide-react/dist/esm/icons/refresh-cw.mjs';
import { __iconData as repeatGlyph } from 'lucide-react/dist/esm/icons/repeat.mjs';
import { __iconData as rotateCcwGlyph } from 'lucide-react/dist/esm/icons/rotate-ccw.mjs';
import { __iconData as rotateCcwClockGlyph } from 'lucide-react/dist/esm/icons/rotate-ccw-clock.mjs';
import { __iconData as rows2Glyph } from 'lucide-react/dist/esm/icons/rows-2.mjs';
import { __iconData as rows3Glyph } from 'lucide-react/dist/esm/icons/rows-3.mjs';
import { __iconData as scaleGlyph } from 'lucide-react/dist/esm/icons/scale.mjs';
import { __iconData as scanGlyph } from 'lucide-react/dist/esm/icons/scan.mjs';
import { __iconData as scanSearchGlyph } from 'lucide-react/dist/esm/icons/scan-search.mjs';
import { __iconData as scissorsGlyph } from 'lucide-react/dist/esm/icons/scissors.mjs';
import { __iconData as scissorsLineDashedGlyph } from 'lucide-react/dist/esm/icons/scissors-line-dashed.mjs';
import { __iconData as searchGlyph } from 'lucide-react/dist/esm/icons/search.mjs';
import { __iconData as settingsGlyph } from 'lucide-react/dist/esm/icons/settings.mjs';
import { __iconData as shareGlyph } from 'lucide-react/dist/esm/icons/share.mjs';
import { __iconData as shieldGlyph } from 'lucide-react/dist/esm/icons/shield.mjs';
import { __iconData as shieldCheckGlyph } from 'lucide-react/dist/esm/icons/shield-check.mjs';
import { __iconData as skipBackGlyph } from 'lucide-react/dist/esm/icons/skip-back.mjs';
import { __iconData as slidersHorizontalGlyph } from 'lucide-react/dist/esm/icons/sliders-horizontal.mjs';
import { __iconData as sparklesGlyph } from 'lucide-react/dist/esm/icons/sparkles.mjs';
import { __iconData as splineGlyph } from 'lucide-react/dist/esm/icons/spline.mjs';
import { __iconData as splitGlyph } from 'lucide-react/dist/esm/icons/split.mjs';
import { __iconData as squareGlyph } from 'lucide-react/dist/esm/icons/square.mjs';
import { __iconData as squareDashedGlyph } from 'lucide-react/dist/esm/icons/square-dashed.mjs';
import { __iconData as squareDashedTextGlyph } from 'lucide-react/dist/esm/icons/square-dashed-text.mjs';
import { __iconData as squareMinusGlyph } from 'lucide-react/dist/esm/icons/square-minus.mjs';
import { __iconData as squarePlusGlyph } from 'lucide-react/dist/esm/icons/square-plus.mjs';
import { __iconData as stepBackGlyph } from 'lucide-react/dist/esm/icons/step-back.mjs';
import { __iconData as stepForwardGlyph } from 'lucide-react/dist/esm/icons/step-forward.mjs';
import { __iconData as sunGlyph } from 'lucide-react/dist/esm/icons/sun.mjs';
import { __iconData as sunDimGlyph } from 'lucide-react/dist/esm/icons/sun-dim.mjs';
import { __iconData as tagsGlyph } from 'lucide-react/dist/esm/icons/tags.mjs';
import { __iconData as textCursorInputGlyph } from 'lucide-react/dist/esm/icons/text-cursor-input.mjs';
import { __iconData as timerGlyph } from 'lucide-react/dist/esm/icons/timer.mjs';
import { __iconData as trashGlyph } from 'lucide-react/dist/esm/icons/trash.mjs';
import { __iconData as triangleAlertGlyph } from 'lucide-react/dist/esm/icons/triangle-alert.mjs';
import { __iconData as trianglesCenterlineDashedHorizontalGlyph } from 'lucide-react/dist/esm/icons/triangles-centerline-dashed-horizontal.mjs';
import { __iconData as trianglesCenterlineDashedVerticalGlyph } from 'lucide-react/dist/esm/icons/triangles-centerline-dashed-vertical.mjs';
import { __iconData as undo2Glyph } from 'lucide-react/dist/esm/icons/undo-2.mjs';
import { __iconData as unfoldHorizontalGlyph } from 'lucide-react/dist/esm/icons/unfold-horizontal.mjs';
import { __iconData as uploadGlyph } from 'lucide-react/dist/esm/icons/upload.mjs';
import { __iconData as volume1Glyph } from 'lucide-react/dist/esm/icons/volume-1.mjs';
import { __iconData as volume2Glyph } from 'lucide-react/dist/esm/icons/volume-2.mjs';
import { __iconData as volumeXGlyph } from 'lucide-react/dist/esm/icons/volume-x.mjs';
import { __iconData as wrenchGlyph } from 'lucide-react/dist/esm/icons/wrench.mjs';
import { __iconData as xGlyph } from 'lucide-react/dist/esm/icons/x.mjs';
import { __iconData as zapGlyph } from 'lucide-react/dist/esm/icons/zap.mjs';
import { __iconData as zoomInGlyph } from 'lucide-react/dist/esm/icons/zoom-in.mjs';
import { __iconData as zoomOutGlyph } from 'lucide-react/dist/esm/icons/zoom-out.mjs';

import { CHANNELS, PANEL_FAILURE, SAMPLE_RATE } from './custom-glyphs.js';
import { DOCK_BOTTOM, DOCK_CENTRE, DOCK_LEFT, DOCK_RIGHT, DOCK_TOP } from './dock-glyphs.js';
import {
  EQUAL_POWER_FADE,
  FADE_IN,
  FADE_OUT,
  LINEAR_FADE,
  S_CURVE_FADE,
  SQUARE_FADE,
} from './fade-glyphs.js';
import {
  BAND_PASS_BAND,
  BELL_BAND,
  HIGH_CUT_BAND,
  HIGH_SHELF_BAND,
  LOW_CUT_BAND,
  LOW_SHELF_BAND,
  NOTCH_BAND,
} from './filter-band-glyphs.js';
import { filled, stroked, type PlacedGlyph } from './placed-glyph.js';

const VOCABULARY = {
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

  // Transport and listening
  play: filled(playGlyph),
  pause: filled(pauseGlyph),
  stop: stroked(squareGlyph),
  'to-start': stroked(skipBackGlyph),
  loop: stroked(repeatGlyph),
  transport: stroked(circlePlayGlyph),
  audition: stroked(playGlyph),
  'audition-crossfade': stroked(audioLinesGlyph),
  'heard-side': stroked(volume2Glyph),
  'test-signal': stroked(audioWaveformGlyph),
  monitoring: stroked(headphonesGlyph),
  solo: stroked(headphonesGlyph),
  'frame-earlier': stroked(stepBackGlyph),
  'frame-later': stroked(stepForwardGlyph),
  'line-up-with-playhead': stroked(alignCenterVerticalGlyph),
  'follow-editor': stroked(linkGlyph),
  power: stroked(powerGlyph),

  // Recording
  recorder: stroked(micGlyph),
  armed: stroked(plugZapGlyph),
  'pre-record': stroked(rotateCcwClockGlyph),
  'punch-in': stroked(scissorsLineDashedGlyph),
  'record-again': stroked(rotateCcwGlyph),
  'interrupted-recording': stroked(micOffGlyph),

  // Editing
  undo: stroked(undo2Glyph),
  redo: stroked(redo2Glyph),
  cut: stroked(scissorsGlyph),
  copy: stroked(copyGlyph),
  paste: stroked(clipboardPasteGlyph),
  delete: stroked(trashGlyph),
  trim: stroked(cropGlyph),
  split: stroked(splitGlyph),
  'fade-in': stroked(FADE_IN),
  'fade-out': stroked(FADE_OUT),
  'linear-fade': stroked(LINEAR_FADE),
  'equal-power-fade': stroked(EQUAL_POWER_FADE),
  's-curve-fade': stroked(S_CURVE_FADE),
  'square-fade': stroked(SQUARE_FADE),
  reverse: stroked(trianglesCenterlineDashedVerticalGlyph),
  invert: stroked(trianglesCenterlineDashedHorizontalGlyph),
  stretch: stroked(unfoldHorizontalGlyph),
  louder: stroked(volume2Glyph),
  quieter: stroked(volume1Glyph),
  silence: stroked(volumeXGlyph),
  'select-all': stroked(squareDashedTextGlyph),
  'select-nothing': stroked(squareDashedGlyph),
  add: stroked(plusGlyph),
  name: stroked(textCursorInputGlyph),
  change: stroked(pencilGlyph),
  'insert-token': stroked(bracesGlyph),

  // Tools and the view
  'selection-tool': stroked(mousePointer2Glyph),
  'hand-tool': stroked(handGlyph),
  'time-selection': stroked(textCursorInputGlyph),
  razor: stroked(scissorsGlyph),
  zoom: stroked(zoomInGlyph),
  'zoom-in': stroked(zoomInGlyph),
  'zoom-out': stroked(zoomOutGlyph),
  'zoom-to-fit': stroked(maximize2Glyph),
  'zoom-to-selection': stroked(scanGlyph),
  snap: stroked(magnetGlyph),
  marker: stroked(mapPinGlyph),
  'add-marker': stroked(mapPinPlusGlyph),
  'remove-markers': stroked(mapPinXGlyph),
  region: stroked(bracketsGlyph),
  locate: stroked(crosshairGlyph),
  waveform: stroked(audioWaveformGlyph),
  spectrogram: stroked(chartSplineGlyph),
  'waveform-above-spectrogram': stroked(rows2Glyph),
  'waveform-over-spectrogram': stroked(layers2Glyph),
  'time-format': stroked(clockGlyph),
  'frame-rate': stroked(clapperboardGlyph),
  'sample-rate': stroked(SAMPLE_RATE),
  channels: stroked(CHANNELS),

  // Spectral editing
  spectral: stroked(chartAreaGlyph),
  'spectral-brush': stroked(brushGlyph),
  'spectral-lasso': stroked(lassoGlyph),
  'spectral-marquee': stroked(squareDashedGlyph),
  'select-band': stroked(rectangleHorizontalGlyph),
  'add-to-selection': stroked(squarePlusGlyph),
  'take-from-selection': stroked(squareMinusGlyph),
  'replace-selection': stroked(squareGlyph),
  'narrow-in-time': stroked(foldHorizontalGlyph),
  'narrow-band': stroked(foldVerticalGlyph),
  'widen-in-time': stroked(moveHorizontalGlyph),
  'widen-band': stroked(moveVerticalGlyph),
  'spectral-remove': stroked(eraserGlyph),
  'spectral-heal': stroked(bandageGlyph),

  // Panels and places
  application: stroked(audioWaveformGlyph),
  asset: stroked(audioLinesGlyph),
  assets: stroked(layersGlyph),
  inspector: stroked(slidersHorizontalGlyph),
  history: stroked(rotateCcwClockGlyph),
  'effects-rack': stroked(splineGlyph),
  analysis: stroked(activityGlyph),
  library: stroked(libraryGlyph),
  picture: stroked(filmGlyph),
  diagnostics: stroked(bugGlyph),
  capabilities: stroked(cpuGlyph),
  'model-packs': stroked(brainCircuitGlyph),
  'asset-groups': stroked(folderTreeGlyph),
  'game-preview': stroked(gamepad2Glyph),
  storage: stroked(hardDriveGlyph),
  latency: stroked(timerGlyph),
  classification: stroked(tagsGlyph),
  repair: stroked(wrenchGlyph),
  search: stroked(searchGlyph),
  commands: stroked(searchGlyph),
  settings: stroked(settingsGlyph),
  workspace: stroked(layoutDashboardGlyph),
  appearance: stroked(paletteGlyph),
  accessibility: stroked(accessibilityGlyph),
  'pen-and-touch': stroked(penToolGlyph),
  shortcuts: stroked(keyboardGlyph),
  density: stroked(rows3Glyph),

  // Analysis and processing
  analyse: stroked(scanSearchGlyph),
  'analyse-again': stroked(refreshCwGlyph),
  reload: stroked(refreshCwGlyph),
  'clean-up': stroked(sparklesGlyph),
  enhance: stroked(sparklesGlyph),
  compare: stroked(gitCompareGlyph),
  'return-to-state': stroked(undo2Glyph),
  fork: stroked(gitForkGlyph),
  branch: stroked(gitBranchGlyph),
  'show-only': stroked(funnelGlyph),
  preset: stroked(bookmarkGlyph),
  snapshot: stroked(bookmarkGlyph),
  'save-preset': stroked(bookmarkPlusGlyph),
  'take-snapshot': stroked(bookmarkPlusGlyph),
  'saved-chain': stroked(linkGlyph),
  'new-seed': stroked(dicesGlyph),
  'stress-test': stroked(zapGlyph),
  'measure-loudness': stroked(gaugeGlyph),
  'processing-load': stroked(gaugeGlyph),
  gain: stroked(volume2Glyph),
  'peak-normalisation': stroked(activityGlyph),
  'loudness-normalisation': stroked(chevronsUpGlyph),
  equaliser: stroked(audioLinesGlyph),
  filter: stroked(funnelGlyph),
  bell: stroked(BELL_BAND),
  'low-shelf': stroked(LOW_SHELF_BAND),
  'high-shelf': stroked(HIGH_SHELF_BAND),
  'low-cut': stroked(LOW_CUT_BAND),
  'high-cut': stroked(HIGH_CUT_BAND),
  notch: stroked(NOTCH_BAND),
  'band-pass': stroked(BAND_PASS_BAND),
  compressor: stroked(gaugeGlyph),
  limiter: stroked(shieldGlyph),
  gate: stroked(doorClosedGlyph),
  expander: stroked(moveVerticalGlyph),
  'de-esser': stroked(audioWaveformGlyph),
  'real-time': stroked(zapGlyph),
  'low-latency': stroked(zapGlyph),
  balanced: stroked(scaleGlyph),
  'maximum-stability': stroked(shieldCheckGlyph),
  'custom-profile': stroked(slidersHorizontalGlyph),
  'follow-system': stroked(monitorGlyph),
  dimmer: stroked(sunDimGlyph),
  brighter: stroked(sunGlyph),

  // Workflows and built-in chains
  'prepare-one-shot': stroked(cropGlyph),
  normalise: stroked(gaugeGlyph),
  'seamless-loop': stroked(repeatGlyph),
  'clean-dialogue': stroked(messageSquareGlyph),
  'export-for-godot': stroked(gamepad2Glyph),
  'cut-into-sounds': stroked(scissorsGlyph),
  'game-sound': stroked(gamepad2Glyph),
  'interface-sound': stroked(mousePointerClickGlyph),
  dialogue: stroked(messageSquareGlyph),
  'impact-sound': stroked(activityGlyph),

  // Projects, files and storage
  projects: stroked(folderGlyph),
  project: stroked(folderGlyph),
  group: stroked(folderGlyph),
  'new-project': stroked(folderPlusGlyph),
  'new-group': stroked(folderPlusGlyph),
  'open-project': stroked(folderOpenGlyph),
  'open-file': stroked(folderOpenGlyph),
  'open-folder': stroked(folderOpenGlyph),
  'keep-in-project': stroked(folderDownGlyph),
  audio: stroked(audioLinesGlyph),
  request: stroked(handGlyph),
  'audio-file': stroked(fileHeadphoneGlyph),
  'import-audio': stroked(filePlusCornerGlyph),
  'import-folder': stroked(folderInputGlyph),
  import: stroked(uploadGlyph),
  'save-file': stroked(downloadGlyph),
  export: stroked(shareGlyph),
  'export-plan': stroked(packageGlyph),
  'manage-packs': stroked(packageGlyph),
  backups: stroked(archiveGlyph),
  'backup-not-made': stroked(archiveXGlyph),
  'stored-projects': stroked(databaseGlyph),
  'export-summary': stroked(fileCheckCornerGlyph),
  'file-exists': stroked(filesGlyph),
  'folder-taken': stroked(folderXGlyph),
  'unreadable-project': stroked(fileExclamationPointGlyph),
  'missing-file': stroked(fileXCornerGlyph),
  'changed-file': stroked(fileDiffGlyph),
  'replaced-file': stroked(fileSymlinkGlyph),
  'linked-files-changed': stroked(link2OffGlyph),
  'needs-access': stroked(lockKeyholeGlyph),
  'give-access': stroked(keyRoundGlyph),
  'diagnostic-report': stroked(fileHeartGlyph),
  'removed-from-report': stroked(eyeOffGlyph),
  reset: stroked(rotateCcwGlyph),
  'try-again': stroked(rotateCcwGlyph),
} as const;

/** The name of an icon AudioGubbins draws. */
export type IconName = keyof typeof VOCABULARY;

/** Every icon's glyph, measured and placed. */
export const ICON_GLYPHS: Readonly<Record<IconName, PlacedGlyph>> = VOCABULARY;
