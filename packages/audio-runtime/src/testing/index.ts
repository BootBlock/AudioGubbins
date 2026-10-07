/**
 * What the tests of the page that starts the audio runtime's threads take
 * from this package's test support: the preview and render workers played in
 * the test's own thread as their modules compose them, and the message
 * channel they talk over.
 */

export { fakeChannel } from './fake-message-channel.js';
export {
  LocalChainWorker,
  type TypesWith,
  localPreviewWorker,
  localRenderWorker,
} from './local-chain-workers.js';
