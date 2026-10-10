/**
 * The bounds every metadata reader holds a file to, and every writer writes
 * within (ADR-0093, REQ-EXEC-136), named for what each bounds.
 *
 * Each is far past what a real file carries and small enough that a hostile one
 * cannot make a reader hold much memory or loop long: a reader refuses a file
 * past a byte or count bound rather than reading on, and cuts text past its
 * bound in characters. A writer writes nothing its reader would refuse or cut,
 * so what is written is what is read back.
 */

/**
 * The most bytes of one metadata item that is not a picture: a RIFF or IFF
 * chunk, an ID3v2 frame, a Vorbis comment, an `ilst` item, a picture's media
 * type or description. Far more than any label, loop table or history needs.
 */
export const MAXIMUM_ITEM_BYTES = 1_048_576;

/** The most bytes of one embedded picture. */
export const MAXIMUM_PICTURE_BYTES = 32 * 1_048_576;

/**
 * The most bytes of every metadata chunk of a RIFF or IFF file together. These
 * forms carry text and tables alone, never a picture, so eight items' worth is
 * many times what any file holds.
 */
export const MAXIMUM_CHUNK_METADATA_BYTES = 8 * MAXIMUM_ITEM_BYTES;

/**
 * The most bytes of a tagged format's metadata together, pictures included:
 * Ogg's header packets, FLAC's metadata blocks, an ID3v2 tag, MP4's `moov`
 * metadata. It holds the largest picture with room to spare for the rest.
 */
export const MAXIMUM_TAG_METADATA_BYTES = 2 * MAXIMUM_PICTURE_BYTES;

/** The most fields, frames, comments, items, boxes or blocks a tagged format's reader reads. */
export const MAXIMUM_METADATA_FIELDS = 4_096;

/** The most cue points a WAV `cue ` chunk may list. */
export const MAXIMUM_CUE_POINTS = 4_096;

/** The most loops a WAV `smpl` chunk may list. */
export const MAXIMUM_LOOPS = 1_024;

/** The most markers an AIFF `MARK` chunk may list. */
export const MAXIMUM_MARKERS = 4_096;

/** The most `ANNO` chunks read from one AIFF file. */
export const MAXIMUM_ANNOTATIONS = 256;

/** The most entries of a WAV file's `LIST`/`INFO` lists together. */
export const MAXIMUM_INFO_FIELDS = 256;

/** The most entries of a WAV file's `LIST`/`adtl` lists together: a label and a note for every cue point and loop. */
export const MAXIMUM_LABEL_ENTRIES = 10_240;

/** The largest document kept whole as text, such as a WAV's `iXML`; a larger one is skipped unread. */
export const MAXIMUM_DOCUMENT_BYTES = 262_144;

/** The most characters of a name or a one-line field: a title, an artist, a cue's label. */
export const MAXIMUM_LINE_CHARACTERS = 1_024;

/** The most characters of a comment, a coding history, or a field kept by its own key. */
export const MAXIMUM_LONG_TEXT_CHARACTERS = 65_536;

/** The most characters of a document kept as text. */
export const MAXIMUM_DOCUMENT_CHARACTERS = MAXIMUM_DOCUMENT_BYTES;
