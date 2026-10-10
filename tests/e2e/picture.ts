import { expect, type Locator, type Page } from '@playwright/test';

import { runCommand } from './editor.js';

/**
 * The reference picture as the browser suite meets it: a video the page makes
 * itself, and the panel it is opened in.
 */

/**
 * The frame rate the page's video is made at, and the picture is counted at:
 * 30, whose period is no whole number of milliseconds, so a WebM stamps most of
 * its frames a little before they start.
 */
export const FRAMES_PER_SECOND = 30;

/** How many frames the video holds: four seconds. */
const FRAME_COUNT = 120;

/**
 * A WebM of {@link FRAME_COUNT} frames of VP8, made in the page, as bytes.
 *
 * Each frame draws its own number as eight black or white bars, which survive
 * compression, so the frame on screen can be read back from its pixels. Encoded
 * with WebCodecs and written to a WebM here rather than recorded, so each
 * frame's timestamp is exact: frame `k` is stamped `floor(k × 1000 / 30)`
 * milliseconds, as a muxer keeping whole milliseconds stamps it, and every
 * frame is a key frame, so a seek shows the frame asked for at once. Made
 * rather than kept as a file, so the suite carries no binary.
 */
export async function framedVideo(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ fps, count }) => {
      const canvas = new OffscreenCanvas(160, 90);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('No Canvas 2D context to draw frames in.');
      const chunks: Uint8Array[] = [];
      const encoder = new VideoEncoder({
        output: (chunk) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          chunks.push(data);
        },
        error: (error) => {
          throw error;
        },
      });
      encoder.configure({
        codec: 'vp8',
        width: 160,
        height: 90,
        bitrate: 2_000_000,
        framerate: fps,
      });
      for (let frame = 0; frame < count; frame += 1) {
        for (let bit = 0; bit < 8; bit += 1) {
          context.fillStyle = (frame >> (7 - bit)) & 1 ? '#fff' : '#000';
          context.fillRect(bit * 20, 0, 20, 90);
        }
        const picture = new VideoFrame(canvas, { timestamp: Math.round((frame * 1e6) / fps) });
        encoder.encode(picture, { keyFrame: true });
        picture.close();
      }
      await encoder.flush();

      // The smallest WebM a browser plays: an EBML header, and a segment of its
      // info, one video track and one cluster of simple blocks.
      const unsigned = (value: number): number[] => {
        const out: number[] = [];
        let rest = value;
        do {
          out.unshift(rest % 256);
          rest = Math.floor(rest / 256);
        } while (rest > 0);
        return out;
      };
      const size = (length: number): number[] => [
        0x01,
        ...unsigned(length).reverse().concat([0, 0, 0, 0, 0, 0, 0]).slice(0, 7).reverse(),
      ];
      const element = (id: number[], body: number[]): number[] => [
        ...id,
        ...size(body.length),
        ...body,
      ];
      const text = (value: string): number[] => [...new TextEncoder().encode(value)];
      const float = (value: number): number[] => {
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, value);
        return [...new Uint8Array(view.buffer)];
      };
      const stamp = (frame: number): number => Math.floor((frame * 1000) / fps);
      const header = element(
        [0x1a, 0x45, 0xdf, 0xa3],
        [
          ...element([0x42, 0x86], [1]),
          ...element([0x42, 0xf7], [1]),
          ...element([0x42, 0xf2], [4]),
          ...element([0x42, 0xf3], [8]),
          ...element([0x42, 0x82], text('webm')),
          ...element([0x42, 0x87], [2]),
          ...element([0x42, 0x85], [2]),
        ],
      );
      const info = element(
        [0x15, 0x49, 0xa9, 0x66],
        [
          ...element([0x2a, 0xd7, 0xb1], unsigned(1_000_000)),
          ...element([0x4d, 0x80], text('AudioGubbins test')),
          ...element([0x57, 0x41], text('AudioGubbins test')),
          ...element([0x44, 0x89], float((count * 1000) / fps)),
        ],
      );
      const tracks = element(
        [0x16, 0x54, 0xae, 0x6b],
        element(
          [0xae],
          [
            ...element([0xd7], [1]),
            ...element([0x73, 0xc5], [1]),
            ...element([0x83], [1]),
            ...element([0x86], text('V_VP8')),
            ...element([0xe0], [...element([0xb0], [160]), ...element([0xba], [90])]),
          ],
        ),
      );
      const blocks = chunks.flatMap((data, frame) =>
        element([0xa3], [0x81, (stamp(frame) >> 8) & 0xff, stamp(frame) & 0xff, 0x80, ...data]),
      );
      const cluster = element([0x1f, 0x43, 0xb6, 0x75], [...element([0xe7], [0]), ...blocks]);
      return [...header, ...element([0x18, 0x53, 0x80, 0x67], [...info, ...tracks, ...cluster])];
    },
    { fps: FRAMES_PER_SECOND, count: FRAME_COUNT },
  );
  return Buffer.from(bytes);
}

/** The Picture panel, opened by its command. */
export async function openPicturePanel(page: Page): Promise<Locator> {
  await runCommand(page, 'Show the Picture panel');
  const panel = page.locator('section.ag-picture');
  await expect(panel.getByRole('heading', { name: 'Picture' })).toBeVisible();
  return panel;
}
