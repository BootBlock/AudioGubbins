/**
 * A channel layout stated in a WAV file's `iXML` chunk, for the layouts a
 * speaker mask cannot hold (ADR-0093).
 *
 * A mask places speakers and nothing else: it cannot say that a channel is one
 * component of an ambisonic set, name a channel, or tell one or two discrete
 * channels from mono and stereo. Such a WAV file is written in the extensible
 * form with the mask that holds what it can (none at all for an ambisonic set)
 * and states the whole layout in `iXML`, the XML chunk BWF tools carry, under
 * an element of AudioGubbins' own: an ambisonic set by its order, ordering and
 * normalisation, and any other layout by each channel's role and, where it has
 * one, its name. Named channels are also listed in iXML's own `TRACK_LIST`, so
 * other tools show the names. Nothing else is written there: no path, user or
 * machine name.
 *
 * The reader takes the statement only where it is whole and agrees with the
 * mask and the channel count, since the chunk is untrusted text another tool
 * may have left behind after changing the channels.
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  ChannelRole,
  ambisonicLayout,
  channelLayout,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';

import { DOCUMENT_TEXT, readText, encodeUtf8 } from './metadata-text.js';
import type { WrittenChunk } from './written-chunk.js';

/** The element AudioGubbins states a layout in. */
const ELEMENT = 'AUDIOGUBBINS_CHANNEL_LAYOUT';

/** The element's whole text, which the reader looks for once. */
const ELEMENT_PATTERN = new RegExp(`<${ELEMENT}>([\\s\\S]*?)</${ELEMENT}>`, 'u');

/** An ambisonic statement: the order, the ordering and the normalisation. */
const AMBISONIC_PATTERN =
  /^\s*<AMBISONIC>\s*<ORDER>(\d{1,2})<\/ORDER>\s*<ORDERING>([a-z0-9]+)<\/ORDERING>\s*<NORMALISATION>([a-z0-9]+)<\/NORMALISATION>\s*<\/AMBISONIC>\s*$/u;

/** One channel's statement: its role and, where it has one, its name. */
const CHANNEL_PATTERN =
  /\s*<CHANNEL>\s*<ROLE>([a-z-]+)<\/ROLE>\s*(?:<LABEL>([^<]*)<\/LABEL>\s*)?<\/CHANNEL>/uy;

/** The characters XML escapes in text, and their escapes. */
const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
]);
const ESCAPED = /[&<>]/gu;
const ENTITY = /&(amp|lt|gt|quot|apos);/gu;
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** The roles a statement names a channel by: every one but `ambisonic`, which a set states. */
const ROLES: ReadonlySet<string> = new Set(
  Object.values(ChannelRole).filter((role) => role !== ChannelRole.Ambisonic),
);

const ORDERINGS: ReadonlySet<string> = new Set(Object.values(AmbisonicOrdering));
const NORMALISATIONS: ReadonlySet<string> = new Set(Object.values(AmbisonicNormalisation));

function isRole(value: string): value is ChannelRole {
  return ROLES.has(value);
}

function isOrdering(value: string): value is AmbisonicOrdering {
  return ORDERINGS.has(value);
}

function isNormalisation(value: string): value is AmbisonicNormalisation {
  return NORMALISATIONS.has(value);
}

/** The most bytes of an `iXML` chunk read for a layout: far more than any statement takes. */
export const IXML_LAYOUT_BYTES = 1 << 16;

/** Text escaped for XML. */
function escaped(text: string): string {
  return text.replace(ESCAPED, (character) => ESCAPES.get(character) ?? character);
}

/** XML text unescaped, the five predefined entities only. */
function unescaped(text: string): string {
  return text.replace(ENTITY, (_, name: string) => ENTITIES.get(name) ?? '');
}

