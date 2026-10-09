import { describe, expect, it } from 'vitest';

import { FailureKind, failure } from '../result.js';
import { QualityLevel, namedQualityMode } from '../processing/quality-mode.js';
import {
  bytesAt,
  countAt,
  floatsAt,
  frameRangeAt,
  itemsAt,
  numberOf,
  oneOf,
  qualityModeAt,
  readMessage,
  type MessageFields,
} from './message-fields.js';
import { domainFailuresAt } from './failure-fields.js';

/** The failure a malformed message is read as, or nothing where it was read. */
function refusalOf(value: unknown, read: (fields: MessageFields) => unknown) {
  const result = readMessage(value, 'test.malformed', read);
  return result.ok ? undefined : result.failures[0];
}

describe("the one reader of a message's fields", () => {
  it('names the first wrong field by its path in the message', () => {
    const refusal = refusalOf({ gains: [0.5, 'loud', 'louder'] }, (fields) =>
      itemsAt(fields, 'gains', numberOf),
    );
    expect(refusal).toMatchObject({
      code: 'test.malformed',
      kind: FailureKind.Rejected,
      summary: "The message's gains[1] is not a finite number.",
      details: { field: 'gains[1]' },
    });
  });

  it('refuses a message that is no object, a count that is no whole number and a kind it does not have', () => {
    expect(refusalOf([1], () => undefined)?.summary).toBe(
      "The message's body is not an object with named fields.",
    );
    expect(refusalOf({ frames: 1.5 }, (fields) => countAt(fields, 'frames'))?.summary).toBe(
      "The message's frames is not a whole number, zero or more.",
    );
    expect(
      refusalOf({ kind: 'shout' }, (fields) => oneOf(fields, 'kind', { Say: 'say' } as const))
        ?.summary,
    ).toBe("The message's kind is not one of say.");
  });

  it('takes typed arrays only in memory of their own, which can be moved, whatever realm made them', () => {
    expect(refusalOf({ data: new Float32Array(2) }, (fields) => floatsAt(fields, 'data'))).toBe(
      undefined,
    );
    expect(
      refusalOf({ data: new Float32Array(new SharedArrayBuffer(8)) }, (fields) =>
        floatsAt(fields, 'data'),
      )?.summary,
    ).toBe("The message's data is not 32-bit floats in memory of their own.");
    expect(
      refusalOf({ data: new Float64Array(2) }, (fields) => floatsAt(fields, 'data')),
    ).toBeDefined();
    expect(
      refusalOf({ model: new Uint8Array(new SharedArrayBuffer(4)) }, (fields) =>
        bytesAt(fields, 'model'),
      ),
    ).toBeDefined();
  });

  it('reads a range only where it ends at or after its start', () => {
    expect(frameRangeAt({ range: { start: 2, end: 5 } }, 'range')).toEqual({ start: 2, end: 5 });
    expect(
      refusalOf({ range: { start: 5, end: 2 } }, (fields) => frameRangeAt(fields, 'range'))
        ?.summary,
    ).toBe("The message's range is not a range that ends at or after its start.");
  });

  it('reads a quality mode in its one form, its level taken from its settings, never the message', () => {
    const draft = namedQualityMode(QualityLevel.Draft);
    // A level that disagrees with the settings beside it cannot arrive.
    expect(
      qualityModeAt(
        { quality: { level: QualityLevel.Maximum, settings: draft.settings } },
        'quality',
      ),
    ).toEqual(draft);
    // The settings alone are the other shape a mode once crossed in.
    expect(
      refusalOf({ quality: draft.settings }, (fields) => qualityModeAt(fields, 'quality'))?.summary,
    ).toBe("The message's quality is not a quality mode.");
  });

  it('reads failures whole, with their details and the failure they arose from', () => {
    const cause = failure('inference.cancelled', FailureKind.Rejected, 'It was cancelled.');
    const whole = failure('inference.run-failed', FailureKind.Unrecoverable, 'It failed.', {
      details: { node: 'add', rank: 2, fatal: true },
      cause,
    });
    expect(domainFailuresAt(structuredClone({ failures: [whole] }), 'failures')).toEqual([whole]);
    expect(
      refusalOf({ failures: [] }, (fields) => domainFailuresAt(fields, 'failures'))?.summary,
    ).toBe("The message's failures is not a list of at least one.");
    expect(
      refusalOf({ failures: [{ ...whole, details: { node: ['add'] } }] }, (fields) =>
        domainFailuresAt(fields, 'failures'),
      )?.summary,
    ).toBe("The message's failures[0].details.node is not text, a number or a flag.");
  });
});
