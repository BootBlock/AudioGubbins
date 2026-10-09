/**
 * The public contract of AudioGubbins copying and pasting (ADR-0053).
 *
 * A copy takes a slice of the plan of the asset or region shown, with the
 * records of the media it reads (`copyAudio`); a paste plans the edits that
 * insert it into an asset, fitted to its channels, converted to its rate only
 * when asked, and split where one argument could not hold it, with the records
 * the destination lacks (`planPaste`). The page holds what was copied for its
 * session and never keeps or sends it anywhere.
 *
 * Everything absent from this list is internal and may change without being a
 * contract change (REQ-REPO-186).
 */

export { type AudioPayload, type ClipboardPayload, copyAudio } from './clipboard-payload.js';
export {
  type ProcessingPayload,
  chainFromProcessing,
  copyProcessing,
  pastedSlots,
} from './processing-payload.js';
export { type PasteRequest, type PlannedPaste, planPaste } from './paste-planning.js';
