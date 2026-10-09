import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { CommandInvocation } from '@audiogubbins/commands';
import { FailureKind, failure } from '@audiogubbins/domain';
import {
  nobleTextSha256,
  refOf,
  type AvailabilityContext,
  type InstallState,
  type LocalInferenceSupport,
  type ModelPackManifest,
} from '@audiogubbins/model-packs';
import { sampleManifest } from '@audiogubbins/model-packs/testing';
import { PINNED_RUNTIME_SHA256 } from '@audiogubbins/processors';
import { sine } from '@audiogubbins/test-fixtures';

import type { KnownAvailability } from '../../ml/model-availability.js';
import type { PackManagerState, PackManagerView } from '../../ml/pack-manager.js';
import { observable, type MutableObservable, type Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import {
  holdPlatformFiles,
  rackedWithDeepFilterNet,
  windowWithAudio,
} from '../../testing/project-audio.js';
import { PackManagerPanel, type PackManagerParts } from './pack-manager-panel.js';

holdPlatformFiles();

/**
 * The Model packs panel (REQ-AUDIO-139): every pack offered and kept, with
 * what the requirement asks the manager to show of each, the installer's state
 * as it changes, the requirement's conditions named as it names them, and each
 * step a pack command.
 */

const RUNTIME = {
  name: 'onnxruntime-web',
  version: '1.30.0',
  webAssemblySha256: PINNED_RUNTIME_SHA256,
};

const FULL: LocalInferenceSupport = {
  status: 'full',
  explanation: '',
  missingRequired: [],
  missingPreferred: [],
};

const NO_SIMD_PREFERRED: LocalInferenceSupport = {
  status: 'reduced',
  explanation: 'Previews run on one thread.',
  missingRequired: [],
  missingPreferred: [{ key: 'webassembly-simd', reason: 'This browser has no fixed-width SIMD.' }],
};

function pack(
  id: string,
  name: string,
  options: Omit<Parameters<typeof sampleManifest>[0] & object, 'id'> = {},
): ModelPackManifest {
  return { ...sampleManifest({ id, processors: [id], ...options }), name };
}

const DENOISER = pack('denoiser', 'Denoiser');
const DENOISER_NEXT = pack('denoiser', 'Denoiser', { version: '1.1.0' });
const SEPARATOR = pack('separator', 'Separator');
const SEPARATOR_NEXT = pack('separator', 'Separator', { version: '1.1.0' });
const SPLITTER = pack('splitter', 'Splitter');
const SIMD_ONLY = pack('gpu-pack', 'Fast enhancer', {
  runtime: { capabilities: ['webassembly-simd'] },
});
const LATER_RUNTIME = pack('later', 'Later model', {
  runtime: { minimum: '2.0.0', below: '3.0.0' },
});

type Ran = (readonly [string, CommandInvocation['arguments']])[];

const NONE_OPEN = observable<OpenProjectState>({ kind: 'none' });

/** What availability is known to be, with nothing kept, on `device`. */
function known(device: LocalInferenceSupport = FULL): MutableObservable<KnownAvailability> {
  const context: AvailabilityContext = {
    packs: [],
    catalogue: [],
    runtime: RUNTIME,
    device,
    sha256: nobleTextSha256,
  };
  return observable<KnownAvailability>({ kind: 'known', context });
}

/** The manager's state with `offered` read from the catalogue and `kept` in their states. */
function stateOf(
  offered: readonly ModelPackManifest[],
  kept: readonly (readonly [ModelPackManifest, InstallState])[] = [],
  needed: ReadonlyMap<string, string> = new Map(),
): PackManagerState {
  return {
    installations: kept.map(([manifest, state]) => ({ ref: refOf(manifest), manifest, state })),
    loaded: true,
    catalogue: { kind: 'read', packs: offered },
    needed,
  };
}

/** Draws the panel over a manager in `state`, its commands recorded rather than run. */
function panelOver(
  state: PackManagerState,
  options: {
    readonly availability?: Observable<KnownAvailability>;
    readonly project?: Observable<OpenProjectState>;
    readonly unavailable?: string;
  } = {},
): { readonly ran: Ran; readonly manager: MutableObservable<PackManagerState> } {
  const ran: Ran = [];
  const manager = observable(state);
  const view: PackManagerView = {
    get: manager.get,
    subscribe: manager.subscribe,
    unavailable: options.unavailable,
    availability: options.availability ?? known(),
  };
  render(
    <PackManagerPanel
      title="Model packs"
      parts={{ packs: view, project: options.project ?? NONE_OPEN }}
      commands={{
        run: (id, args) => {
          ran.push([id, args]);
        },
        unavailableReason: () => undefined,
      }}
    />,
  );
  return { ran, manager };
}

function row(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

describe('the Model packs panel', { timeout: 30_000 }, () => {
  it('reads the manager and cannot change a pack, which it does only by a command', () => {
    expectTypeOf<Omit<PackManagerParts['packs'], 'unavailable' | 'availability'>>().toEqualTypeOf<
      Observable<PackManagerState>
    >();
  });

  it('shows each pack offered or kept with its name, purpose, version, sizes, integrity, licence, compatibility and tier', () => {
    panelOver(stateOf([DENOISER, SEPARATOR], [[DENOISER, { kind: 'installed' }]]));

    const denoiser = row('Denoiser 1.0.0');
    expect(denoiser).toHaveTextContent('Removes noise from a test signal.');
    expect(denoiser).toHaveTextContent('Download size8 bytes');
    expect(denoiser).toHaveTextContent('Installed size8 bytes');
    expect(denoiser).toHaveTextContent(
      'IntegrityEvery file matched its SHA-256 when it was installed, and is checked again as it is read.',
    );
    expect(denoiser).toHaveTextContent('LicenceCode MIT; weights Apache-2.0');
    expect(denoiser).toHaveTextContent(
      'Compatibilityonnxruntime-web from 1.30.0, below 2.0.0, with WebAssembly SIMD',
    );
    expect(denoiser).toHaveTextContent(
      'Model tierBalanced: between speed and the most thorough result. The model’s own; it is the same at every render and preview quality.',
    );
    expect(denoiser).toHaveTextContent('Installed, every file checked against its SHA-256');
    expect(row('Separator 1.0.0')).toHaveTextContent('Not installed');
  });

  it('says each tier as the model’s speed and result, in no quality level’s words', () => {
    const tiers = [
      ['light', 'Light: quick to run, with a lighter result'],
      ['balanced', 'Balanced: between speed and the most thorough result'],
      ['thorough', 'Thorough: the slowest to run, with the most thorough result'],
    ] as const;
    const packs = tiers.map(([tier]) => pack(tier, `Pack ${tier}`, { tier }));
    panelOver(stateOf(packs, []));

    for (const [tier, words] of tiers) {
      const facts = row(`Pack ${tier} 1.0.0`);
      expect(facts).toHaveTextContent(`Model tier${words}.`);
      // A tier is no render mode, so none is shown as a quality a person sets.
      expect(facts).not.toHaveTextContent(/Quality tiers|\b(Draft|Standard|High|Maximum)\b/u);
    }
  });

  it('offers each step its state allows, with a download’s progress, each running its command', async () => {
    const { ran } = panelOver(
      stateOf(
        [DENOISER, SEPARATOR, SPLITTER, SIMD_ONLY],
        [
          [DENOISER, { kind: 'downloading', received: 3, total: 8 }],
          [SEPARATOR, { kind: 'paused', received: 5, total: 8 }],
          [
            SPLITTER,
            {
              kind: 'failed',
              reason: failure(
                'model-pack.network-failed',
                FailureKind.Retryable,
                'The network went.',
              ),
              resumable: true,
              received: 2,
            },
          ],
        ],
      ),
    );

    const downloading = row('Denoiser 1.0.0');
    expect(
      within(downloading).getByRole('progressbar', { name: 'Download of Denoiser 1.0.0' }),
    ).toHaveAttribute('value', '3');
    expect(downloading).toHaveTextContent('Downloading, 3 bytes of 8 bytes');
    await userEvent.click(within(downloading).getByRole('button', { name: 'Pause' }));
    await userEvent.click(within(downloading).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(row('Separator 1.0.0')).getByRole('button', { name: 'Resume' }));
    expect(row('Splitter 1.0.0')).toHaveTextContent('Failed: The network went.');
    await userEvent.click(within(row('Splitter 1.0.0')).getByRole('button', { name: 'Retry' }));
    await userEvent.click(
      within(row('Fast enhancer 1.0.0')).getByRole('button', { name: 'Install' }),
    );

    expect(ran).toEqual([
      ['packs.pause', { id: 'denoiser', version: '1.0.0' }],
      ['packs.cancel', { id: 'denoiser', version: '1.0.0' }],
      ['packs.resume', { id: 'separator', version: '1.0.0' }],
      ['packs.retry', { id: 'splitter', version: '1.0.0' }],
      ['packs.install', { id: 'gpu-pack', version: '1.0.0' }],
    ]);
  });

  it('names REQ-AUDIO-139’s conditions as the requirement names them', () => {
    // On a device that lacks SIMD, only the pack that needs it is refused.
    const needingNothing = (one: ModelPackManifest): ModelPackManifest => ({
      ...one,
      runtime: { ...one.runtime, capabilities: [] },
    });
    panelOver(
      stateOf(
        [
          ...[DENOISER, DENOISER_NEXT, SEPARATOR, SEPARATOR_NEXT].map(needingNothing),
          SIMD_ONLY,
          needingNothing(LATER_RUNTIME),
        ],
        [[needingNothing(DENOISER), { kind: 'installed' }]],
      ),
      { availability: known(NO_SIMD_PREFERRED) },
    );

    expect(row('Denoiser 1.0.0')).toHaveTextContent('Model update available: version 1.1.0.');
    expect(row('Denoiser 1.1.0')).not.toHaveTextContent('Model update available');
    // Only a version kept is out of date: one merely offered is not.
    expect(row('Separator 1.0.0')).not.toHaveTextContent('Model update available');
    expect(row('Fast enhancer 1.0.0')).toHaveTextContent(
      'Model unavailable because of browser/device capability. This browser has no fixed-width SIMD.',
    );
    expect(row('Later model 1.0.0')).toHaveTextContent(
      'Model incompatible with current runtime. Later model 1.0.0 runs on onnxruntime-web from 2.0.0 below 3.0.0, not on onnxruntime-web 1.30.0.',
    );
  });

  it('says what the open project needs and offers to install the version that brings it', async () => {
    const audio = await windowWithAudio({ fixture: sine(440, { length: 4_800 }), name: 'Voice' });
    await rackedWithDeepFilterNet(audio);
    const offered = pack('deepfilternet-3', 'DeepFilterNet 3');
    const { ran } = panelOver(stateOf([offered]), { project: audio.window.projects.project });

    const needs = screen.getByRole('group', { name: 'What the open project needs' });
    expect(needs).toHaveTextContent(
      'DeepFilterNet 3: Required model unavailable. No pack that serves deepfilternet-3 is installed.',
    );
    await userEvent.click(
      within(needs).getByRole('button', { name: 'Install DeepFilterNet 3 1.0.0' }),
    );
    expect(ran).toEqual([['packs.install', { id: 'deepfilternet-3', version: '1.0.0' }]]);
  });

  it('says which version a project needs and offers to remove it knowingly', async () => {
    const { ran } = panelOver(
      stateOf(
        [DENOISER],
        [[DENOISER, { kind: 'installed' }]],
        new Map([
          [
            'denoiser@1.0.0',
            'A project needs denoiser@1.0.0, so it is kept until it is removed knowingly.',
          ],
        ]),
      ),
    );

    const knowingly = screen.getByRole('group', { name: 'Remove Denoiser 1.0.0 knowingly' });
    expect(knowingly).toHaveTextContent(
      'A project needs denoiser@1.0.0, so it is kept until it is removed knowingly.',
    );
    await userEvent.click(within(knowingly).getByRole('button', { name: 'Remove it anyway' }));

    expect(ran).toEqual([['packs.remove', { id: 'denoiser', version: '1.0.0', knowingly: true }]]);
  });

  it('asks the catalogue once as it is first shown, and never where no pack can be kept', () => {
    const unasked: PackManagerState = { ...stateOf([]), catalogue: { kind: 'unasked' } };
    const { ran, manager } = panelOver(unasked);
    act(() => {
      manager.set({ ...unasked, loaded: false });
    });
    expect(ran).toEqual([['packs.refresh-catalogue', undefined]]);

    const elsewhere = panelOver(unasked, { unavailable: 'This browser cannot keep model packs.' });
    expect(elsewhere.ran).toEqual([]);
  });

  it('moves a download’s own row as it progresses, every row drawn by the element it was', () => {
    const { manager } = panelOver(
      stateOf(
        [DENOISER, SEPARATOR],
        [
          [DENOISER, { kind: 'paused', received: 2, total: 8 }],
          [SEPARATOR, { kind: 'downloading', received: 1, total: 8 }],
        ],
      ),
    );
    const cancelled = row('Denoiser 1.0.0');
    const downloading = row('Separator 1.0.0');

    // The paused download cancelled, so it is listed after what is kept.
    act(() => {
      manager.set(
        stateOf(
          [DENOISER, SEPARATOR],
          [[SEPARATOR, { kind: 'downloading', received: 6, total: 8 }]],
        ),
      );
    });

    expect(row('Separator 1.0.0')).toBe(downloading);
    expect(row('Denoiser 1.0.0')).toBe(cancelled);
    expect(downloading).toHaveTextContent('Downloading, 6 bytes of 8 bytes');
    expect(cancelled).toHaveTextContent('Not installed');
  });
});
