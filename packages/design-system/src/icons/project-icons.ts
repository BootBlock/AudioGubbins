/**
 * The icons of the guided workflows, built-in chains, projects, files and
 * storage. Part of the icon vocabulary (`vocabulary.ts`), which joins the parts
 * into one map whose keys are the names a feature may use.
 */

import { __iconData as activityGlyph } from 'lucide-react/dist/esm/icons/activity.mjs';
import { __iconData as archiveGlyph } from 'lucide-react/dist/esm/icons/archive.mjs';
import { __iconData as archiveXGlyph } from 'lucide-react/dist/esm/icons/archive-x.mjs';
import { __iconData as audioLinesGlyph } from 'lucide-react/dist/esm/icons/audio-lines.mjs';
import { __iconData as cropGlyph } from 'lucide-react/dist/esm/icons/crop.mjs';
import { __iconData as databaseGlyph } from 'lucide-react/dist/esm/icons/database.mjs';
import { __iconData as downloadGlyph } from 'lucide-react/dist/esm/icons/download.mjs';
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
import { __iconData as folderGlyph } from 'lucide-react/dist/esm/icons/folder.mjs';
import { __iconData as folderDownGlyph } from 'lucide-react/dist/esm/icons/folder-down.mjs';
import { __iconData as folderInputGlyph } from 'lucide-react/dist/esm/icons/folder-input.mjs';
import { __iconData as folderOpenGlyph } from 'lucide-react/dist/esm/icons/folder-open.mjs';
import { __iconData as folderPlusGlyph } from 'lucide-react/dist/esm/icons/folder-plus.mjs';
import { __iconData as folderXGlyph } from 'lucide-react/dist/esm/icons/folder-x.mjs';
import { __iconData as gamepad2Glyph } from 'lucide-react/dist/esm/icons/gamepad-2.mjs';
import { __iconData as gaugeGlyph } from 'lucide-react/dist/esm/icons/gauge.mjs';
import { __iconData as handGlyph } from 'lucide-react/dist/esm/icons/hand.mjs';
import { __iconData as keyRoundGlyph } from 'lucide-react/dist/esm/icons/key-round.mjs';
import { __iconData as link2OffGlyph } from 'lucide-react/dist/esm/icons/link-2-off.mjs';
import { __iconData as lockKeyholeGlyph } from 'lucide-react/dist/esm/icons/lock-keyhole.mjs';
import { __iconData as messageSquareGlyph } from 'lucide-react/dist/esm/icons/message-square.mjs';
import { __iconData as mousePointerClickGlyph } from 'lucide-react/dist/esm/icons/mouse-pointer-click.mjs';
import { __iconData as packageGlyph } from 'lucide-react/dist/esm/icons/package.mjs';
import { __iconData as repeatGlyph } from 'lucide-react/dist/esm/icons/repeat.mjs';
import { __iconData as rotateCcwGlyph } from 'lucide-react/dist/esm/icons/rotate-ccw.mjs';
import { __iconData as scissorsGlyph } from 'lucide-react/dist/esm/icons/scissors.mjs';
import { __iconData as shareGlyph } from 'lucide-react/dist/esm/icons/share.mjs';
import { __iconData as uploadGlyph } from 'lucide-react/dist/esm/icons/upload.mjs';

import { stroked } from './placed-glyph.js';

export const PROJECT_ICONS = {
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
