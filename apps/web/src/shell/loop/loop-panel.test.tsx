import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RegionId } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import { sine } from '@audiogubbins/test-fixtures';

import { regionEntryId } from '../../assets/project-entry.js';
import { LOOP_PANEL } from '../../input/use-shortcuts.js';
import type { ShellContext } from '../../commands/shell-context.js';
import { panelCommandsOver } from '../../testing/command-availability.js';
import {
  holdPlatformFiles,
  windowWithAudio,
  type AudioWindow,
} from '../../testing/project-audio.js';
import { LoopPanel } from './loop-panel.js';

holdPlatformFiles();

const SEARCHING = { timeout: 120_000 };

/** Half a second of a 480 Hz sine in a region of all of it, open in a view of its own. */
async function sineRegion(): Promise<{ readonly audio: AudioWindow; readonly region: RegionId }> {
  const audio = await windowWithAudio({
    fixture: sine(480, { length: 24_000 }),
    regions: [{ name: 'Hum', start: 0, end: 24_000 }],
  });
  const { context } = audio.window;
  const [placed] = audio.asset().regions;
  if (placed === undefined) throw new Error('The region was not added.');
  context.editorViews.open('editor', audio.asset());
  context.editorViews.focus('editor');
  return { audio, region: placed.id };
}

/** Loops the region shown over all of it, and waits for its sound to follow. */
async function loopWhole(audio: AudioWindow, region: RegionId): Promise<void> {
  audio.window.run('region.open', { region });
  await audio.window.runAndHear('region.loop');
  await expect
    .poll(() => audio.window.context.assets.find(regionEntryId(region))?.owner, { timeout: 5000 })
    .toMatchObject({ region: { loop: { crossfadeLength: 0 } } });
}

/** Draws the panel over `context`, its controls running the shell's commands. */
function drawn(context: ShellContext): void {
  render(
    <LoopPanel
      title="Loop"
      parts={{
        editorViews: context.editorViews,
        selections: context.selections,
        assets: context.assets,
        project: context.projects?.project,
        analyses: context.loopAnalysis.analyses,
        audition: context.loopAudition,
      }}
      commands={panelCommandsOver(context)}
    />,
  );
}

describe('the Loop panel', () => {
  it('asks for a region where the editor shows none, and for a loop where it does not loop', async () => {
    const { audio, region } = await sineRegion();
    drawn(audio.window.context);

    expect(
      screen.getByText(
        'Select a region, or open one in a view of its own, to analyse its loop here.',
      ),
    ).toBeInTheDocument();
    // Its auditions' keys run only within the element so marked (`use-shortcuts.ts`).
    expect(screen.getByRole('heading', { name: 'Loop' }).closest(`[${LOOP_PANEL}]`)).not.toBeNull();
    act(() => {
      audio.window.run('region.open', { region });
    });
    expect(
      await screen.findByText(
        '“Hum” does not loop. Loop part of it first, with “Loop the selection of the region”.',
      ),
    ).toBeInTheDocument();
  });

  it(
    'analyses the loop from the keyboard, showing each check with its verdict in words, threshold and reference',
    SEARCHING,
    async () => {
      const user = userEvent.setup();
      const { audio, region } = await sineRegion();
      await loopWhole(audio, region);
      drawn(audio.window.context);

      expect(
        screen.getByText(/^It loops from .* of the region, with no crossfade\.$/),
      ).toBeInTheDocument();
      const analyse = screen.getByRole('button', { name: 'Analyse the loop' });
      analyse.focus();
      await user.keyboard('{Enter}');

      const checks = await screen.findByRole(
        'table',
        { name: 'The loop’s checks, as it is heard with its crossfade' },
        { timeout: 60_000 },
      );
      const click = within(checks).getByRole('row', { name: /^Click at the seam/ });
      expect(
        within(click)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ).toEqual([
        'Passes',
        expect.stringMatching(/ deviations$/),
        'passes at 4 deviations or less, warns to 8 deviations, fails above',
        // A whole-sound loop has nothing around it but its own end and start.
        'the loop’s own end and start',
        'Mono',
      ]);
      expect(screen.getByRole('figure', { name: /^The seam as it is heard/ })).toBeInTheDocument();
    },
  );

  it(
    'lists candidates, applies one only when asked, and shows the analysis stale once the loop moved',
    SEARCHING,
    async () => {
      const user = userEvent.setup();
      const { audio, region } = await sineRegion();
      await loopWhole(audio, region);
      drawn(audio.window.context);
      const before = audio.session.getSnapshot().model.state;

      await user.click(screen.getByRole('button', { name: 'Find better loop points' }));
      const list = await screen.findByRole(
        'heading',
        { name: 'Candidate loop points, best first' },
        { timeout: 60_000 },
      );
      expect(list).toBeInTheDocument();
      // Shown, nothing applied.
      expect(audio.session.getSnapshot().model.state).toBe(before);

      const apply = screen.getAllByRole('button', {
        name: /^Apply candidate \d+ with its crossfade$/,
      });
      const [first] = apply;
      if (first === undefined) throw new Error('No candidate offered a crossfade.');
      await user.click(first);
      await expect.poll(() => audio.session.getSnapshot().model.state).not.toBe(before);

      expect(
        await screen.findByText(
          'The region’s sound has changed since its loop was analysed, so what is shown here is of its sound as it was. Analyse it again to see its loop as it is now.',
        ),
      ).toBeInTheDocument();
    },
  );
});
