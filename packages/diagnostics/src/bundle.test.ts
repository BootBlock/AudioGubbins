import { describe, expect, it } from 'vitest';

import { PRODUCT_VERSION, SCHEMA_VERSIONS } from '@audiogubbins/version';
import { LogSeverity, type LogRecord } from './log-record.js';
import {
  BundleContentKey,
  DEFAULT_BUNDLE_CONTENTS,
  LONGEST_NOTE,
  assembleBundle,
  describeBundleContents,
  renderBundle,
  type BundleSources,
} from './bundle.js';

const CREATED_AT = 1_700_000_000_000;

function logRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    timestamp: CREATED_AT,
    severity: LogSeverity.Error,
    category: 'storage',
    message: 'The write failed.',
    fields: {},
    ...overrides,
  };
}

function sources(overrides: Partial<BundleSources> = {}): BundleSources {
  return {
    environment: { browser: 'Firefox 141', operatingSystem: 'Windows', installed: false },
    capabilities: [
      { key: 'opfs', available: true },
      { key: 'shared-array-buffer', available: false, reason: 'Cross-origin isolation is off.' },
    ],
    degradedFeatures: [
      { featureKey: 'spectral-repair', explanation: 'Running on a single worker.' },
    ],
    logs: [logRecord()],
    performance: [
      {
        timestamp: CREATED_AT,
        category: 'renderer',
        operation: 'peaks',
        durationMs: 12,
        fields: {},
      },
    ],
    processorVersions: { 'low-pass-filter': 1 },
    ...overrides,
  };
}

describe('describeBundleContents', () => {
  it('describes every default category before the bundle is built', () => {
    const descriptions = describeBundleContents(sources(), { include: DEFAULT_BUNDLE_CONTENTS });
    expect(descriptions.map((d) => d.key)).toEqual([
      BundleContentKey.ProductVersion,
      BundleContentKey.Environment,
      BundleContentKey.Capabilities,
      BundleContentKey.DegradedFeatures,
      BundleContentKey.Logs,
      BundleContentKey.PerformanceMeasurements,
      BundleContentKey.SchemaVersions,
      BundleContentKey.ProcessorVersions,
    ]);
  });

  it('gives each category British-English text the user can read', () => {
    // Word for word: a length says only that some text is there, whatever its
    // spelling and whether a reader could follow it.
    const descriptions = describeBundleContents(sources({ reproductionNotes: 'It crashed.' }), {
      include: new Set(Object.values(BundleContentKey)),
    });
    expect(descriptions.map((description) => description.label)).toEqual([
      'The AudioGubbins version and build identifier',
      'Your browser and operating system, without any machine name',
      'Which browser capabilities this device offers',
      'Which features are running in a reduced form, and why',
      'Recent diagnostic messages, with paths, credentials and network addresses removed',
      'How long recent operations took',
      'Version numbers of the stored formats, without any content',
      'Version numbers of the audio processors in this build',
      'The notes you wrote describing what happened',
    ]);
  });

  it('says the file names are kept where the reader chose to keep them', () => {
    // The bundle's `contents` field calls itself "exactly what this bundle
    // holds, in the words the user was shown". With the toggle on, the logs
    // carry `<path>/take.wav`, and the one label said paths were removed
    // whichever way the toggle was set.
    const logsLabel = (keepFileNames: boolean): string => {
      const [described] = describeBundleContents(sources(), {
        include: new Set([BundleContentKey.Logs]),
        redaction: { keepFileNames },
      });
      // One key included is one description, so a missing one is the failure
      // to report rather than an empty string to compare against.
      if (described === undefined) throw new Error('One included key gave no description.');
      return described.label;
    };

    expect(logsLabel(false)).toContain('paths, credentials and network addresses removed');
    expect(logsLabel(false)).not.toContain('file name');
    expect(logsLabel(true)).toContain('the last part of each file name kept');

    // And the longer label is the shorter one with a clause added, rather than
    // a second sentence written out beside it: written out, the two could be
    // reworded apart and say different things about what the same bundle
    // holds, and the assertions above read each half on its own.
    expect(logsLabel(true)).toContain(logsLabel(false));
  });

  it('says how many items each countable category holds', () => {
    const descriptions = describeBundleContents(sources(), { include: DEFAULT_BUNDLE_CONTENTS });
    const logs = descriptions.find((d) => d.key === BundleContentKey.Logs);
    expect(logs?.itemCount).toBe(1);
  });

  it('omits a category the user removed', () => {
    const include = new Set([BundleContentKey.ProductVersion]);
    const descriptions = describeBundleContents(sources(), { include });
    expect(descriptions.map((d) => d.key)).toEqual([BundleContentKey.ProductVersion]);
  });

  it('never offers reproduction notes the user has not written', () => {
    const include = new Set([BundleContentKey.ReproductionNotes]);
    expect(describeBundleContents(sources(), { include })).toEqual([]);
  });

  it('offers reproduction notes once the user has written them', () => {
    const include = new Set([BundleContentKey.ReproductionNotes]);
    const descriptions = describeBundleContents(
      sources({ reproductionNotes: 'It failed on import.' }),
      { include },
    );
    expect(descriptions.map((d) => d.key)).toEqual([BundleContentKey.ReproductionNotes]);
  });
});

