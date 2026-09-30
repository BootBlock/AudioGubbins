import { describe, expect, it } from 'vitest';

import { LONGEST_COST_TEST_MS, relativeCost } from '@audiogubbins/test-fixtures';

import { LogSeverity, type LogRecord } from './log-record.js';
import { absolutePathsIn, indexQuotes } from './path-finding.js';
import { redactRecords, sanitiseStack, type RedactionSummary } from './redaction.js';

/**
 * Whether a redaction pass removed anything.
 *
 * The tests' own reading of a summary, kept out of the production exports: a
 * function nothing outside the tests calls is the kind a later phase finds and
 * takes for a contract.
 */
function redactionRemovedSomething(summary: RedactionSummary): boolean {
  return Object.values(summary.counts).some((count) => count > 0);
}

/**
 * How long redacting one of the long texts below may take.
 *
 * For the cases whose defective form took from twelve to fifty-five seconds: a
 * time is the right measure for those, because the fixed form is a search back
 * a fixed distance, which grows in proportion to the text too, only much more
 * slowly. Each of them takes under half a second.
 *
 * It is the wrong measure for a case whose defect reads a part of the text
 * again for each of many starts. There, the input has to be made large enough
 * that the defective form crosses the limit, which is a number tuned to one
 * machine's speed: at sixteen thousand repeats the unbounded key header would
 * finish inside two seconds on a fast machine, and a test would need forty
 * thousand to fail at all. Those cases use {@link costAgainstProse} instead,
 * which no machine's speed decides.
 */
const TIME_LIMIT_MS = 2_000;

/** A sentence of the kind a log is made of, in which no rule finds anything. */
const PROSE = 'Could not decode the take, so it was skipped. ';

/**
 * How many times longer a text takes to redact than ordinary prose of the same
 * length, read with {@link relativeCost}.
 *
 * A defect that reads a bounded window again for each start grows with the
 * text as the fixed form does, so the growth of a longer text cannot tell the
 * two apart, but each character costs the window's length rather than one. One
 * that reads to the end of the line for each start grows with the square of
 * the text, and at the sizes below costs many times more again. Either shows
 * against prose on any machine, where a time would be tuned to one.
 *
 * Held against prose rather than a baseline no rule reads, such as a text
 * copied: a rule added later that reads every character once costs a text and
 * prose alike, so the fixed form's ratio moves only towards one and a defect's
 * falls by no more than the new rule's share of the cost. Against a baseline no
 * rule reads, every such rule would raise the fixed form's ratio towards its
 * limit.
 */
function costAgainstProse(redact: (text: string) => unknown, text: string): number {
  const prose = PROSE.repeat(Math.ceil(text.length / PROSE.length)).slice(0, text.length);
  return relativeCost(
    () => redact(text),
    () => redact(prose),
  );
}

/**
 * `text`, answering every read as the string does, with each read of it, of a
 * character or of its length, counted in `reads`. The quote index reads a text
 * by its length and its characters alone, so it is handed this in the string's
 * place, and every read it makes of the text is counted.
 */
function readsCounted(text: string, reads: { counted: number }): string {
  const counting = new Proxy(new String(text), {
    get(target, key) {
      reads.counted += 1;
      const answer: unknown = Reflect.get(target, key);
      return answer;
    },
  });
  return counting as string;
}

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    timestamp: 1_700_000_000_000,
    severity: LogSeverity.Error,
    category: 'storage',
    message: 'The write failed.',
    fields: {},
    ...overrides,
  };
}

function redactOne(input: LogRecord, keepFileNames = false) {
  const result = redactRecords([input], { keepFileNames });
  const [only] = result.records;
  if (only === undefined) throw new Error('redaction dropped the record');
  return { record: only, summary: result.summary };
}

describe('absolute path redaction', () => {
  it('removes an account folder whose name has a space in it', () => {
    // Both patterns stopped at the first space, and a Windows or macOS account
    // folder very often holds one: the folder was removed and the person's
    // surname was left standing in the text after it.
    const { record: redacted } = redactOne(
      record({
        message: 'Could not read C:\\Users\\Alex Bloggs\\Music\\take 3.wav for import.',
        fields: { path: '/Volumes/Jane Backup/Sessions/take.wav' },
      }),
    );

    // Exactly, not by containment: `toContain` would pass over a tail left in
    // the text after the placeholder.
    expect(redacted.message).toBe('Could not read <path> for import.');
    expect(redacted.fields['path']).toBe('<path>');
  });

  it('removes the last segment of a spaced path, which can be a name as much as a folder can', () => {
    // A space was kept only while a separator followed it, and the last segment
    // has none after it, so the words of a spaced last segment stood in the
    // text after the placeholder.
    const cases: readonly [string, string][] = [
      ['Saved to C:\\Users\\Alex Bloggs\\Sessions\\Jane Smith Interview', 'Saved to <path>'],
      ['Opened /Volumes/Jane Backup/Sessions/Client Name Interview.wav', 'Opened <path>'],
      ['Saved /home/jane/Recordings/Jane Bloggs Interview.mp3 now', 'Saved <path> now'],
      [
        'Could not read C:\\Users\\Alex Bloggs\\Smith Notes: permission denied.',
        'Could not read <path>: permission denied.',
      ],
    ];

    for (const [message, expected] of cases) {
      expect(redactOne(record({ message })).record.message).toBe(expected);
    }
  });

  it('removes a path with an apostrophe in it, which is common in a surname', () => {
    // The apostrophe was not a path character, so matching stopped at it and
    // the surname, the folders and the file name all survived.
    const cases: readonly [string, string][] = [
      ["Failed C:\\Users\\Alex O'Brien\\Documents\\notes", 'Failed <path>'],
      ["Failed /Users/alex/Jane's Backup/Sessions/take", 'Failed <path>'],
      [
        "Could not open 'C:\\Users\\Alex O'Brien\\notes.txt' today.",
        "Could not open '<path>' today.",
      ],
      ['Could not open "/home/jane/My Songs/demo" at all.', 'Could not open "<path>" at all.'],
    ];

    for (const [message, expected] of cases) {
      expect(redactOne(record({ message })).record.message).toBe(expected);
    }
  });

  it('keeps the sentence a path sits in, rather than swallowing it', () => {
    const { record: redacted } = redactOne(
      record({ message: 'Importing /home/jane/take.wav crashed it.' }),
    );

    expect(redacted.message).toBe('Importing <path> crashed it.');
  });

  it('removes a path under any root, not only a home directory', () => {
    // The removable and external drives an audio editor imports from mount
    // under these, and each carries the account name. Asserted in prose rather
    // than in a field called `path`, which is redacted by its name whatever the
    // patterns do, and so proves nothing about them.
    for (const [path, name] of [
      ['/media/jane.doe/USB/take.wav', 'jane.doe'],
      ['/run/media/jbloggs/Elements/session.wav', 'jbloggs'],
      ['/data/data/com.audiogubbins/files/take.wav', 'com.audiogubbins'],
      ['/Volumes/Jane Backup/Sessions/take.wav', 'Jane'],
    ] as const) {
      const message = `Imported ${path} without asking.`;
      const redacted = redactOne(record({ message })).record.message;

      expect(redacted).not.toContain(name);
      expect(redacted).toBe('Imported <path> without asking.');
    }
  });

  it('removes a UNC share, which names the machine as well', () => {
    // In prose as well as in a field called `path`, which is redacted by its
    // name whatever the patterns do: only the prose reaches the share's root.
    const { record: redacted } = redactOne(
      record({
        message: 'Could not open \\\\studio-nas\\projects\\take.wav for import.',
        fields: { path: '\\\\studio-nas\\projects\\session.agp' },
      }),
    );
    expect(redacted.message).toBe('Could not open <path> for import.');
    expect(redacted.fields['path']).toBe('<path>');
  });

  it('removes a path embedded in a message', () => {
    const { record: redacted } = redactOne(
      record({ message: 'Could not read C:\\Users\\someone\\take.wav for import.' }),
    );
    expect(redacted.message).toBe('Could not read <path> for import.');
  });

  it('keeps the filename only when the user asked for it', () => {
    const { record: redacted } = redactOne(
      record({ fields: { path: '/home/someone/audio/take-3.wav' } }),
      true,
    );
    expect(redacted.fields['path']).toBe('<path>/take-3.wav');
  });

  it('removes absolute paths from stack frames', () => {
    const { record: redacted } = redactOne(
      record({
        stack: {
          frames: ['at decodeAsset (C:\\Users\\someone\\app\\codec.ts:41:7)', 'at onImport'],
        },
      }),
    );
    // The closing bracket goes with the path, as a bracket can end a name:
    // `Interview (1)`.
    expect(redacted.stack?.frames).toEqual(['at decodeAsset (<path>', 'at onImport']);
  });

  it('removes a relative path too, because its folders and its file are named by the user', () => {
    // A relative path names someone too, so asserting that one "names nobody"
    // would pin the defect: `clients/acme/final mix.wav` names a client and a
    // piece of work, and REQ-PRIV-165 asks for file names to be removed unless
    // the user chose to keep them.
    const { record: redacted } = redactOne(record({ fields: { path: 'fixtures/tone-440.wav' } }));
    expect(redacted.fields['path']).toBe('<path>');
  });

  it('removes a file: address, which is a local path written as a URL', () => {
    const { record: redacted } = redactOne(
      record({ message: 'Dropped file:///C:/Users/someone/Music/take-3.wav on the editor.' }),
    );
    expect(redacted.message).toBe('Dropped <path> on the editor.');
  });
});

