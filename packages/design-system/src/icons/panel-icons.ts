/**
 * The icons of the panels and places, analysis and processing. Part of the icon vocabulary (`vocabulary.ts`), which joins the parts
 * into one map whose keys are the names a feature may use.
 */

import { __iconData as accessibilityGlyph } from 'lucide-react/dist/esm/icons/accessibility.mjs';
import { __iconData as activityGlyph } from 'lucide-react/dist/esm/icons/activity.mjs';
import { __iconData as audioLinesGlyph } from 'lucide-react/dist/esm/icons/audio-lines.mjs';
import { __iconData as audioWaveformGlyph } from 'lucide-react/dist/esm/icons/audio-waveform.mjs';
import { __iconData as bookmarkGlyph } from 'lucide-react/dist/esm/icons/bookmark.mjs';
import { __iconData as bookmarkPlusGlyph } from 'lucide-react/dist/esm/icons/bookmark-plus.mjs';
import { __iconData as brainCircuitGlyph } from 'lucide-react/dist/esm/icons/brain-circuit.mjs';
import { __iconData as bugGlyph } from 'lucide-react/dist/esm/icons/bug.mjs';
import { __iconData as chevronsUpGlyph } from 'lucide-react/dist/esm/icons/chevrons-up.mjs';
import { __iconData as cpuGlyph } from 'lucide-react/dist/esm/icons/cpu.mjs';
import { __iconData as dicesGlyph } from 'lucide-react/dist/esm/icons/dices.mjs';
import { __iconData as doorClosedGlyph } from 'lucide-react/dist/esm/icons/door-closed.mjs';
import { __iconData as filmGlyph } from 'lucide-react/dist/esm/icons/film.mjs';
import { __iconData as folderTreeGlyph } from 'lucide-react/dist/esm/icons/folder-tree.mjs';
import { __iconData as funnelGlyph } from 'lucide-react/dist/esm/icons/funnel.mjs';
import { __iconData as gamepad2Glyph } from 'lucide-react/dist/esm/icons/gamepad-2.mjs';
import { __iconData as gaugeGlyph } from 'lucide-react/dist/esm/icons/gauge.mjs';
import { __iconData as gitBranchGlyph } from 'lucide-react/dist/esm/icons/git-branch.mjs';
import { __iconData as gitCompareGlyph } from 'lucide-react/dist/esm/icons/git-compare.mjs';
import { __iconData as gitForkGlyph } from 'lucide-react/dist/esm/icons/git-fork.mjs';
import { __iconData as hardDriveGlyph } from 'lucide-react/dist/esm/icons/hard-drive.mjs';
import { __iconData as keyboardGlyph } from 'lucide-react/dist/esm/icons/keyboard.mjs';
import { __iconData as layersGlyph } from 'lucide-react/dist/esm/icons/layers.mjs';
import { __iconData as layoutDashboardGlyph } from 'lucide-react/dist/esm/icons/layout-dashboard.mjs';
import { __iconData as libraryGlyph } from 'lucide-react/dist/esm/icons/library.mjs';
import { __iconData as linkGlyph } from 'lucide-react/dist/esm/icons/link.mjs';
import { __iconData as monitorGlyph } from 'lucide-react/dist/esm/icons/monitor.mjs';
import { __iconData as moveVerticalGlyph } from 'lucide-react/dist/esm/icons/move-vertical.mjs';
import { __iconData as paletteGlyph } from 'lucide-react/dist/esm/icons/palette.mjs';
import { __iconData as penToolGlyph } from 'lucide-react/dist/esm/icons/pen-tool.mjs';
import { __iconData as refreshCwGlyph } from 'lucide-react/dist/esm/icons/refresh-cw.mjs';
import { __iconData as rotateCcwClockGlyph } from 'lucide-react/dist/esm/icons/rotate-ccw-clock.mjs';
import { __iconData as rows3Glyph } from 'lucide-react/dist/esm/icons/rows-3.mjs';
import { __iconData as scaleGlyph } from 'lucide-react/dist/esm/icons/scale.mjs';
import { __iconData as scanSearchGlyph } from 'lucide-react/dist/esm/icons/scan-search.mjs';
import { __iconData as searchGlyph } from 'lucide-react/dist/esm/icons/search.mjs';
import { __iconData as settingsGlyph } from 'lucide-react/dist/esm/icons/settings.mjs';
import { __iconData as shieldGlyph } from 'lucide-react/dist/esm/icons/shield.mjs';
import { __iconData as shieldCheckGlyph } from 'lucide-react/dist/esm/icons/shield-check.mjs';
import { __iconData as slidersHorizontalGlyph } from 'lucide-react/dist/esm/icons/sliders-horizontal.mjs';
import { __iconData as sparklesGlyph } from 'lucide-react/dist/esm/icons/sparkles.mjs';
import { __iconData as splineGlyph } from 'lucide-react/dist/esm/icons/spline.mjs';
import { __iconData as sunGlyph } from 'lucide-react/dist/esm/icons/sun.mjs';
import { __iconData as sunDimGlyph } from 'lucide-react/dist/esm/icons/sun-dim.mjs';
import { __iconData as tagsGlyph } from 'lucide-react/dist/esm/icons/tags.mjs';
import { __iconData as timerGlyph } from 'lucide-react/dist/esm/icons/timer.mjs';
import { __iconData as undo2Glyph } from 'lucide-react/dist/esm/icons/undo-2.mjs';
import { __iconData as volume2Glyph } from 'lucide-react/dist/esm/icons/volume-2.mjs';
import { __iconData as wrenchGlyph } from 'lucide-react/dist/esm/icons/wrench.mjs';
import { __iconData as zapGlyph } from 'lucide-react/dist/esm/icons/zap.mjs';

import {
  BAND_PASS_BAND,
  BELL_BAND,
  HIGH_CUT_BAND,
  HIGH_SHELF_BAND,
  LOW_CUT_BAND,
  LOW_SHELF_BAND,
  NOTCH_BAND,
} from './filter-band-glyphs.js';
import { stroked } from './placed-glyph.js';

export const PANEL_ICONS = {
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
} as const;
