import { describe, expect, it, vi } from 'vitest';

import { FailureKind, failure, fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { PageFile } from '@audiogubbins/storage-runtime';
import { sine, wavFile } from '@audiogubbins/test-fixtures';

import { holdPlatformFiles } from '../testing/project-audio.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import {
  ImportBatches,
  ONE_AT_A_TIME,
  type ImportBatchState,
  type ImportCodecs,
  type ImportTarget,
} from './import-batches.js';

holdPlatformFiles();

/** A file the person chose, of `bytes`. */
function chosen(bytes: Uint8Array<ArrayBuffer>, name: string): PageFile {
  return {
    bytes: { kind: 'file', file: new File([bytes], name) },
    fileName: name,
    mediaType: '',
    lastModified: 11,
  };
}

const TONE = wavFile(sine(440, { length: 4_800 }));
const NOTES = new TextEncoder().encode('Not a sound at all.');

const NO_WORKER = failure(
  'codecs.worker-unavailable',
  FailureKind.Retryable,
  'The codec worker could not be started.',
);

/** Codecs whose readiness the test settles, counting each time they are asked. */
class HeldCodecs implements ImportCodecs {
  asked = 0;
  #settle: ((result: DomainResult<void>) => void) | undefined;

  readonly ready = (): Promise<DomainResult<void>> => {
    this.asked += 1;
    return new Promise((settle) => {
      this.#settle = settle;
    });
  };

  settle(result: DomainResult<void>): void {
    this.#settle?.(result);
  }
}

/**
 * A window with a project open to change, and its batches made over its own
 * storage worker's imports, whose every request is recorded, with `codecs`
 * and the files `batches` the person chooses in turn.
 */
async function scene(
  codecs: ImportCodecs,
  batches: (readonly PageFile[])[] = [],
): Promise<{
  readonly window: ProjectWindow;
  readonly imports: ImportBatches;
  readonly asked: ReturnType<typeof vi.spyOn>;
  readonly states: ImportBatchState[];
  readonly target: () => ImportTarget;
}> {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const client = window.services.client.imports;
  const asked = vi.spyOn(client, 'importFiles');
  const imports = new ImportBatches(
    client,
    {
      chooseMediaFiles: () => Promise.resolve(batches.shift() ?? []),
      chooseMediaFolder: () => Promise.resolve(batches.shift() ?? []),
    },
    window.projects.project,
    window.projects.preferences,
  );
  const states: ImportBatchState[] = [];
  imports.subscribe(() => states.push(imports.get()));
  const target = () => {
    const session = window.projects.project.session();
    if (session === undefined) throw new Error('No project is open to change.');
    return { session, ids: window.context.ids, clock: window.context.clock, codecs };
  };
  return { window, imports, asked, states, target };
}

function assetNames(window: ProjectWindow): readonly string[] {
  const session = window.projects.project.session();
  return [...(session?.getSnapshot().model.state.project.assets.values() ?? [])].map(
    (asset) => asset.displayName,
  );
}

