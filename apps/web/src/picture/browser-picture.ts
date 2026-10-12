/**
 * The browser's part in the reference picture: the video element, the address
 * a chosen file is played from, and the frames captured from it. The
 * composition root hands them to the reference picture, whose tests hand it
 * fakes: jsdom plays no video. The picture's sound is the codecs', never the
 * browser's (`codec-picture-sound.ts`).
 */

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
