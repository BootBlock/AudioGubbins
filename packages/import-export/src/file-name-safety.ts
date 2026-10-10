/**
 * Making a name every common file system accepts, the same way on every
 * machine.
 *
 * A file may be written to Windows, macOS, Linux, a memory card or a share,
 * so a name is held to all of their rules at once: none of the characters
 * Windows forbids, `< > : " / \ | ? *`, or any control character; no
 * leading dot, which hides a file on Unix, and no trailing dot or space,
 * which Windows drops; no stem that is one of Windows' device names, such as
 * `CON` or `LPT1`, whatever follows it; and no more than 255 bytes of UTF-8,
 * the longest name ext4 and APFS hold, which NTFS's 255 UTF-16 units never
 * fall below. The name is NFC, the form a person's typing gives. A forbidden
 * character becomes `_`, a reserved stem gains a leading `_`, an empty stem
 * becomes `export`, and a long stem loses whole code points from its end, so
 * the extension and any copy number are always kept.
 */

/** Characters no common file system takes in a name, and every control character. */
const FORBIDDEN = /[<>:"/\\|?*\p{Cc}]/gu;

/** Windows' device names, which no stem may be, in any case, with or without what follows a dot. */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/iu;

const LEADING = /^[\s.]+/u;
const TRAILING = /[\s.]+$/u;

/** The most bytes of UTF-8 a name may take. */
const LONGEST_NAME_BYTES = 255;

const FALLBACK_STEM = 'export';

/** The bytes of UTF-8 one code point takes. */
function pointBytes(point: number): number {
  if (point < 0x80) return 1;
  if (point < 0x800) return 2;
  return point < 0x1_0000 ? 3 : 4;
}

/** The bytes of UTF-8 `text` takes, a lone surrogate counting as the three of its replacement. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const point of text) bytes += pointBytes(point.codePointAt(0) ?? 0);
  return bytes;
}

/** `stem`, losing whole code points from its end until it takes at most `bytes` bytes. */
function truncated(stem: string, bytes: number): string {
  let kept = '';
  let used = 0;
  for (const point of stem) {
    const size = utf8Length(point);
    if (used + size > bytes) break;
    kept += point;
    used += size;
  }
  return kept;
}

/** A file's name: a stem and an extension, apart, so a copy number goes between them. */
export interface ExportFileName {
  readonly stem: string;
  readonly extension: string;
}

/**
 * The safe name of a file of `stem` and `extension`, with ` (copy)` after the
 * stem where a copy number is given, as a collision's rename asks.
 */
export function safeFileName(name: ExportFileName, copy?: number): string {
  const suffix = copy === undefined ? '' : ` (${String(copy)})`;
  const ending = `${suffix}.${name.extension}`;
  const cleaned = name.stem.normalize('NFC').replace(FORBIDDEN, '_').replace(LEADING, '');
  const room = LONGEST_NAME_BYTES - utf8Length(ending);
  let stem = truncated(cleaned, room).replace(TRAILING, '');
  if (stem === '') stem = FALLBACK_STEM;
  const device = stem.split('.')[0] ?? stem;
  if (RESERVED.test(device.trimEnd())) stem = truncated(`_${stem}`, room);
  return `${stem}${ending}`;
}