describe('assembleBundle', () => {
  it('keeps a capability still being asked apart from one that answered no', () => {
    // The summary is built again here rather than passed through, so a state
    // added to the source was dropped before the report existed: a report
    // exported in the first moments of a session listed a capability as
    // unavailable while the degraded features beside it, built from the same
    // registry in the same call, reported everything working. The person who
    // reads the report did not run the session.
    const bundle = assembleBundle(
      sources({
        capabilities: [
          { key: 'opfs', available: true },
          {
            key: 'web-gpu',
            available: false,
            reason: 'AudioGubbins is still asking this browser whether it can do this.',
            checking: true,
          },
        ],
      }),
      { include: DEFAULT_BUNDLE_CONTENTS },
      CREATED_AT,
    );

    expect(bundle.capabilities).toEqual([
      { key: 'opfs', available: true },
      {
        key: 'web-gpu',
        available: false,
        reason: 'AudioGubbins is still asking this browser whether it can do this.',
        checking: true,
      },
    ]);
  });

  it('records the bundle schema version and the product version', () => {
    const bundle = assembleBundle(sources(), { include: DEFAULT_BUNDLE_CONTENTS }, CREATED_AT);
    expect(bundle.schemaVersion).toBe(SCHEMA_VERSIONS.diagnosticBundle);
    expect(bundle.productVersion).toBe(PRODUCT_VERSION);
    expect(bundle.createdAt).toBe(CREATED_AT);
  });

  it('carries the same contents list the user was shown', () => {
    const selection = { include: DEFAULT_BUNDLE_CONTENTS };
    const bundle = assembleBundle(sources(), selection, CREATED_AT);
    expect(bundle.contents).toEqual(describeBundleContents(sources(), selection));
  });

  it('carries a reproduction note no longer than any anyone writes', () => {
    // Every redaction rule reads the note, and the export dialogue redacts it
    // on the main thread as the reader types, so an unbounded paste — a
    // console transcript, a `set` dump — multiplied every rule's cost by its
    // own length.
    const note = `a${'b'.repeat(20_000)}`;
    const bundle = assembleBundle(
      { ...sources(), reproductionNotes: note },
      { include: new Set([BundleContentKey.ReproductionNotes]) },
      CREATED_AT,
    );

    expect(bundle.reproductionNotes?.length).toBe(LONGEST_NOTE);
    expect(note.length).toBeGreaterThan(LONGEST_NOTE);
  });

  it('cuts a reproduction note on a whole character', () => {
    // Cut at the bound wherever it fell, a character outside the basic plane
    // left half of itself in the report.
    const note = `${'a'.repeat(LONGEST_NOTE - 1)}😀 and more`;
    const bundle = assembleBundle(
      { ...sources(), reproductionNotes: note },
      { include: new Set([BundleContentKey.ReproductionNotes]) },
      CREATED_AT,
    );

    expect(bundle.reproductionNotes).toBe('a'.repeat(LONGEST_NOTE - 1));
  });

  it('omits every category the user removed', () => {
    const bundle = assembleBundle(
      sources(),
      { include: new Set([BundleContentKey.ProductVersion]) },
      CREATED_AT,
    );
    expect(bundle.logs).toBeUndefined();
    expect(bundle.environment).toBeUndefined();
    expect(bundle.capabilities).toBeUndefined();
    expect(bundle.performance).toBeUndefined();
    expect(bundle.processorVersions).toBeUndefined();
    expect(bundle.schemaVersions).toBeUndefined();
    expect(bundle.reproductionNotes).toBeUndefined();
  });

  it('holds nothing beyond the declared categories', () => {
    const bundle = assembleBundle(sources(), { include: DEFAULT_BUNDLE_CONTENTS }, CREATED_AT);
    expect(Object.keys(bundle).sort()).toEqual(
      [
        'capabilities',
        'contents',
        'createdAt',
        'degradedFeatures',
        'environment',
        'logs',
        'performance',
        'processorVersions',
        'productVersion',
        'redactionSummary',
        'schemaVersion',
        'schemaVersions',
      ].sort(),
    );
  });

  it('redacts an absolute path out of a log record', () => {
    const bundle = assembleBundle(
      sources({ logs: [logRecord({ fields: { path: 'C:\\Users\\someone\\take.wav' } })] }),
      { include: DEFAULT_BUNDLE_CONTENTS },
      CREATED_AT,
    );
    expect(bundle.logs?.[0]?.fields['path']).toBe('<path>');
    expect(bundle.redactionSummary.counts['absolute-path']).toBe(1);
  });

  it('redacts the reproduction notes the user typed, which often quote a path', () => {
    const bundle = assembleBundle(
      sources({ reproductionNotes: 'Importing C:\\Users\\someone\\take.wav crashed it.' }),
      { include: new Set([...DEFAULT_BUNDLE_CONTENTS, BundleContentKey.ReproductionNotes]) },
      CREATED_AT,
    );
    expect(bundle.reproductionNotes).toBe('Importing <path> crashed it.');
  });

  it('redacts a capability reason and a degraded-feature explanation', () => {
    const bundle = assembleBundle(
      sources({
        capabilities: [{ key: 'opfs', available: false, reason: 'Denied at /home/someone/x' }],
        degradedFeatures: [{ featureKey: 'f', explanation: 'Missing /home/someone/model.bin' }],
      }),
      { include: DEFAULT_BUNDLE_CONTENTS },
      CREATED_AT,
    );
    expect(bundle.capabilities?.[0]?.reason).toBe('Denied at <path>');
    expect(bundle.degradedFeatures?.[0]?.explanation).toBe('Missing <path>');
  });

  it('redacts the name, subsystem and operation of a performance measurement', () => {
    // Copied through verbatim before, so a measurement named after the file it
    // timed carried the file's full path into a bundle the user was told had
    // its paths removed.
    const bundle = assembleBundle(
      sources({
        performance: [
          {
            timestamp: CREATED_AT,
            category: 'import /home/someone/take.wav',
            operation: 'decode C:\\Users\\someone\\take.wav',
            durationMs: 12,
            fields: {},
            correlationId: 'import: take-3.wav',
          },
          {
            timestamp: CREATED_AT,
            category: 'import',
            operation: 'decode',
            durationMs: 12,
            fields: {},
            // Written as prose, the verb before the name goes with it.
            correlationId: 'import take-3.wav',
          },
        ],
      }),
      { include: DEFAULT_BUNDLE_CONTENTS },
      CREATED_AT,
    );
    expect(bundle.performance?.[0]).toMatchObject({
      category: 'import <path>',
      operation: 'decode <path>',
      correlationId: 'import: <file>',
    });
    expect(bundle.performance?.[1]).toMatchObject({ correlationId: '<file>' });
  });

  it('reports a clean bundle as having had nothing removed', () => {
    const bundle = assembleBundle(sources(), { include: DEFAULT_BUNDLE_CONTENTS }, CREATED_AT);
    expect(Object.values(bundle.redactionSummary.counts).every((n) => n === 0)).toBe(true);
  });

  it('includes the schema versions without any project content', () => {
    const bundle = assembleBundle(sources(), { include: DEFAULT_BUNDLE_CONTENTS }, CREATED_AT);
    expect(bundle.schemaVersions).toEqual(SCHEMA_VERSIONS);
  });
});

describe('renderBundle', () => {
  it('produces readable JSON, because the point is that the user can read it', () => {
    const bundle = assembleBundle(sources(), { include: DEFAULT_BUNDLE_CONTENTS }, CREATED_AT);
    const text = renderBundle(bundle);

    expect(text).toContain('\n  "productVersion"');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ productVersion: PRODUCT_VERSION });
  });
});