/** The element's body for a layout. */
function statement(layout: ChannelLayout): string {
  const { ambisonic } = layout;
  if (ambisonic !== undefined) {
    return `<AMBISONIC><ORDER>${String(ambisonic.order)}</ORDER><ORDERING>${ambisonic.ordering}</ORDERING><NORMALISATION>${ambisonic.normalisation}</NORMALISATION></AMBISONIC>`;
  }
  return layout.roles
    .map((role, index) => {
      const label = layout.labels?.[index];
      return `<CHANNEL><ROLE>${role}</ROLE>${label === undefined ? '' : `<LABEL>${escaped(label)}</LABEL>`}</CHANNEL>`;
    })
    .join('');
}

/** iXML's own list of tracks, naming each channel, where the layout names them. */
function trackList(layout: ChannelLayout): string {
  const { labels } = layout;
  if (labels === undefined) return '';
  const tracks = labels
    .map(
      (label, index) =>
        `<TRACK><CHANNEL_INDEX>${String(index + 1)}</CHANNEL_INDEX><INTERLEAVE_INDEX>${String(index + 1)}</INTERLEAVE_INDEX><NAME>${escaped(label)}</NAME></TRACK>`,
    )
    .join('');
  return `<TRACK_LIST><TRACK_COUNT>${String(labels.length)}</TRACK_COUNT>${tracks}</TRACK_LIST>`;
}

/** The `iXML` chunk stating `layout`. */
export function ixmlLayoutChunk(layout: ChannelLayout): WrittenChunk {
  const text = `<?xml version="1.0" encoding="UTF-8"?><BWFXML><IXML_VERSION>2.10</IXML_VERSION>${trackList(layout)}<${ELEMENT}>${statement(layout)}</${ELEMENT}></BWFXML>`;
  return { id: 'iXML', body: encodeUtf8(text) };
}

/** The ambisonic layout an ambisonic statement gives, or `undefined`. */
function ambisonicStatement(body: string): ChannelLayout | undefined {
  const match = AMBISONIC_PATTERN.exec(body);
  if (match === null) return undefined;
  const [, order = '', ordering = '', normalisation = ''] = match;
  if (!isOrdering(ordering) || !isNormalisation(normalisation)) return undefined;
  return valueOf(ambisonicLayout({ order: Number(order), ordering, normalisation }));
}

/** The layout a list of channel statements gives, or `undefined` where it is not one. */
function channelStatements(body: string, channelCount: number): ChannelLayout | undefined {
  const roles: ChannelRole[] = [];
  const labels: string[] = [];
  CHANNEL_PATTERN.lastIndex = 0;
  for (let index = 0; index < channelCount; index += 1) {
    const match = CHANNEL_PATTERN.exec(body);
    if (match === null) return undefined;
    const [, role = '', label] = match;
    if (!isRole(role)) return undefined;
    roles.push(role);
    if (label !== undefined) labels.push(unescaped(label));
  }
  if (body.slice(CHANNEL_PATTERN.lastIndex).trim() !== '') return undefined;
  if (labels.length !== 0 && labels.length !== roles.length) return undefined;
  return valueOf(channelLayout(roles, labels.length === 0 ? undefined : labels));
}

/** A result's value, or `undefined` where it failed. */
function valueOf(result: DomainResult<ChannelLayout>): ChannelLayout | undefined {
  return result.ok ? result.value : undefined;
}

/**
 * The layout of `channelCount` channels an `iXML` chunk's body states, or
 * `undefined` where it states none, or one that is not whole or not of that
 * many channels.
 */
export function ixmlLayout(body: Uint8Array, channelCount: number): ChannelLayout | undefined {
  const match = ELEMENT_PATTERN.exec(readText(body, 'unstated', DOCUMENT_TEXT));
  if (match === null) return undefined;
  const content = match[1] ?? '';
  const layout = AMBISONIC_PATTERN.test(content)
    ? ambisonicStatement(content)
    : channelStatements(content, channelCount);
  return layout?.roles.length === channelCount ? layout : undefined;
}
