import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FailureKind, failure } from '@audiogubbins/domain';
import type { ImportJob } from '@audiogubbins/import-export';

import { ImportList } from './import-list.js';

const NOT_AUDIO = failure(
  'codecs.unrecognised',
  FailureKind.Rejected,
  'This file is not in an audio format AudioGubbins recognises.',
);

/** A batch part-way through: one file imported, one decoding, one copying, one refused, one queued. */
const JOB: ImportJob = {
  entries: [
    {
      file: { name: 'Step.wav', bytes: 96_044 },
      state: { kind: 'imported' },
      format: { kind: 'audio', container: 'wav', codec: { kind: 'named', codec: 'pcm' } },
      room: { kind: 'known', bytes: 96_044 },
    },
    {
      file: { name: 'Rain.ogg', bytes: 412_000 },
      state: { kind: 'decoding', framesDecoded: 24_000, framesTotal: 96_000 },
      format: { kind: 'audio', container: 'ogg', codec: { kind: 'named', codec: 'vorbis' } },
      room: { kind: 'known', bytes: 1_180_058 },
    },
    {
      file: { name: 'Wind.m4a', bytes: 2_048 },
      state: { kind: 'copying', bytesCopied: 1_024, bytesTotal: 2_048 },
      format: { kind: 'audio', container: 'mp4', codec: { kind: 'unstated' } },
      room: { kind: 'unknown', atLeast: 2_048 },
    },
    {
      file: { name: 'notes.txt', bytes: 19 },
      state: { kind: 'refused', stage: 'analysing', failure: NOT_AUDIO },
    },
    { file: { name: 'Hum.wav', bytes: 5_000 }, state: { kind: 'queued' } },
  ],
};

/** Each row's name and facts, as a screen reader meets them. */
function rows(): readonly string[] {
  const list = screen.getByRole('list', { name: 'Files being imported' });
  return within(list)
    .getAllByRole('listitem')
    .map((row) => row.textContent);
}

describe('the list of files being imported (ADR-0090, REQ-UX-005)', () => {
  it('lists each file with its size, format, storage needed and stage, and a named bar for a measured stage', () => {
    render(<ImportList job={JOB} ended={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('Importing 5 files.');
    expect(rows()).toEqual([
      'Step.wavImportedSize93.8 kBFormatWAV, uncompressed PCMStorage needed93.8 kB',
      'Rain.oggDecoding · 24,000 frames decoded of 96,000Size402.3 kBFormatOgg, VorbisStorage needed1.1 MB',
      'Wind.m4aCopying into the project · 1 kB of 2 kB copiedSize2 kBFormatMPEG-4Storage neededAt least 2 kB: its stream does not state its length, so its decoded audio cannot be sized',
      'notes.txtRefused: This file is not in an audio format AudioGubbins recognises.Size19 bytesFormatNot recognisedStorage neededNone: nothing of it was stored',
      'Hum.wavWaiting its turnSize4.9 kBFormatNot known yetStorage neededNot known yet',
    ]);
    const decoding = screen.getByRole('progressbar', { name: 'Import of Rain.ogg' });
    // The bar counts to a hundred: a quarter of the frames is decoded.
    expect(decoding).toHaveAttribute('aria-valuemax', '100');
    expect(decoding).toHaveAttribute('aria-valuenow', '25');
    expect(decoding).toHaveAttribute('aria-valuetext', '24,000 frames decoded of 96,000');
    expect(screen.getByRole('progressbar', { name: 'Import of Wind.m4a' })).toHaveAttribute(
      'aria-valuetext',
      '1 kB of 2 kB copied',
    );
    // The batch's spinner is decoration beside its words, not a third bar.
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('says a linked file needs no storage, and a linked stream of no stated length an unknown amount', () => {
    const linked: ImportJob = {
      entries: [
        {
          file: { name: 'Step.wav', bytes: 96_044 },
          state: { kind: 'adding' },
          room: { kind: 'known', bytes: 0 },
        },
        {
          file: { name: 'Rain.ogg', bytes: 412_000 },
          state: { kind: 'decoding', framesDecoded: 0, framesTotal: undefined },
          room: { kind: 'unknown', atLeast: 0 },
        },
      ],
    };
    render(<ImportList job={linked} ended={false} />);
    const [step, rain] = rows();
    expect(step).toMatch(/Storage neededNone$/u);
    expect(rain).toMatch(
      /Storage neededNot known: its stream does not state its length, so its decoded audio cannot be sized$/u,
    );
  });

  it('holds the bar unmeasured where a stream states no length', () => {
    const unstated: ImportJob = {
      entries: [
        {
          file: { name: 'Rain.ogg', bytes: 412_000 },
          state: { kind: 'decoding', framesDecoded: 4_800, framesTotal: undefined },
        },
      ],
    };
    render(<ImportList job={unstated} ended={false} />);

    const bar = screen.getByRole('progressbar', { name: 'Import of Rain.ogg' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    // An unmeasured bar has no value to word, so its file's row says how far it has got.
    expect(rows()).toEqual([
      'Rain.oggDecoding · 4,800 frames decodedSize402.3 kBFormatNot recognisedStorage neededNone: nothing of it was stored',
    ]);
  });

  it('says what the batch came to once it ended, in a status there before', () => {
    const { rerender } = render(<ImportList job={undefined} ended={false} />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(screen.queryByRole('list')).toBeNull();

    const ended: ImportJob = {
      entries: [
        { file: { name: 'Step.wav', bytes: 1 }, state: { kind: 'imported' } },
        {
          file: { name: 'notes.txt', bytes: 1 },
          state: { kind: 'refused', stage: 'analysing', failure: NOT_AUDIO },
        },
        { file: { name: 'Hum.wav', bytes: 1 }, state: { kind: 'cancelled', stage: 'queued' } },
      ],
    };
    rerender(<ImportList job={ended} ended />);

    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent(
      'The import ended: 1 of 3 files imported, 1 refused, 1 cancelled.',
    );
  });
});
