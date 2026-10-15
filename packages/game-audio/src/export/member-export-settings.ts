/**
 * The export settings a profile gives one member (ADR-0102): the profile's
 * choices resolved as a preset over the member's own audio, the member's
 * range, and the name its naming gives, as a literal.
 *
 * A region member exports as its region; an asset member as the whole of the
 * audio its context describes, which is the asset, as the Export dialog's
 * "project" range is the asset in the editor.
 */

import type { RegionId } from '@audiogubbins/domain';
import {
  escapeTemplateText,
  resolvePreset,
  type ExportContext,
  type ExportRange,
  type ExportSettings,
} from '@audiogubbins/import-export';

import { profilePreset, type GameExportProfile } from './game-export-profile.js';

/**
 * Of a group's member, what its range is made from: the region it is, or that
 * it is a whole asset. A group member is passed as it is.
 */
type MemberRange =
  { readonly kind: 'region'; readonly region: RegionId } | { readonly kind: 'asset' };

function rangeOf(member: MemberRange): ExportRange {
  return member.kind === 'region' ? { kind: 'region', region: member.region } : { kind: 'project' };
}

/**
 * The settings `profile` gives `member` over `context`, naming its file
 * `stem`. The stem is literal, the one `expandNaming` gives, and is escaped
 * here into the settings' file name template, so the export fills nothing
 * more into it and a brace in a name stays a brace.
 */
export function memberExportSettings(
  profile: GameExportProfile,
  member: MemberRange,
  context: ExportContext,
  stem: string,
): ExportSettings {
  return {
    ...resolvePreset(profilePreset(profile), context),
    range: rangeOf(member),
    fileName: escapeTemplateText(stem),
  };
}
