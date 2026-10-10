/**
 * Reading a text written in percent-encoding, as the redaction rules have to.
 *
 * An address, a form and a file's link write a path, a name or a secret as runs
 * of `%XX`, and the rules read a text as it is written: `%2Fhome%2Fjane` has no
 * root a rule can find, and `jane%40example.com` no `@`. Decoding a layer of
 * those runs gives the rules the text they were written to read. Only the runs
 * are decoded, as UTF-8, as a browser decodes an address: a byte that begins no
 * character, or a character cut short, becomes U+FFFD rather than staying
 * encoded, so no `%XX` left standing against a root can hide the root from the
 * rule that reads one.
 */

/** A run of percent-encoded bytes. */
const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

/** Whether a text holds a run of percent-encoded bytes. */
const HOLDS_A_PERCENT_RUN = /%[0-9A-Fa-f]{2}/;

/** What a byte that cannot be read as UTF-8 is decoded as. */
const REPLACEMENT = '\uFFFD';

/**
 * How many bytes a character takes that a lead byte begins, and the range its
 * second byte must be in, as RFC 3629 bounds it: no overlong form, no surrogate
 * and nothing past U+10FFFF.
 */
interface Lead {
  readonly length: 2 | 3 | 4;
  readonly secondFrom: number;
  readonly secondTo: number;
}

const TWO_BYTES: Lead = { length: 2, secondFrom: 0x80, secondTo: 0xbf };
const THREE_BYTES_FROM_U0800: Lead = { length: 3, secondFrom: 0xa0, secondTo: 0xbf };
const THREE_BYTES_BELOW_SURROGATES: Lead = { length: 3, secondFrom: 0x80, secondTo: 0x9f };
const THREE_BYTES: Lead = { length: 3, secondFrom: 0x80, secondTo: 0xbf };
const FOUR_BYTES_FROM_U10000: Lead = { length: 4, secondFrom: 0x90, secondTo: 0xbf };
const FOUR_BYTES_TO_U10FFFF: Lead = { length: 4, secondFrom: 0x80, secondTo: 0x8f };
const FOUR_BYTES: Lead = { length: 4, secondFrom: 0x80, secondTo: 0xbf };

/** What a byte of 0x80 or more begins: a character of two, three or four bytes, or none. */
function leadOf(byte: number): Lead | undefined {
  if (byte >= 0xc2 && byte <= 0xdf) return TWO_BYTES;
  if (byte === 0xe0) return THREE_BYTES_FROM_U0800;
  if (byte === 0xed) return THREE_BYTES_BELOW_SURROGATES;
  if (byte >= 0xe1 && byte <= 0xef) return THREE_BYTES;
  if (byte === 0xf0) return FOUR_BYTES_FROM_U10000;
  if (byte === 0xf4) return FOUR_BYTES_TO_U10FFFF;
  if (byte >= 0xf1 && byte <= 0xf3) return FOUR_BYTES;
  return undefined;
}

/** The bits a lead byte of each length carries of its character. */
const LEAD_BITS = { 2: 0x1f, 3: 0x0f, 4: 0x07 } as const;

/** Whether a byte continues a character. */
function continues(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x80 && byte <= 0xbf;
}

/** One run of `%XX`, read as UTF-8. */
function decodedRun(run: string): string {
  const bytes = new Uint8Array(run.length / 3);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(run.slice(index * 3 + 1, index * 3 + 3), 16);
  }

  let decoded = '';
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index] ?? 0;
    if (first < 0x80) {
      decoded += String.fromCharCode(first);
      index += 1;
      continue;
    }

    const lead = leadOf(first);
    const second = bytes[index + 1];
    if (
      lead === undefined ||
      second === undefined ||
      second < lead.secondFrom ||
      second > lead.secondTo
    ) {
      decoded += REPLACEMENT;
      index += 1;
      continue;
    }

    // Each byte that continues the character is taken; at the first that does
    // not, the character is cut short and is one replacement, and that byte is
    // read afresh, as the Encoding Standard reads it.
    let codePoint = first & LEAD_BITS[lead.length];
    let taken = 1;
    while (taken < lead.length && (taken === 1 || continues(bytes[index + taken]))) {
      codePoint = (codePoint << 6) | ((bytes[index + taken] ?? 0) & 0x3f);
      taken += 1;
    }
    decoded += taken === lead.length ? String.fromCodePoint(codePoint) : REPLACEMENT;
    index += taken;
  }
  return decoded;
}

/** `text` with one layer of percent-encoding decoded, every run of it at once. */
function decodedOnce(text: string): string {
  return text.replace(PERCENT_RUN, decodedRun);
}

/** Whether `text` still holds a run that decoding would change. */
export function holdsPercentEncoding(text: string): boolean {
  return HOLDS_A_PERCENT_RUN.test(text);
}

/**
 * How many layers of percent-encoding are decoded for the rules to read.
 *
 * A bound, because a layer is a pass of every rule over the text, and a text
 * can be encoded as many times as it is long: `%252525…41` loses one `25` a
 * layer, so decoded until nothing changed, it would be read once for each of
 * its characters. Three is a layer more than anything writes in practice, an
 * address encoded again as a parameter of another.
 */
const DECODING_LAYERS = 3;

/** A word: a run of anything but white space. */
const WORD = /\S+/g;

/**
 * `text` as each layer of its percent-encoding decodes it, up to
 * {@link DECODING_LAYERS}, each layer handed to `read` and read on from what
 * `read` makes of it, so a rule reads every layer and nothing can be hidden
 * from it by encoding. A word still encoded past the last layer is replaced by
 * what `unreadable` gives, since what it hides cannot be read.
 */
export function readEachLayer(
  text: string,
  read: (layer: string) => string,
  unreadable: () => string,
): string {
  let layer = text;
  for (let count = 0; count < DECODING_LAYERS && holdsPercentEncoding(layer); count += 1) {
    layer = read(decodedOnce(layer));
  }
  return layer.replace(WORD, (word) => (holdsPercentEncoding(word) ? unreadable() : word));
}