describe('where a path ends', () => {
  const redacted = (message: string): string => redactOne(record({ message })).record.message;

  it('removes a path in single quotes, which is how Node prints one', () => {
    // A quote before the slash refused the root, and the whole path went into
    // the report, account name and file name with it.
    expect(redacted("ENOENT: no such file or directory, open '/Users/jane/Music/take.wav'")).toBe(
      "ENOENT: no such file or directory, open '<path>'",
    );
    expect(redacted("Could not open '/home/jane/Recordings/Jane Smith Interview' at all.")).toBe(
      "Could not open '<path>' at all.",
    );
    expect(redacted("'/media/jane.doe/USB/take.wav'")).toBe("'<path>'");
  });

  it('keeps a name that has punctuation inside it, and stops before the prose after it', () => {
    // Any punctuation ended the path, so a surname or a given name after an
    // abbreviation or a comma was left standing after the placeholder.
    const cases: readonly [string, string][] = [
      ['Saved C:\\Users\\alex\\Music\\J. Smith - Demo.wav', 'Saved <path>'],
      ['Saved C:\\Users\\alex\\Podcasts\\Ep. 12 with Dr. Jane Smith.wav', 'Saved <path>'],
      ['Saved C:\\Users\\alex\\Clients\\Smith, Jane - Interview.docx', 'Saved <path>'],
      ['Opened /Users/alex/Cases/Smith v. Jones', 'Opened <path>'],
      [
        'Could not read C:\\Users\\alex\\notes: permission denied.',
        'Could not read <path>: permission denied.',
      ],
    ];

    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('ends a file: address by the rules a path ends by', () => {
    // It had a pattern of its own that stopped at an apostrophe and at a space.
    expect(redacted("Could not read file:///Users/Alex%20O'Brien/Documents/Session notes")).toBe(
      'Could not read <path>',
    );
    expect(redacted('Opened file:///C:/Users/Jane Smith/Documents/take.wav today')).toBe(
      'Opened <path> today',
    );
  });

  it('takes time in proportion to the text, however it is made', () => {
    // Each word searched back to the start of the text for a separator, and
    // each quoted root searched to its end for a quote, so a long pasted note
    // took seconds.
    const words = `C:\\${'a '.repeat(50_000)}`;
    const quotes = "'C:\\ ".repeat(25_000);

    const started = performance.now();
    redacted(words);
    redacted(quotes);

    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
  });

  it(
    'reads the window for a closing quote once a line, not once a root',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      // A quoted root with no closing quote would pay the whole four-kilobyte
      // window looking for one, and a text of nothing but such roots would pay
      // it for each: a megabyte takes about four seconds that way. A window of
      // any length read for each root is a read of the text for each, and a
      // short one costs too little for a time to see, so the work is counted:
      // the index is built once, over a text whose every read is counted, and
      // each root's closing quote is asked of it, which answers without a read
      // of the text. A window read in the finding asks the index nothing, and
      // one read in the index reads the text.
      const text = "'C:\\ ".repeat(2_000);
      const reads = { counted: 0 };
      let built = 0;
      let asked = 0;
      let readBuilding = 0;
      const found = absolutePathsIn(text, (indexed) => {
        built += 1;
        const index = indexQuotes(readsCounted(indexed, reads));
        readBuilding = reads.counted;
        return {
          closingQuote: (from, quote) => {
            asked += 1;
            return index.closingQuote(from, quote);
          },
        };
      });

      expect(found).toHaveLength(2_000);
      expect(readBuilding).toBeGreaterThanOrEqual(text.length);
      expect({ built, asked, readAsking: reads.counted - readBuilding }).toEqual({
        built: 1,
        asked: 2_000,
        readAsking: 0,
      });

      // What the count cannot see, a root's own pattern or the end of a path
      // without a closing quote read again for each root, the time can, where
      // it is long: this text costs three to five times what prose does, and
      // some seventy with the four-kilobyte window read for each root.
      expect(costAgainstProse(redacted, text)).toBeLessThan(15);
    },
  );
});

describe('a name and a path, in the forms a browser gives them', () => {
  const redacted = (message: string): string => redactOne(record({ message })).record.message;

  it('removes a file name written without a folder, whatever it holds', () => {
    // One run of ASCII word characters was taken for the name, so a space or a
    // letter outside a to z left the rest of it before the placeholder. A
    // browser gives a page a file's name and never its path, so this is the
    // form a name reaches a log in.
    //
    // The words before a name go with it, back to where a name cannot reach.
    expect(redacted('Could not decode Jane Smith Interview.wav, so it was skipped.')).toBe(
      '<file>, so it was skipped.',
    );
    expect(redacted('Could not decode: Zoë Müller.wav')).toBe('Could not decode: <file>');
    expect(redacted('Could not decode: 张伟采访.wav')).toBe('Could not decode: <file>');
    expect(redacted('Could not decode Zoë Müller.wav')).toBe('<file>');
    expect(redacted('Could not decode 张伟采访.wav')).toBe('<file>');
    expect(redacted('Imported Clients/Jane Smith/take.wav')).toBe('<path>');
    expect(redacted("open 'Jane Smith Interview.wav'")).toBe("open '<file>'");
    expect(redacted('Imported folder/take.wav.')).toBe('<path>.');
  });

  it('ends a quoted path at its last quote on the line, past a possessive', () => {
    expect(
      redacted(
        "ENOENT: no such file or directory, open '/Users/chris/Chris' Demos/Jane Smith Interview'",
      ),
    ).toBe("ENOENT: no such file or directory, open '<path>'");
  });

  it('keeps going past a mark followed by lower-case words, which can be a name', () => {
    expect(redacted('Opened C:\\Users\\alex\\Interviews\\Smith v. van Dijk')).toBe('Opened <path>');
    expect(redacted('Saved C:\\Users\\alex\\Clients\\smith, jane - interview.docx')).toBe(
      'Saved <path>',
    );
    expect(redacted('Could not read C:\\Users\\alex\\notes: permission denied')).toBe(
      'Could not read <path>: permission denied',
    );
  });

  it('removes a share written with forward slashes, and a path climbing out of its folder', () => {
    expect(redacted('Could not open //JANES-PC/Users/jane/notes')).toBe('Could not open <path>');
    expect(redacted('Could not open ../../home/jane/Documents/Jane Smith')).toBe(
      'Could not open <path>',
    );
  });

  it('removes all of a path that runs past the bound on a search', () => {
    const long = `C:\\${'a '.repeat(2040)}/home/jane/Private/Jane Smith Interview`;
    expect(redacted(long)).toBe('<path>');
  });

  it('finds a secret named in text however the name is written', () => {
    expect(redacted('Refused clientSecret=abc123def456')).toBe('Refused <redacted>');
    expect(redacted('{"username":"jane","password":"hunter2"}')).toBe(
      '{"username":"jane",<redacted>}',
    );
    expect(redacted('aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toBe(
      '<redacted>',
    );
    // A value without quotes runs to the next name given a value.
    expect(redacted('SECRET_KEY=abc and private_key=def')).toBe('<redacted> <redacted>');
    expect(redacted('Timing: 12 ms, tokenCount: 3')).toBe('Timing: 12 ms, tokenCount: 3');
  });

  it('reads an ordinary name by its start, so a longer one built on it stays ordinary', () => {
    // The exceptions were exactly one name wide, so a plural or a longer name
    // built on one was redacted again, and the rest of a name after one was
    // never read.
    const { record: kept } = redactOne(
      record({
        fields: {
          timeSignatures: '4/4',
          keySignatureTonic: 'C',
          tokenCounts: 3,
          tokenizerSecret: 'abc',
        },
      }),
    );
    expect(kept.fields).toEqual({
      timeSignatures: '4/4',
      keySignatureTonic: 'C',
      tokenCounts: 3,
      tokenizerSecret: '<redacted>',
    });
  });

  it('knows more names for a secret and a location, and more shapes of a key', () => {
    const { record: cleaned } = redactOne(
      record({
        message:
          'Refused ya29.a0AfH6SMBxEXAMPLEtoken and whsec_abcdefghijklmnopqrstuv, key -----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY----- sent',
        fields: { signingKey: 'abc', sid: 'x1', folderName: 'Jane Smith Private' },
      }),
    );
    expect(cleaned.message).toBe('Refused <redacted> and <redacted>, key <redacted> sent');
    expect(cleaned.fields).toEqual({
      signingKey: '<redacted>',
      sid: '<redacted>',
      folderName: '<file>',
    });
  });

  it('keeps no credential after a kept file name in a location field', () => {
    const { record: kept } = redactOne(
      record({
        fields: {
          fileName: 'take.wav?access_token=ya29.a0AfH6SMBx',
          file: 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWx',
        },
      }),
      true,
    );
    expect(kept.fields).toEqual({ fileName: 'take.wav', file: '<redacted>' });
  });
});

describe('a name, a path and a secret, among the words around them', () => {
  const redacted = (message: string, keepFileNames = false): string =>
    redactOne(record({ message }), keepFileNames).record.message;

  it('removes every word before a name, back to where nothing can be part of one', () => {
    // The walk back from the extension stopped at a lower-case word and at a
    // sentence's first word, and each left a person's name before the
    // placeholder; a bracket ended the walk before it began, so a second
    // download's name was not found at all.
    const cases: readonly [string, string][] = [
      ['Could not decode jane smith interview.wav', '<file>'],
      ['Could not decode jane smith take 2.wav', '<file>'],
      ['Could not decode Maria de la Cruz.wav', '<file>'],
      ['Could not decode Smith v. van Dijk.wav', '<file>'],
      ['Could not decode Jane Smith and Bob Jones.wav', '<file>'],
      ['Jane interview.wav could not be decoded.', '<file> could not be decoded.'],
      ['Decode failed. Jane interview.wav was skipped.', '<file> was skipped.'],
      ['Skipped Jane Smith Interview (1).wav', '<file>'],
      ['Could not decode: jane smith interview.wav', 'Could not decode: <file>'],
      ["Could not decode 'jane smith interview.wav' today", "Could not decode '<file>' today"],
      ["Opened 'The 'Best' Take.wav'", "Opened '<file>'"],
      ['First line\nCould not decode jane.wav', 'First line\n<file>'],
      ['Moved->Jane.wav', 'Moved-><file>'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('reads each name once, and leaves the name a path kept on request after it', () => {
    // A name was read back past the one before it, so both were written out
    // again, and a kept name after a placeholder was taken for a folder.
    expect(redacted('Read /home/jane/Jane Smith.wav', true)).toBe('Read <path>/Jane Smith.wav');
    expect(redacted('Mixed Jane Smith.wav, Bob Jones.wav', true)).toBe(
      'Mixed Jane Smith.wav, Bob Jones.wav',
    );
    const { record: both, summary } = redactOne(
      record({ message: 'Mixed Jane Smith.wav, Bob Jones.wav' }),
    );
    expect(both.message).toBe('<file>, <file>');
    expect(summary.counts['file-name']).toBe(2);
  });

  it('reads names in time in proportion to the text', { timeout: LONGEST_COST_TEST_MS }, () => {
    // Each name was read back as far as four thousand characters, and the
    // start of a sentence was looked for back to the start of the text.
    const started = performance.now();
    redacted(`${'\n'.repeat(1_000_000)}A B.wav C.wav D.wav`);
    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);

    // The read back was bounded, so a text of names cost as it grew either
    // way, and is held against prose: seven to nine times its cost, and some
    // six hundred with each name read back four thousand characters.
    expect(costAgainstProse(redacted, 'A.wav '.repeat(2_500))).toBeLessThan(70);
  });

  it('finds a path from every root a machine or an account is named under', () => {
    const noBreakSpace = String.fromCodePoint(0xa0);
    const cases: readonly [string, string][] = [
      ['Could not reach //JANES-PC', 'Could not reach <path>'],
      ['Could not open ..\\..\\Users\\jane\\Documents', 'Could not open <path>'],
      ['Could not open ./home/jane/Private', 'Could not open <path>'],
      // A path on a share, which ends as a path ends.
      ['Could not mount smb://JANES-PC/Users/jane/Private', 'Could not mount <path>'],
      ['Opened C:\\Users\\alex\\Jane  Smith\\Private Notes', 'Opened <path>'],
      [`Opened C:\\Users\\alex\\Jane${noBreakSpace}Smith\\Private Notes`, 'Opened <path>'],
      ['a // comment, 1..2/3 and http:// alone', 'a // comment, 1..2/3 and http:// alone'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('finds a secret however its name and its value are written', () => {
    // An escaped quote, `=>`, a value of several words, a dotted name and a
    // name holding `sessid` each kept the secret.
    const cases: readonly [string, string][] = [
      ['{\\"password\\":\\"hunter2\\"}', '{<redacted>}'],
      ['{"password" => "hunter2"}', '{<redacted>}'],
      ['passphrase: correct horse battery staple', '<redacted>'],
      ['connect.sid=s%3AabcDEF123', '<redacted>'],
      ['x.auth=user:pass', '<redacted>'],
      ['PHPSESSID=abc123', '<redacted>'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('removes inline data from a location field, whether names are kept or not', () => {
    // Read as a location, the address's last segment was its base64 body, and
    // it was kept on the user's instruction.
    for (const keepFileNames of [false, true]) {
      const { record: cleaned } = redactOne(
        record({ fields: { file: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10' } }),
        keepFileNames,
      );
      expect(cleaned.fields['file']).toBe('<data>');
    }
  });

  it('removes an e-mail address, which names a person, and leaves a stack frame whole', () => {
    // An address was kept whole, and no later phase owns redaction to remove
    // it.
    const { record: cleaned, summary } = redactOne(
      record({
        message: 'Shared with jane.smith+audio@example.co.uk by mistake',
        stack: { frames: ['decode@https://app.example/assets/index-1a2b.js:3:14'] },
      }),
    );
    expect(cleaned.message).toBe('Shared with <email> by mistake');
    expect(summary.counts['email-address']).toBe(1);
    expect(cleaned.stack?.frames).toEqual(['decode@<url>']);
  });

  it('knows the shapes of more keys, a key cut short, and more kinds of file', () => {
    const cases: readonly [string, string][] = [
      [
        '-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF\n-----END PGP PRIVATE KEY BLOCK-----',
        '<redacted>',
      ],
      ['sent -----BEGIN RSA PRIVATE KEY-----\nMIIEow', 'sent <redacted>'],
      [`pypi-${'A'.repeat(60)}`, '<redacted>'],
      [`shpat_${'a'.repeat(32)}`, '<redacted>'],
      [`dop_v1_${'a'.repeat(64)}`, '<redacted>'],
      [`glrt-${'A'.repeat(20)}`, '<redacted>'],
      [`123456789:AA${'B'.repeat(33)}`, '<redacted>'],
      ['Could not import: Jane Smith Mix.logicx', 'Could not import: <file>'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });
});

describe('a secret, an address and a name, in the forms a log writes them', () => {
  const redacted = (message: string, keepFileNames = false): string =>
    redactOne(record({ message }), keepFileNames).record.message;

  it('removes the whole of a value whose own text holds `=` or `:`', () => {
    // A name given a value inside the value, `token: dGVzdA==` read as
    // `dGVzdA=`, ended it where it began, and the secret was kept whole.
    const cases: readonly [string, string][] = [
      ['token: dGVzdA==', '<redacted>'],
      ['credentials: jane:hunter2', '<redacted>'],
      ['api_key: QWxhZGRpbjpvcGVuIHNlc2FtZQ==', '<redacted>'],
      ['password: admin=1', '<redacted>'],
      ['passphrase: correct horse battery:staple', '<redacted>'],
      ['SECRET_KEY=abc and private_key=def', '<redacted> <redacted>'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('reads a name that starts with a hyphen, an underscore or a dollar sign', () => {
    const cases: readonly [string, string][] = [
      ['--password=hunter2', '<redacted>'],
      ['--api-key=abc', '<redacted>'],
      ['{"_token":"abc"}', '{<redacted>}'],
      ['__RequestVerificationToken=abc', '<redacted>'],
      ['{"$password":"x"}', '{<redacted>}'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('ends a quoted value at the quote that ends it, past an apostrophe or an escaped quote', () => {
    const cases: readonly [string, string][] = [
      ["password: 'O'Brien1'", '<redacted>'],
      ['{"password":"ab\\"cd"}', '{<redacted>}'],
      ["password='pa\\'ss'", '<redacted>'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('knows more names a secret goes by', () => {
    const cases: readonly [string, string][] = [
      ['AccountName=x;AccountKey=abc==', 'AccountName=x;<redacted>'],
      ['Ocp-Apim-Subscription-Key: abc123', '<redacted>'],
      ['SharedAccessSignature=sv=2020&sig=abc', '<redacted>&<redacted>'],
      ['Private-Lines: AAAA', '<redacted>'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('keeps a folder named with a hash out of the name kept from a location field', () => {
    // The fragment was taken off a path, and `Jane Smith ` became the kept name.
    const { record: kept } = redactOne(
      record({ fields: { filePath: 'C:\\Clients\\Jane Smith #2\\take.wav' } }),
      true,
    );
    expect(kept.fields['filePath']).toBe('<path>/take.wav');
  });

  it('reads an address without its query before taking its last segment', () => {
    expect(redacted('Fetched https://cdn.example/a/take.wav?next=/profile/jane.smith', true)).toBe(
      'Fetched <url>/take.wav',
    );
  });

  it('removes a share address whole, spaces and all, in text and in a location field', () => {
    // Read as an address, it ended at its first space.
    expect(redacted('Could not mount smb://NAS/Clients/Jane Smith/take.wav', true)).toBe(
      'Could not mount <path>/take.wav',
    );
    for (const keepFileNames of [false, true]) {
      const { record: cleaned } = redactOne(
        record({
          fields: {
            sourcePath: 'smb://NAS/Clients/Jane Smith/Private',
            file: 'data:text/plain,Jane Smith notes',
          },
        }),
        keepFileNames,
      );
      // `Private` is a folder, not a file, so nothing of it is kept even when
      // the user asked for file names.
      expect(cleaned.fields).toEqual({ sourcePath: '<path>', file: '<data>' });
    }
  });

  it('removes an e-mail address in any script, with a port, and inside a path', () => {
    const cases: readonly [string, string][] = [
      ['Sent to jane.müller@example.de today', 'Sent to <email> today'],
      ['Sent to zoë@example.com', 'Sent to <email>'],
      ['Could not connect to jane@mail.example.com:587', 'Could not connect to <email>:587'],
      ['Opened C:\\Users\\jane.smith@corp.com\\Clients\\Jane Smith\\notes', 'Opened <path>'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('reads a long run of dots or hyphens in time in proportion to the text', () => {
    // An address, an e-mail and an assignment could each start from every dot.
    const dotted = 'a.'.repeat(50_000);
    const hyphenated = 'a-'.repeat(50_000);

    const started = performance.now();
    redacted(dotted);
    redacted(hyphenated);

    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
  });

  it('pairs a double quote in a name as the other quotes pair, and leaves a possessive alone', () => {
    const cases: readonly [string, string][] = [
      ['Could not decode Jane "Mimi" Smith.wav', '<file>'],
      ["Opened: Jane 'Mimi' Smith.wav's header", "Opened: <file>'s header"],
      ['{"file":"Jane Smith.wav"}', '{"file":"<file>"}'],
    ];
    for (const [message, expected] of cases) expect(redacted(message)).toBe(expected);
  });

  it('knows more kinds of file a game or a tracker is made of', () => {
    for (const extension of [
      'res',
      'scn',
      'pck',
      'wem',
      'bnk',
      'bank',
      'fsb',
      'xm',
      'mod',
      'it',
      's3m',
      'mpg',
      'wmv',
      '3gp',
    ]) {
      expect(redacted(`Imported: Jane Smith.${extension}`)).toBe('Imported: <file>');
    }
  });
});

describe('credential redaction', () => {
  it('removes a credential that carries its own shape, with nothing to label it', () => {
    // The three patterns all needed a label: `Bearer `, an assignment, or
    // basic authentication in a URL. A token quoted in a sentence carried none
    // of them and went into the report whole.
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
    const { record: redacted } = redactOne(record({ message: `Rejected token ${token}` }));

    // Whole: asked only for the header's absence, a rule that kept the claims
    // would pass.
    expect(redacted.message).toBe('Rejected token <redacted>');
  });

  it('removes a vendor key by its prefix', () => {
    // Whole, not by absence: a rule that took a prefix and left the rest would
    // pass a test that only asked for the whole key to be gone.
    for (const key of [
      'ghp_0123456789abcdefghijABCDEFG',
      'AKIAIOSFODNN7EXAMPLE',
      'ASIAIOSFODNN7EXAMPLE',
      // Stripe writes the prefix with an underscore, which the rule missed.
      'sk_live_ABCDEFGHIJKLMNOP1234',
      // OpenAI's project keys and Anthropic's carry a second prefix.
      'sk-proj-AbCdEfGhIjKlMnOpQrStUvWx',
      'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx',
      'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q',
      // Ending in a hyphen, which the closing word boundary refused.
      'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6-',
      'glpat-ABCDEFGHIJKLMNOPQRST',
      'npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    ]) {
      const { record: redacted } = redactOne(record({ message: `Using ${key} to sign in.` }));
      expect(redacted.message).toBe('Using <redacted> to sign in.');
    }
  });

  it('removes an authorization code, a licence key, a one-time code and a recovery phrase', () => {
    // Each is authentication data, and none held a word the lists read: an
    // OAuth code exchanges for a token, and `licenseKey`, `productKey` and
    // `key` end with a word no list had. The OAuth code is read by the name it
    // is really written with rather than by the word `code` at the end of any
    // name, which took a command's own outcome code with it.
    for (const secret of [
      'authorization_code=4/0AVMBsJh8sTQxSecretAuthCode',
      'authCode=4/0AVMBsJh8sTQxSecretAuthCode',
      'licenseKey=ABCD-1234-EFGH-5678',
      'productKey: XXXXX-YYYYY-ZZZZZ',
      'key=s3cr3tvaluehere',
      'otp=123456',
      'pin=4821',
      'userPin=4821',
      // A one-time code written as one word. Split into `pin` and `code`, the
      // last word is `code`, which is deliberately read at the end of no name,
      // and neither list held the joined form.
      'pinCode=4821',
      'pin_code=4821',
      'seedPhrase=abandon abandon ability',
      'seedWords=abandon abandon ability',
      'seed=abandon abandon ability',
      'recoverySeed=abandon abandon ability',
      'hdSeed=abandon abandon ability',
      'recoveryPhrase=abandon abandon ability',
      'walletSeed=abandon abandon ability',
      'masterSeed=abandon abandon ability',
      // A recovery phrase named after the ordinary `randomSeed` it begins
      // with: the ordinary name holds the start of `seedphrase` and not the
      // whole of it.
      'randomSeedPhrase=abandon abandon ability',
      'randomSeedWords=abandon abandon ability',
      'refresh=1//0gAbCdEfGhIjKl',
    ]) {
      expect(redactOne(record({ message: secret })).record.message).toBe('<redacted>');
    }

    // A bare `Basic` line, which a failed fetch and a pasted transcript print
    // without the header name the rule below reaches it by.
    expect(
      redactOne(record({ message: 'Basic amFuZTpodW50ZXIy was refused' })).record.message,
    ).toBe('<redacted> was refused');
  });

  it("leaves an audio editor's own words alone, which the widened lists could take", () => {
    // Read anywhere in a name, `key` and `code` would take the vocabulary with
    // them.
    for (const kept of [
      'keySignature=C sharp minor',
      'the codec is opus',
      'codePoint=65 for A',
      'keyboard=Dvorak',
      'a passBand of 200 Hz',
      'highPassFilter=on',
      'sessionCount=3',
      'decode=true',
      'barcode=12345',
    ]) {
      expect(redactOne(record({ message: kept })).record.message).toBe(kept);
    }

    // And the converse, which the change that widened the lists left untested:
    // a name that *ends* in one of the words read at the end of a name. `code`
    // is one this application logs on every command that finds nothing to do,
    // so a report of a session with no secret in it claimed a credential was
    // removed, and `keyCode` is a browser's own. The other four are the shape
    // rather than the field: nothing in this tree writes one today, and the
    // rule has to keep them whole the day something does.
    for (const kept of [
      'code=diagnostics.level-already-set',
      'outcomeCode=workspace.no-active-panel',
      'keyCode=KeyK',
      'refreshRate=120',
      'randomSeed=48271',
      'pinPosition=3',
    ]) {
      expect(redactOne(record({ message: kept })).record.message).toBe(kept);
    }

    // Where the line falls over `seed`, written down rather than left to be
    // found. A bare `seed=` is how a wallet's recovery phrase is written, and
    // it goes with every name that ends in the word; the number a generator
    // starts from is written `randomSeed`, which is named whole and kept.
    //
    // No rule here reads a value's shape, so the name decides.
    expect(redactOne(record({ message: 'seed=abandon abandon ability' })).record.message).toBe(
      '<redacted>',
    );
    expect(redactOne(record({ message: 'randomSeed=48271' })).record.message).toBe(
      'randomSeed=48271',
    );
  });

  /**
   * Every field name this repository passes to a logger.
   *
   * Held to the tree by the architecture rule "logs no field name redaction
   * would take for a secret", which reads each call on a name ending `logger`,
   * at a method the interface offers, whose fields are written out in place,
   * and compares their names with these. Written out here because this package
   * reads no other package's source.
   */
  const LOGGED_FIELD_NAMES = [
    'browser',
    'capability',
    'code',
    'colours',
    'commandCount',
    'commandId',
    'contextFrame',
    'count',
    'description',
    'detail',
    'event',
    'expected',
    'failure',
    'firstFailure',
    'firstProblem',
    'found',
    'frames',
    'kind',
    'latencyHint',
    'losses',
    'missing',
    'node',
    'operatingSystem',
    'parameter',
    'part',
    'position',
    'reason',
    'reasons',
    'recoveries',
    'renderer',
    'replaced',
    'required',
    'sampleRate',
    'state',
    'storedVersion',
    'text',
    'thisVersion',
    'worstRatio',
  ];

  it('leaves every field name this application logs alone', () => {
    // The lists are kept narrow to protect the vocabulary the tree itself
    // writes, and nothing read the tree to check. `code` was widened into a
    // secret while the command registry logged a field of that name, so the
    // one record that says why a command did nothing said nothing at all.
    for (const name of LOGGED_FIELD_NAMES) {
      expect([name, redactOne(record({ message: `${name}=x` })).record.message]).toEqual([
        name,
        `${name}=x`,
      ]);
    }
  });

  it('reads a header before the credential inside it, so the sentence after it is kept', () => {
    // The header takes a scheme and its value. With the value already a
    // placeholder, it read the placeholder as the scheme and took the next
    // word of the sentence as the value.
    expect(
      redactOne(record({ message: 'Authorization: Basic QWxhZGRpbjpvcGVu== sent' })).record.message,
    ).toBe('<redacted> sent');
    expect(
      redactOne(record({ message: 'Authorization: Bearer abcdef123 sent' })).record.message,
    ).toBe('<redacted> sent');
  });

  it('removes a credential named in text, with an underscore before its name or in a header', () => {
    // An underscore is part of a word, so `access_token=` had no word boundary
    // before `token` and was kept whole, and no rule read a header at all.
    const cases: readonly [string, string][] = [
      // A value without quotes runs to the end of its clause.
      ['OAuth refused: access_token=ya29.a0AfH6SMBx expired', 'OAuth refused: <redacted>'],
      ['client_secret=abcdef123456, rejected', '<redacted>, rejected'],
      ['client_secret=abcdef123456 was rejected', '<redacted>'],
      ['Cookie: SID=31d4d96e407aad42', '<redacted>'],
      ['Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ== sent', '<redacted> sent'],
    ];
    for (const [message, expected] of cases) {
      expect(redactOne(record({ message })).record.message).toBe(expected);
    }
  });

  it('keeps no query string on an address whose name the user chose to keep', () => {
    const { record: redacted } = redactOne(
      record({ message: 'GET https://api.example.com/v1/take.wav?access_token=ya29.a0AfH6SMBx' }),
      true,
    );

    expect(redacted.message).toBe('GET <url>/take.wav');
  });

  it('keeps the last segment of an address only where it names a file', () => {
    // A segment that names no file is a folder, an account or an endpoint, and
    // the user asked for file names, not for the rest of the address.
    const { record: redacted } = redactOne(
      record({ message: 'GET https://api.example.com/v1/users/jane.smith' }),
      true,
    );

    expect(redacted.message).toBe('GET <url>');
  });

  it('removes a token whose signature is short or empty, because the claims come first', () => {
    // A token signed with `none` has an empty third segment, and the claims a
    // token carries, a subject or an address, are in the second.
    const { record: redacted } = redactOne(
      record({
        message:
          'Rejected eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0. and eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.abc and eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImphbmVAZXhhbXBsZS5jb20ifQ',
      }),
    );

    // The last is cut short before its second dot, and its claims hold an
    // address.
    expect(redacted.message).toBe('Rejected <redacted> and <redacted> and <redacted>');
  });

  it('leaves ordinary words alone, whatever they start with', () => {
    const { record: redacted } = redactOne(
      record({ message: 'The skip button and the pkg folder are fine.' }),
    );

    expect(redacted.message).toBe('The skip button and the pkg folder are fine.');
  });
});

describe('file name redaction', () => {
  it('removes a bare file name, which has no path to give it away', () => {
    const { record: redacted, summary } = redactOne(
      record({ message: 'Could not decode take-3.wav, so it was skipped.' }),
    );
    expect(redacted.message).toBe('<file>, so it was skipped.');
    expect(summary.counts['file-name']).toBe(1);
  });

  it('keeps a bare file name when the user asked for file names', () => {
    const { record: redacted, summary } = redactOne(
      record({ message: 'Could not decode take-3.wav, so it was skipped.' }),
      true,
    );
    expect(redacted.message).toBe('Could not decode take-3.wav, so it was skipped.');
    expect(redactionRemovedSomething(summary)).toBe(false);
  });

  it('removes the folders of a relative path in prose and keeps the name only on request', () => {
    const text = 'Imported: clients/acme/take.wav.';
    expect(redactOne(record({ message: text })).record.message).toBe('Imported: <path>.');
    expect(redactOne(record({ message: text }), true).record.message).toBe(
      'Imported: <path>/take.wav.',
    );
    // Without the colon the verb reads as part of the name and goes with it.
    const prose = 'Imported clients/acme/take.wav.';
    expect(redactOne(record({ message: prose })).record.message).toBe('<path>.');
    expect(redactOne(record({ message: prose }), true).record.message).toBe('<path>/take.wav.');
  });

  it('does not remove the file name a path replacement kept on request', () => {
    const { record: redacted } = redactOne(
      record({ fields: { detail: 'Read /home/someone/audio/take-3.wav' } }),
      true,
    );
    expect(redacted.fields['detail']).toBe('Read <path>/take-3.wav');
  });

  it('leaves the name of a source file in a stack frame, which is public', () => {
    const { record: redacted } = redactOne(
      record({ stack: { frames: ['at decodeAsset (codec.ts:41:7)'] } }),
    );
    expect(redacted.stack?.frames).toEqual(['at decodeAsset (codec.ts:41:7)']);
  });

  it.each([
    ['path', 'notes/drafts', '<path>'],
    ['filePath', 'Session notes', '<file>'],
    ['fileName', 'Letter to my solicitor.wav', '<file>'],
    ['source_file', 'final mix', '<file>'],
    ['outputFolder', 'Clients', '<file>'],
    ['directory', 'Music', '<file>'],
  ])(
    'treats the value of a field named %s as a location whatever it looks like',
    (name, value, expected) => {
      const { record: redacted } = redactOne(record({ fields: { [name]: value } }));
      expect(redacted.fields[name]).toBe(expected);
    },
  );

  it('keeps the name in a location field on request, and nothing before it', () => {
    const { record: redacted } = redactOne(
      record({ fields: { filePath: 'clients/acme/final mix.wav' } }),
      true,
    );
    expect(redacted.fields['filePath']).toBe('<path>/final mix.wav');
  });

  it('removes a token from the query string of a name kept on request', () => {
    const { record: redacted } = redactOne(
      record({ fields: { file: 'shared/take.wav?token=abc123' } }),
      true,
    );
    // Whole: by absence alone, a rule that kept the query's name or the folder
    // would pass.
    expect(redacted.fields['file']).toBe('<path>/take.wav');
  });

  it.each([
    ['profile', 'Mine'],
    ['pathway', 'direct'],
    ['name', 'Shortcut profile'],
  ])('leaves a field named %s alone, because its last word is not a location', (name, value) => {
    const { record: redacted } = redactOne(record({ fields: { [name]: value } }));
    expect(redacted.fields[name]).toBe(value);
  });
});

describe('address and inline data redaction', () => {
  it('removes a data: address, which can carry a whole recording', () => {
    const { record: redacted, summary } = redactOne(
      record({ fields: { source: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEA' } }),
    );
    expect(redacted.fields['source']).toBe('<data>');
    expect(summary.counts['embedded-data']).toBe(1);
  });

  it('leaves the word "data" followed by a colon in prose alone', () => {
    const { record: redacted } = redactOne(record({ message: 'Read the data: 3 frames.' }));
    expect(redacted.message).toBe('Read the data: 3 frames.');
  });

  it('removes a blob: address, which names the page and an object the user opened', () => {
    const { record: redacted } = redactOne(
      record({ fields: { source: 'blob:https://audiogubbins.test/0b9d-4c2e' } }),
    );
    expect(redacted.fields['source']).toBe('<url>');
  });

  it('removes a secret in JSON written inside JSON, and reads its backslashes as escapes', () => {
    // Escaped twice, the name was not read and the secret was kept, and each
    // backslash pair before a quote was taken for a share and wrapped the
    // words around it in placeholders.
    const twice = String.raw`{\\\"password\\\":\\\"hunter2\\\"}`;
    const redacted = redactOne(record({ message: twice })).record.message;
    expect(redacted).toBe('{<redacted>}');

    const noSecret = String.raw`{\\\"panel\\\":\\\"editor\\\"}`;
    expect(redactOne(record({ message: noSecret })).record.message).toBe(noSecret);
  });

  it('finds a path written straight after an ellipsis', () => {
    // A dot before the drive letter stopped the root, and the account's name
    // went into the report.
    expect(
      redactOne(record({ message: 'Saving...C:\\Users\\jane\\Documents' })).record.message,
    ).toBe('Saving...<path>');
  });

  it('redacts the same text the same way however many times it is asked', () => {
    // The patterns are shared between calls. A global pattern used through
    // `test` or `exec` would carry its position into the next call and skip the
    // start of the next string; `replace` resets it, and this holds it to that.
    const text = 'Could not read /home/someone/a.wav; take.wav.';
    const first = redactOne(record({ message: text })).record.message;
    const second = redactOne(record({ message: text })).record.message;
    expect(second).toBe(first);
    expect(first).toBe('Could not read <path>; <file>.');
    const prose = 'Could not read /home/someone/a.wav or take.wav.';
    expect(redactOne(record({ message: prose })).record.message).toBe(
      'Could not read <path> <file>.',
    );
    expect(redactOne(record({ message: prose })).record.message).toBe(
      'Could not read <path> <file>.',
    );
  });
});

describe('every string a record carries is redacted', () => {
  it('redacts a category that was built from a path', () => {
    const { record: redacted } = redactOne(record({ category: 'import /home/someone/take.wav' }));
    expect(redacted.category).toBe('import <path>');
  });

  it('redacts an operation identifier that was built from a file name', () => {
    const { record: redacted } = redactOne(
      record({ correlationId: 'import C:\\Users\\someone\\take.wav' }),
    );
    expect(redacted.correlationId).toBe('import <path>');
  });
});

describe('sanitiseStack', () => {
  it('keeps the frames of a Chromium stack and drops the message lines', () => {
    const stack = [
      'Error: Could not open /home/someone/take.wav',
      '    at decodeAsset (C:\\Users\\someone\\app\\codec.ts:41:7)',
      '    at async onImport (https://audiogubbins.test/assets/index-1a2b.js:3:14)',
    ].join('\n');

    expect(sanitiseStack(stack)?.frames).toEqual([
      'at decodeAsset (<path>/codec.ts:41:7)',
      'at async onImport (<url>/index-1a2b.js:3:14)',
    ]);
  });

  it('keeps the frames of a Gecko or WebKit stack', () => {
    const stack = 'decodeAsset@/home/someone/app/codec.ts:41:7\nonImport@codec.ts:12:3';
    expect(sanitiseStack(stack)?.frames).toEqual([
      'decodeAsset@<path>/codec.ts:41:7',
      'onImport@codec.ts:12:3',
    ]);
  });

  it('does not mistake an address in a message for a frame', () => {
    expect(sanitiseStack('Error: mail someone@example.com failed')).toBeUndefined();
  });

  it('has nothing to give when there is no stack', () => {
    expect(sanitiseStack(undefined)).toBeUndefined();
  });
});

describe('credential redaction', () => {
  it('removes a value whose field name says it is a secret', () => {
    const { record: redacted } = redactOne(record({ fields: { apiKey: 'abc123' } }));
    expect(redacted.fields['apiKey']).toBe('<redacted>');
  });

  it('removes a sensitively named field even when its value looks harmless', () => {
    const { record: redacted } = redactOne(record({ fields: { sessionId: 'none' } }));
    expect(redacted.fields['sessionId']).toBe('<redacted>');
  });

  it.each([
    ['password', { password: 'hunter2' }],
    ['authorization', { authorization: 'Bearer abc' }],
    ['cookie', { cookie: 'sid=1' }],
    ['accessToken', { accessToken: 'abc' }],
    ['api_key', { api_key: 'abc' }],
    ['credential', { credential: 'abc' }],
  ])('removes the %s field', (_name, fields) => {
    const { record: redacted } = redactOne(record({ fields }));
    expect(Object.values(redacted.fields)).toEqual(['<redacted>']);
  });

  it('removes a bearer token appearing in prose', () => {
    const { record: redacted } = redactOne(
      record({ message: 'Rejected with Bearer eyJhbGciOiJIUzI1NiJ9.abc' }),
    );
    expect(redacted.message).toBe('Rejected with <redacted>');
  });

  it('removes credentials embedded in a URL', () => {
    const { record: redacted } = redactOne(
      record({ fields: { endpoint: 'https://user:secret@example.com/upload' } }),
    );
    // The user name goes with the password: asked only about the password, a
    // rule that kept the rest would pass.
    expect(redacted.fields['endpoint']).toBe('<redacted>');
  });

  it('reads a field name by its words, so an ordinary name is not taken for a secret', () => {
    // Matched as substrings, `auth` took `author` and `signature` took the time
    // signature an audio editor lives by.
    const { record: redacted } = redactOne(
      record({
        fields: {
          author: 'Composer',
          authority: 'local',
          tokeniser: 'words',
          privateMode: false,
          timeSignature: '7/8',
          keySignature: 'D minor',
          apiKey: 'abc',
          privateKey: 'abc',
          sessionId: 'abc',
          authToken: 'abc',
          requestSignature: 'abc',
          // One word, an acronym, or a plural: read word by word, none of these
          // had a boundary to split on, and each was kept.
          apikey: 'abc',
          APIKey: 'abc',
          accesstoken: 'abc',
          csrftoken: 'abc',
          sessionid: 'abc',
          passwords: 'abc',
          cookies: 'abc',
          pwd: 'abc',
        },
      }),
    );

    expect(redacted.fields).toEqual({
      author: 'Composer',
      authority: 'local',
      tokeniser: 'words',
      privateMode: false,
      timeSignature: '7/8',
      keySignature: 'D minor',
      apiKey: '<redacted>',
      privateKey: '<redacted>',
      sessionId: '<redacted>',
      authToken: '<redacted>',
      requestSignature: '<redacted>',
      apikey: '<redacted>',
      APIKey: '<redacted>',
      accesstoken: '<redacted>',
      csrftoken: '<redacted>',
      sessionid: '<redacted>',
      passwords: '<redacted>',
      cookies: '<redacted>',
      pwd: '<redacted>',
    });
  });

  it('keeps two fields whose names redact to the same placeholder as two fields', () => {
    // Plain assignment kept the second and dropped the first, so the record the
    // user inspected before consenting showed one field where there were two.
    const { record: redacted } = redactOne(
      record({ fields: { 'session-a.wav': 1, 'session-b.wav': 2 } }),
    );

    expect(redacted.fields).toEqual({ '<file>': 1, '<file>#2': 2 });
  });

  it('leaves an ordinary field untouched', () => {
    const { record: redacted } = redactOne(record({ fields: { sampleRate: 48_000, ok: false } }));
    expect(redacted.fields).toEqual({ sampleRate: 48_000, ok: false });
  });
});

describe('redaction summary', () => {
  it('counts nothing for a record with nothing to remove', () => {
    const { summary } = redactOne(record({ fields: { sampleRate: 48_000 } }));
    expect(redactionRemovedSomething(summary)).toBe(false);
  });

  it('reports that something was removed, so consent can be informed', () => {
    const { summary } = redactOne(record({ fields: { path: 'C:\\Users\\someone\\a.wav' } }));
    expect(redactionRemovedSomething(summary)).toBe(true);
    expect(summary.counts['absolute-path']).toBe(1);
  });

  it('accumulates across every record in the batch', () => {
    const result = redactRecords([
      record({ fields: { path: '/home/someone/a.wav' } }),
      record({ fields: { path: '/home/someone/b.wav' } }),
    ]);
    const summary: RedactionSummary = result.summary;
    expect(summary.counts['absolute-path']).toBe(2);
  });
});

describe('redaction preserves diagnostic value', () => {
  it('keeps the timestamp, severity, category and correlation identifier', () => {
    const original = record({
      correlationId: 'op-1',
      fields: { path: '/home/someone/a.wav' },
    });
    const { record: redacted } = redactOne(original);
    expect(redacted.timestamp).toBe(original.timestamp);
    expect(redacted.severity).toBe(original.severity);
    expect(redacted.category).toBe(original.category);
    expect(redacted.correlationId).toBe('op-1');
  });

  it('keeps the field present rather than dropping it', () => {
    const { record: redacted } = redactOne(record({ fields: { path: '/home/someone/a.wav' } }));
    expect(Object.keys(redacted.fields)).toEqual(['path']);
  });

  it('returns an empty batch unchanged', () => {
    const result = redactRecords([]);
    expect(result.records).toEqual([]);
    expect(redactionRemovedSomething(result.summary)).toBe(false);
  });
});

describe('a network address', () => {
  const redacted = (message: string): string => redactOne(record({ message })).record.message;

  it('removes an address written in prose, whichever family it is', () => {
    // A machine reached through a path was removed and the same machine named
    // on its own was not, while the consent label promises the browser and the
    // operating system without any machine name.
    expect(redacted('Server at 10.0.0.42 refused the connection')).toBe(
      'Server at <address> refused the connection',
    );
    expect(redacted('Could not reach 192.168.1.50:8080')).toBe('Could not reach <address>');
    expect(redacted('Host fe80::1c2d:3e4f:5a6b:7c8d refused')).toBe('Host <address> refused');
    expect(redacted('Bound to 2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('Bound to <address>');
    expect(redacted('Listening on ::1')).toBe('Listening on <address>');
  });

  it.each([
    [
      'a browser version',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    ],
    ['a time of day', 'Started at 09:22:48 and again at 1:2:3'],
    ['a scope in a message', 'std::vector overflowed while reading'],
    ['a stack frame', 'at Object.run (index-1a2b.js:3:14)'],
  ])('keeps %s, which is not an address', (_what, message) => {
    // Every one of these is four numbers in range, or groups of hexadecimal
    // digits with colons between them, and a report is full of them.
    expect(redacted(message)).toBe(message);
  });

  it('removes the machine a field names, whatever the name looks like', () => {
    // A host name has no shape a text pattern can find: `nas.local`,
    // `JANES-PC` and `studio-imac` are words.
    const { record: cleaned } = redactOne(
      record({
        fields: { host: 'janes-pc.local', ip: '10.0.0.4', serverName: 'STUDIO-IMAC' },
      }),
    );

    expect(cleaned.fields).toEqual({
      host: '<address>',
      ip: '<address>',
      serverName: '<address>',
    });
  });

  it('counts what it removed, so the report says an address went', () => {
    const { summary } = redactOne(record({ message: 'Server at 10.0.0.42 refused' }));

    expect(summary.counts['network-address']).toBe(1);
  });
});

describe('a secret written where a name cannot begin a run', () => {
  const redacted = (message: string, keepFileNames = false): string =>
    redactOne(record({ message }), keepFileNames).record.message;

  it('removes a secret named after a dot that follows a character no name holds', () => {
    // A name could begin only where a run of name characters began, and a dot
    // was refused before one, so every form below was kept whole.
    expect(redacted('users[0].password=hunter2')).toBe('users[0]<redacted>');
    expect(redacted('user?.password = "hunter2"')).toBe('user?<redacted>');
    expect(redacted('2.token=abc')).toBe('<redacted>');
    expect(redacted('Error:...password=hunter2')).toBe('Error:<redacted>');
  });

  it('removes credentials in an address written after an ellipsis', () => {
    expect(redacted('Retrying (2/3)...postgres://admin:hunter2@localhost:5432/app')).toBe(
      'Retrying (2/3)<redacted>',
    );
    expect(redacted('Connecting...postgres://admin:hunter2@localhost:5432/app')).toBe('<redacted>');
  });

  it('removes a web address written after an ellipsis', () => {
    expect(redacted('Error: ...https://x.example/users/jane.smith/profile')).toBe('Error: <url>');
  });

  it('removes a share address written after an ellipsis', () => {
    expect(redacted('Retrying (2/3)...sftp://host/Clients/Jane Smith/take.wav', true)).toBe(
      'Retrying (2/3)<path>/take.wav',
    );
  });

  it('reads a run of backslashes, of colons and of hyphens once each', () => {
    // Each was a start of its own: the assignment rule read the whole run from
    // every backslash, the address rule split a run of colons every way, and
    // the token rule started at every hyphen before a `J`.
    const started = performance.now();
    redacted('\\'.repeat(100_000));
    redacted(`a://${':'.repeat(100_000)}`);
    redacted('eyJ-'.repeat(25_000));

    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
  });

  it('reads a run of dollar signs and of plus signs once each', () => {
    // A run could begin with either, and a rule's lookbehind refused neither,
    // so each was a start of its own: a hundred thousand dollar signs took ten
    // seconds.
    const started = performance.now();
    redacted('$'.repeat(100_000));
    redacted('+'.repeat(100_000));
    redacted('$.'.repeat(50_000));

    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
  });

  it(
    'reads a line of values that each open a quote and never close it once',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      // Each value was read to the end of its line to look for its closing
      // quote, so the line was read once for every value on it. This text costs
      // two to three times what prose does, and read again for each value,
      // about two hundred times.
      expect(costAgainstProse(redacted, 'password="x '.repeat(4_000))).toBeLessThan(20);
    },
  );

  it('reads a line whose values each open a quote one backslash deeper once', () => {
    // The memo that stops a line being read again holds one entry per quote and
    // depth, so a line that opened each value deeper than the last beat it once
    // per depth. This text is 5.2 MB and took 13.2 s; it takes about a tenth of
    // a second now, which is some eighteen times inside the limit. Building the
    // text is itself several hundred milliseconds of string concatenation, so
    // the clock starts after it: timed with it, the assertion would measure the
    // fixture as much as the rules.
    let text = '';
    for (let depth = 1; depth <= 3200; depth += 1) text += ` password:${'\\'.repeat(depth)}"x`;

    const started = performance.now();
    redacted(text);

    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
  });

  it(
    'reads a line of letter-and-colon pairs once, not once a pair',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      // The drive-relative root looks ahead for the backslash that would make
      // `C:Users\\Jane Smith` a path. Written over a segment, which may hold a
      // colon, the lookahead ran to the end of the line at every `letter:` and
      // backtracked over it, and in a line of `a:` pairs every `a` is a start:
      // 800 kB took nearly two minutes, with no root anywhere in it. The export
      // dialogue redacts the reader's note on the main thread as they type.
      // This text costs four to six times what prose does, and with the
      // lookahead run to the end of the line at every pair, some two hundred.
      expect(costAgainstProse(redacted, 'a:'.repeat(20_000))).toBeLessThan(30);
    },
  );

  it('reads a key header that never closes once', { timeout: LONGEST_COST_TEST_MS }, () => {
    // Held as a ratio rather than a time: at sixteen thousand repeats the
    // unbounded form would finish inside the time limit on a fast machine, and
    // a time would need forty thousand to fail at all, a number tuned to one
    // machine's speed. The ratio is not: this text costs about what prose does,
    // and with the header unbounded, a hundred times as much.
    expect(costAgainstProse(redacted, `-----BEGIN ${'PRIVATE KEY '.repeat(10_000)}`)).toBeLessThan(
      10,
    );
  });

  it('reads inline data with many parameters and no body in time', () => {
    // A parameter could hold the semicolon that starts the next one, so a run
    // of them with no comma after it was split every way: forty semicolons did
    // not finish in five minutes.
    const started = performance.now();
    redacted(`data:${';'.repeat(10_000)}`);

    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
  });
});

describe('what a redaction leaves of a secret, a location and a name', () => {
  const redacted = (message: string, keepFileNames = false): string =>
    redactOne(record({ message }), keepFileNames).record.message;

  it('keeps no part of a secret whose value holds a mark that can end a clause', () => {
    // Every clause mark can be a character of a password, and each ended the
    // value: `Tr0ub4dor&3` kept `&3` and `ab;cd` kept `;cd`.
    expect(redacted('--password=Tr0ub4dor&3')).toBe('<redacted>');
    expect(redacted('Password=ab;cd')).toBe('<redacted>');
  });

  it('ends a value at a mark that separates it from the next name given a value', () => {
    expect(redacted('SharedAccessSignature=sv=2020&sig=abc')).toBe('<redacted>&<redacted>');
    expect(redacted('Failed: password=abc, retrying in 5s')).toBe(
      'Failed: <redacted>, retrying in 5s',
    );
  });

  it('keeps no tail of a secret whose quote is escaped twice over', () => {
    // A backslash pair writes a backslash of the value, and the quote after it
    // is inside the value: read as the closing quote, it kept `ter2\\"`.
    expect(redacted('{\\"password\\":\\"hun\\\\\\"ter2\\"}')).toBe('{<redacted>}');
  });

  it('keeps no body of inline data written with spaces in it', () => {
    expect(redacted('data:text/plain,Jane Smith notes')).toBe('<data>');
  });

  it('keeps a last segment only where it names a file', () => {
    // An account folder and a folder at the end of a share are not names to
    // keep, and a path inside an address's query is not the address's name.
    expect(redacted('Could not open C:\\Users\\Jane Smith', true)).toBe('Could not open <path>');
    expect(redacted('Fetched sftp://host/a/take.wav?next=/home/jane.smith', true)).toBe(
      'Fetched <path>/take.wav',
    );
  });

  it('keeps a stack frame readable when the user asked for file names', () => {
    expect(redacted('at onImport (https://app.example/assets/index-1a2b.js:3:14)', true)).toBe(
      'at onImport (<url>/index-1a2b.js:3:14)',
    );
  });

  it('removes an address with credentials and no path from a location field', () => {
    // The last segment of such an address is its authority, and it was kept as
    // though it were a file's name, password and all.
    const { record: kept } = redactOne(
      record({
        fields: {
          location: 'https://admin:hunter2@localhost:8080',
          sourcePath: 'sftp://admin:hunter2@nas',
        },
      }),
      true,
    );

    expect(kept.fields).toEqual({ location: '<url>', sourcePath: '<path>' });
  });

  it('removes an e-mail address in a location field, and one a file kind ends', () => {
    // A name with an address straight after it is the address's local part:
    // read as a name, it left the domain standing after the placeholder.
    for (const keepFileNames of [false, true]) {
      const { record: kept } = redactOne(
        record({
          message: 'Sent to jane.mp3@example.com',
          fields: { location: 'jane.smith@example.com' },
        }),
        keepFileNames,
      );

      expect(kept.message).toBe('Sent to <email>');
      expect(kept.fields['location']).toBe('<email>');
    }
  });

  it('knows a secret a name ends with, and file kinds an audio editor meets', () => {
    expect(redacted('DB_PASS=hunter2')).toBe('<redacted>');
    expect(redacted('laravel_session=eyJpdiI6IkZabc')).toBe('<redacted>');
    expect(redacted('Imported: Jane Smith.aaf')).toBe('Imported: <file>');
    expect(redacted('Imported: Jane Smith.7z')).toBe('Imported: <file>');
    expect(redacted('Imported: Jane Smith.mpeg')).toBe('Imported: <file>');
  });

  it("leaves an audio editor's own vocabulary alone", () => {
    const { record: kept } = redactOne(
      record({ fields: { highPassFilter: 'on', sessionCount: '3' } }),
    );

    expect(kept.fields).toEqual({ highPassFilter: 'on', sessionCount: '3' });
  });

  it('removes a home directory written with a tilde or a variable', () => {
    // A tilde home is a whole local path once the shell expands it, and it is
    // what a shell error, a failed open and a traceback print. The rule fired
    // for `~/Music`, which names nobody, and not for `~jane/Music`, which
    // names the person.
    expect(redacted('Saved to ~jane/Documents/Session notes')).toBe('Saved to <path>');
    expect(redacted('Saved to ~/Music/Recordings/take one')).toBe('Saved to <path>');
    expect(redacted('Saved to $HOME/Music/Jane Smith Interview')).toBe('Saved to <path>');
    expect(redacted('Saved to ${HOME}/Music/Jane Smith')).toBe('Saved to <path>');
    expect(redacted('Saved to %USERPROFILE%\\Music\\Jane Smith Interview')).toBe('Saved to <path>');
    expect(redacted('Saved to %APPDATA%\\AudioGubbins\\state')).toBe('Saved to <path>');
    // A drive with no separator after it is a path relative to that drive.
    expect(redacted('Saved to C:Users\\Jane Smith\\Private')).toBe('Saved to <path>');
  });

  it('leaves an approximate count and a ratio alone, which a home root could read', () => {
    // `~` before a number is how a count is written as approximate, and a
    // letter, a colon and a segment is how a ratio and a label are written.
    for (const kept of [
      'about ~50/60 frames were dropped',
      'roughly ~2/3 of the buffer',
      'the ratio A:B/C is fixed',
      'see item b:2/3 of the list',
      'home is where $HOME is',
    ]) {
      expect(redacted(kept)).toBe(kept);
    }
  });

  it('removes a file-transfer address with credentials to where its path ends', () => {
    // A file-transfer path holds spaces exactly as a share's does, so it ends
    // where a path ends rather than at its first white space. Ended at a
    // space, the surname and the folder were left after the placeholder.
    for (const scheme of ['ftp', 'ftps']) {
      expect(redacted(`Copying ${scheme}://jane:pw@host/Clients/Jane Smith/Private notes`)).toBe(
        'Copying <redacted>',
      );
    }
  });

  it('removes a share address with credentials to where its path ends', () => {
    // Ended at its first space, the address left the rest of its path after
    // the placeholder, and the path rules never saw it.
    for (const keepFileNames of [false, true]) {
      expect(
        redacted('Copying sftp://jane:pw@nas/Clients/Jane Smith/Private notes', keepFileNames),
      ).toBe('Copying <redacted>');
      expect(
        redacted('smb://WORKGROUP;jane:pw@NAS/Users/Jane Smith/Documents', keepFileNames),
      ).toBe('<redacted>');
    }
    expect(redacted('Sent to https://jane:pw@x.example/upload and then retried')).toBe(
      'Sent to <redacted> and then retried',
    );
  });

  it('removes credentials in an address with no scheme it can read', () => {
    expect(redacted('Tried 1234://admin:hunter2@host/app')).toBe('Tried 1234<redacted>');
  });

  it('removes an address, a path or credentials written straight after an underscore', () => {
    expect(redacted('a_postgres://admin:hunter2@h/x')).toBe('a_<redacted>');
    expect(redacted('foo_https://x.example/users/jane.smith/profile')).toBe('foo_<url>');
    expect(redacted('cache_/home/jane.smith/Private/notes')).toBe('cache_<path>');
    expect(redacted('log_C:\\Users\\Jane Smith\\notes')).toBe('log_<path>');
  });

  it('removes an e-mail address with a line and a column after it', () => {
    // Taken for a stack frame, it was kept. A frame names a file AudioGubbins
    // is served as, and is still kept.
    expect(redacted('JANE@EXAMPLE.COM:1:2')).toBe('<email>:1:2');
    expect(redacted('onImport@codec.ts:12:3')).toBe('onImport@codec.ts:12:3');
  });

  it('removes a secret given its value by an escaped equals sign', () => {
    expect(redacted('Redirected with client_secret%3Dhunter2')).toBe('Redirected with <redacted>');
  });

  it('removes the whole name of a file in quotes that holds a quote of its own', () => {
    // Read from the last quote that could open it, the name left `Jane `
    // standing before the placeholder.
    expect(redacted('Opened "Jane "Mimi.wav"')).toBe('Opened "<file>"');
    expect(redacted('Said "go" then opened "Take.wav"')).toBe('Said "go" then opened "<file>"');
  });
});
