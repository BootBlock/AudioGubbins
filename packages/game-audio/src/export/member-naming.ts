/**
 * A member's name from a naming template (ADR-0102): pure over the values
 * the caller gives, so the same member, clock and target name the same file
 * every time, and `{number}` counts within the group, not the export, so a
 * member's name does not change with what else is exported.
 *
 * The result is a literal stem, never a template: the export plan escapes it
 * into the settings' file name, and `safeFileName` makes it safe there as it
 * does every name.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { dateOf, type ExportClock, type TemplatePart } from '@audiogubbins/import-export';
import { quoted } from '@audiogubbins/text';

import { CASE_MODIFIERS, inCase } from './case-modifiers.js';
import type { NamingTemplate } from './naming-template.js';
import type { NamingToken } from './naming-vocabulary.js';

/** What a template's tokens are filled with for one member. */
export interface NamingValues {
  readonly project: string;
  readonly asset: string;

  /** The region's name; `undefined` for an asset member, which has none. */
  readonly region: string | undefined;
  readonly groupName: string;

  /** The names of the groups from the root to the member's own. */
  readonly groupPath: readonly string[];

  /** The member's place in its group, from 1, and the group's count of members. */
  readonly number: number;
  readonly count: number;
  readonly clock: ExportClock;

  /** The target's extension, for `{format}`. */
  readonly extension: string;
}

const GROUP_PATH_SEPARATOR = '_';

/** The text a text token stands for, before its case. */
function textOf(
  token: Exclude<NamingToken, 'number' | 'date' | 'format'>,
  values: NamingValues,
  region: string,
): string {
  switch (token) {
    case 'project':
      return values.project;
    case 'asset':
      return values.asset;
    case 'region':
      return region;
    case 'group':
      return values.groupName;
    case 'group-path':
      return values.groupPath.join(GROUP_PATH_SEPARATOR);
  }
}

function filled(
  part: Extract<TemplatePart<NamingToken>, { kind: 'token' }>,
  values: NamingValues,
  region: string,
): string {
  const { token, modifier } = part;
  switch (token) {
    case 'number': {
      const width = modifier === undefined ? String(values.count).length : Number(modifier);
      return String(values.number).padStart(width, '0');
    }
    case 'date':
      return dateOf(values.clock);
    case 'format':
      return values.extension;
    default: {
      const text = textOf(token, values, region);
      const modified = CASE_MODIFIERS.find((one) => one === modifier);
      return modified === undefined ? text : inCase(text, modified);
    }
  }
}

function namesRegion(template: NamingTemplate): boolean {
  return template.parts.some((part) => part.kind === 'token' && part.token === 'region');
}

/** The stem `template` names a member by, or why it cannot name this member. */
export function expandNaming(template: NamingTemplate, values: NamingValues): DomainResult<string> {
  const region = values.region;
  if (region === undefined && namesRegion(template)) {
    return fail(
      failure(
        'game.export-region-token-for-asset',
        FailureKind.Rejected,
        `The naming template ${quoted(template.source)} names {region}, but this member is a whole asset, which has no region; use {asset}.`,
        { details: { template: template.source } },
      ),
    );
  }
  // Refused above where the template names {region} and there is none, so the
  // empty name stands for a region no part reads.
  return succeed(
    template.parts
      .map((part) => (part.kind === 'text' ? part.text : filled(part, values, region ?? '')))
      .join(''),
  );
}