describe('a batch of files imported into the open project (ADR-0090)', () => {
  it('lists every file at once, readies the codecs before the storage is asked, and shows the job the storage reports', async () => {
    const codecs = new HeldCodecs();
    const { window, imports, asked, states, target } = await scene(codecs, [
      [chosen(TONE, 'One.wav'), chosen(NOTES, 'notes.txt'), chosen(TONE, 'Two.wav')],
    ]);

    const work = imports.importFiles(target());
    await vi.waitFor(() => {
      expect(codecs.asked).toBe(1);
    });
    const listed = imports.get();
    expect(listed.kind === 'importing' && listed.job.entries).toEqual([
      { file: { name: 'One.wav', bytes: TONE.length }, state: { kind: 'queued' } },
      { file: { name: 'notes.txt', bytes: NOTES.length }, state: { kind: 'queued' } },
      { file: { name: 'Two.wav', bytes: TONE.length }, state: { kind: 'queued' } },
    ]);
    expect(asked).not.toHaveBeenCalled();
    codecs.settle(succeed(undefined));

    const outcome = await work;
    if (!outcome.ok || outcome.value.kind !== 'ended') throw new Error('The import did not end.');
    const { batch, codecsUnready } = outcome.value;
    expect(codecsUnready).toBeUndefined();
    expect(batch.outcomes.map((one) => one.kind)).toEqual(['imported', 'refused', 'imported']);
    // A refusal stops nothing, and the files arrive in the order chosen.
    expect(assetNames(window)).toEqual(['One', 'Two']);
    // Each format is the storage's own analysis, carried by the job it reports.
    expect(batch.job.entries.map((entry) => entry.format)).toEqual([
      { kind: 'audio', container: 'wav', codec: { kind: 'named', codec: 'pcm' } },
      undefined,
      { kind: 'audio', container: 'wav', codec: { kind: 'named', codec: 'pcm' } },
    ]);
    const refused = batch.job.entries[1]?.state;
    expect(refused?.kind === 'refused' && refused.failure.summary).toMatch(
      /not in an audio format/u,
    );
    // The page showed the storage's reports as they came, then the batch as it ended.
    expect(
      states.some(
        (state) => state.kind === 'importing' && state.job.entries[0]?.state.kind === 'analysing',
      ),
    ).toBe(true);
    expect(imports.get()).toEqual({ kind: 'ended', batch, codecsUnready: undefined });
  });

  it('runs the batch where the codecs cannot be made ready, and says why', async () => {
    const codecs = new HeldCodecs();
    const { window, imports, target } = await scene(codecs, [[chosen(TONE, 'One.wav')]]);

    const work = imports.importFiles(target());
    await vi.waitFor(() => {
      expect(codecs.asked).toBe(1);
    });
    codecs.settle(fail(NO_WORKER));

    const outcome = await work;
    expect(outcome.ok && outcome.value.kind === 'ended' && outcome.value.codecsUnready).toBe(
      NO_WORKER,
    );
    expect(assetNames(window)).toEqual(['One']);
  });

  it('keeps nothing and asks the storage nothing where the import is cancelled while the codecs start', async () => {
    const codecs = new HeldCodecs();
    const { window, imports, asked, target } = await scene(codecs, [
      [chosen(TONE, 'One.wav'), chosen(TONE, 'Two.wav')],
    ]);

    const work = imports.importFiles(target());
    await vi.waitFor(() => {
      expect(codecs.asked).toBe(1);
    });
    expect(imports.cancel()).toBe(true);
    codecs.settle(succeed(undefined));

    const outcome = await work;
    if (!outcome.ok || outcome.value.kind !== 'ended') throw new Error('The import did not end.');
    expect(outcome.value.batch.job.entries.map((entry) => entry.state)).toEqual([
      { kind: 'cancelled', stage: 'queued' },
      { kind: 'cancelled', stage: 'queued' },
    ]);
    expect(outcome.value.batch.outcomes).toEqual([{ kind: 'cancelled' }, { kind: 'cancelled' }]);
    expect(asked).not.toHaveBeenCalled();
    expect(assetNames(window)).toEqual([]);
    expect(imports.cancel()).toBe(false);
  });

  it('refuses a second batch while one runs, before any chooser opens', async () => {
    const codecs = new HeldCodecs();
    const { imports, target } = await scene(codecs, [
      [chosen(TONE, 'One.wav')],
      [chosen(TONE, 'Two.wav')],
    ]);

    const work = imports.importFiles(target());
    await vi.waitFor(() => {
      expect(codecs.asked).toBe(1);
    });
    expect(await imports.importChosen(target(), [chosen(TONE, 'Two.wav')])).toEqual(
      fail(ONE_AT_A_TIME),
    );
    expect(await imports.importFolder(target())).toEqual(fail(ONE_AT_A_TIME));
    codecs.settle(succeed(undefined));
    await work;

    // The refused folder's chooser never opened, so its answer is the next one's.
    const later = imports.importFolder(target());
    await vi.waitFor(() => {
      expect(codecs.asked).toBe(2);
    });
    codecs.settle(succeed(undefined));
    const ended = await later;
    expect(
      ended.ok && ended.value.kind === 'ended' && ended.value.batch.job.entries[0]?.file.name,
    ).toBe('Two.wav');
  });

  it('brings nothing in and asks nothing where the person dismisses the chooser', async () => {
    const codecs = new HeldCodecs();
    const { imports, asked, target } = await scene(codecs);

    expect(await imports.importFolder(target())).toEqual(succeed({ kind: 'dismissed' }));
    expect(codecs.asked).toBe(0);
    expect(asked).not.toHaveBeenCalled();
    expect(imports.get()).toEqual({ kind: 'idle' });
  });

  it('keeps an ended batch listed until it is cleared, or its project is let go', async () => {
    const { window, imports, target } = await scene(
      { ready: () => Promise.resolve(succeed(undefined)) },
      [[chosen(TONE, 'One.wav')], [chosen(TONE, 'Two.wav')]],
    );

    await imports.importFiles(target());
    expect(imports.get().kind).toBe('ended');
    expect(imports.clear()).toBe(true);
    expect(imports.get().kind).toBe('idle');
    expect(imports.clear()).toBe(false);

    await imports.importFiles(target());
    expect(imports.get().kind).toBe('ended');
    await window.runAndHear('file.close-project');
    expect(imports.get().kind).toBe('idle');
  });
});
