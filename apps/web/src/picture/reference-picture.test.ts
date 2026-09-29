import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { StandardFrameRates } from '@audiogubbins/timeline';

import { testAssets } from '../assets/test-assets.js';
import { fakeEditor, fakePicturePlatform } from '../testing/editor-fakes.js';
import { createStateStorage } from '../state/state-storage.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { pictureSoundAsset } from './picture-sound.js';
import { ReferencePicture } from './reference-picture.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('editor');
const [TONES] = expectSuccess(testAssets());
if (TONES === undefined) throw new Error('No test asset.');

/** A picture of ten seconds at 25 frames a second, bound to the tone bursts from their start. */
function openPicture() {
  const { picture } = fakeEditor(
    createStateStorage(ephemeralStorage(), logger, () => undefined),
    logger,
  );
  picture.open(new File([], 'reference.webm'), TONES);
  picture.element.dispatchEvent(new Event('loadedmetadata'));
  return picture;
}

/**
 * A picture over an element whose browser says when each frame is presented,
 * counted at 30 frames a second, whose frames a WebM stamps in whole
 * milliseconds.
 */
function announcingPicture() {
  const platform = fakePicturePlatform(true);
  const picture = new ReferencePicture({ platform, logger });
  picture.open(new File([], 'reference.webm'), TONES);
  picture.element.dispatchEvent(new Event('loadedmetadata'));
  picture.interpretAt(StandardFrameRates.thirty);
  return { picture, platform };
}

describe('the reference picture (ADR-0046)', () => {
  it('shows exactly the frame that holds a parked position', () => {
    const picture = openPicture();

    // 50,000 frames at 48 kHz is 1.0417 seconds: frame 26, whose middle is 1.06 s.
    picture.follow(50_000, 'parked');

    expect(picture.element.currentTime).toBeCloseTo(1.06, 9);
    expect(picture.element.paused).toBe(true);
  });

  it('plays beside a moving transport, and leaves a picture within a frame alone', () => {
    const picture = openPicture();
    picture.element.currentTime = 2.02;

    picture.follow(96_000, 'playing');

    expect(picture.element.paused).toBe(false);
    expect(picture.element.currentTime).toBe(2.02);
  });

  it('seeks a playing picture that has drifted by more than a frame', () => {
    const picture = openPicture();
    picture.element.currentTime = 2.2;

    picture.follow(96_000, 'playing');

    expect(picture.element.currentTime).toBe(2);
  });

  it('moves the picture by a frame, and lines a frame up with the playhead', () => {
    const picture = openPicture();

    picture.nudge(1);
    expect(picture.get().binding?.offset).toBe(1920);
    picture.alignWith(5000);
    // The frame shown at 5,000 is the second (1,920 to 3,840 before), which starts there now.
    expect(picture.get().binding?.offset).toBe(5000 - 1920);
  });

  it('moves a parked picture back a frame from one stamped just before its start', () => {
    const { picture, platform } = announcingPicture();

    // Frame 4 starts at 6,400 and is stamped 0.133 s rather than 0.1333.
    picture.follow(6400, 'parked');
    platform.frames.present(0.133);
    picture.follow(6400, 'parked');
    expect(platform.seeks).toEqual([4.5 / 30]);

    // 5,280 is in frame 3.
    picture.follow(5280, 'parked');
    expect(platform.seeks).toEqual([4.5 / 30, 3.5 / 30]);
  });

  it('leaves a playing picture alone while it shows the frame that should show', () => {
    const { picture, platform } = announcingPicture();
    picture.element.currentTime = 0.14;
    platform.frames.present(0.133);

    // 7,997 is 0.1666 s, late in frame 4.
    picture.follow(7997, 'playing');

    expect(platform.seeks).toEqual([0.14]);
  });

  it('sends a parked picture to a frame once, whatever frame the file shows there', () => {
    const { picture, platform } = announcingPicture();

    picture.follow(6400, 'parked');
    picture.element.dispatchEvent(new Event('seeked'));
    // A file at another rate than it is counted at has no frame starting in
    // frame 4, and shows frame 3 there.
    platform.frames.present(0.1);
    picture.follow(6400, 'parked');

    expect(platform.seeks).toEqual([4.5 / 30]);
  });

  it('keeps one chain of frame callbacks however many pictures are opened, and none once closed', () => {
    const { picture, platform } = announcingPicture();
    for (const name of ['second.webm', 'third.webm']) {
      picture.open(new File([], name), TONES);
      platform.frames.present(0);
    }

    expect(platform.frames.waiting).toBe(1);
    picture.close();
    expect(platform.frames.waiting).toBe(0);
  });

  it('says a file the browser cannot decode, and lets go of it', () => {
    const picture = openPicture();
    Object.defineProperty(picture.element, 'error', { value: { code: 3 } });
    picture.element.dispatchEvent(new Event('error'));

    expect(picture.get().media).toMatchObject({
      kind: 'undecodable',
      reason: 'The browser could not decode this video.',
    });
    expect(picture.get().binding).toBeUndefined();
    expect(picture.filmstrip).toBeUndefined();
  });
});

describe("a picture's sound", () => {
  it('becomes an asset of the channels the browser decoded, at the rate it was asked for', () => {
    const asset = pictureSoundAsset(new File([new Uint8Array(4)], 'shot.webm'), {
      channels: [new Float32Array([0, 0.5]), new Float32Array([0, -0.5])],
    });
    if (typeof asset === 'string') throw new Error(asset);

    expect(asset).toMatchObject({ name: 'Sound of shot.webm', length: 2, sampleRate: 48_000 });
    expect(asset.layout.roles).toEqual(['left', 'right']);
    // Each description is a copy, since its arrays are transferred away.
    const one = asset.describe();
    const other = asset.describe();
    expect(
      one.kind === 'pcm' && other.kind === 'pcm' && one.channels[0] !== other.channels[0],
    ).toBe(true);
  });

  it('is none for a picture without sound', () => {
    expect(pictureSoundAsset(new File([], 'silent.webm'), { channels: [] })).toBe(
      'The picture has no sound.',
    );
  });
});
