/**
 * The thumbnails an editor view's picture strip shows: the frame that starts
 * each tile's first boundary, tile after tile across the view, each as wide as
 * the picture's shape makes it at the strip's height (REQ-AUDIO-156). Which
 * frame a tile shows is the binding's exact arithmetic, so the strip lines up
 * with the markers and snapping the same binding gives.
 */

import type { Rectangle, PlacedImage } from '@audiogubbins/renderer';
import type { SampleCount } from '@audiogubbins/domain';
import { boundaryAt, type ViewportState } from '@audiogubbins/timeline';
import {
  pictureFrameAt,
  seekTimeFor,
  type ReferenceMediaClockBinding,
} from '@audiogubbins/video-reference';

import type { Filmstrip } from '../picture/filmstrip.js';

/** The picture as the strip reads it. */
export interface StripPicture {
  readonly binding: ReferenceMediaClockBinding;
  readonly filmstrip: Filmstrip;
  readonly duration: number;
  /** Width over height. */
  readonly aspect: number;
}

/** The thumbnails of `picture` in `area`, for a view at `viewport` over an asset of `length`. */
export function stripImages(
  area: Rectangle,
  viewport: ViewportState,
  length: SampleCount,
  picture: StripPicture,
): readonly PlacedImage[] {
  const tile = Math.max(8, Math.round(area.height * picture.aspect));
  const tiles: { readonly at: Rectangle; readonly time: number }[] = [];
  for (let x = 0; x < area.width; x += tile) {
    const frame = pictureFrameAt(picture.binding, boundaryAt(viewport, x, length));
    const time = seekTimeFor(picture.binding, frame);
    if (time < 0 || time >= picture.duration) continue;
    tiles.push({ at: { x: area.x + x, y: area.y, width: tile, height: area.height }, time });
  }
  const images = picture.filmstrip.images(tiles.map((each) => each.time));
  return tiles.flatMap((each, index) => {
    const image = images[index];
    return image === undefined ? [] : [{ image, at: each.at }];
  });
}
