/**
 * The browser's part in the reference picture: the video element, the address
 * a chosen file is played from, and the decoder of the picture's sound. The
 * composition root hands them to the reference picture, whose tests hand it
 * fakes: jsdom plays no video and decodes no sound.
 */

import { PICTURE_SOUND_RATE, readWhole, type DecodeSound } from './picture-sound.js';
import type { PicturePlatform } from './reference-picture.js';

/** The browser's video element and file addresses; `framesAnnounced` where it has the frame callback. */
export function browserPicturePlatform(framesAnnounced: boolean): PicturePlatform {
  return {
    createVideo: () => {
      const video = document.createElement('video');
      video.className = 'ag-picture-video';
      return video;
    },
    createUrl: (file) => URL.createObjectURL(file),
    revokeUrl: (url) => {
      URL.revokeObjectURL(url);
    },
    capture: (video, height) =>
      createImageBitmap(video, {
        resizeHeight: height,
        resizeWidth: Math.max(
          1,
          Math.round((height * video.videoWidth) / Math.max(1, video.videoHeight)),
        ),
        resizeQuality: 'medium',
      }),
    framesAnnounced,
  };
}

/**
 * Decodes a file's sound through an offline audio context at
 * {@link PICTURE_SOUND_RATE}, which makes no sound and needs no gesture. The
 * file is read as a stream, so an abandoned extraction stops reading; the
 * decoding itself cannot be stopped, and its result is dropped.
 */
export function browserSoundDecoder(): DecodeSound {
  return async (file, signal) => {
    if (typeof OfflineAudioContext !== 'function') {
      return 'This browser cannot decode a picture’s sound.';
    }
    const bytes = await readWhole(file.stream(), file.size, signal);
    const context = new OfflineAudioContext(1, 1, PICTURE_SOUND_RATE);
    try {
      const buffer = await context.decodeAudioData(bytes);
      return {
        channels: Array.from({ length: buffer.numberOfChannels }, (_, index) =>
          buffer.getChannelData(index),
        ),
      };
    } catch (error) {
      // The browser refuses a file with no sound it can decode, which is most
      // of what is refused: a silent screen recording, or a codec it lacks.
      return error instanceof DOMException
        ? 'The browser found no sound it can decode in the picture.'
        : `The picture’s sound could not be decoded: ${String(error)}`;
    }
  };
}
