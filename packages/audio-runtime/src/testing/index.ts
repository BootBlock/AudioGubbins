/**
 * What the tests of the page that starts the audio runtime's threads take
 * from this package's test support: the preview, render and feeder workers
 * played in the test's own thread as their modules compose them, the message
 * channel they talk over, and the feeder's kinds of message, which a test
 * that plays no audio drives the feeder by.
 */

export { fakeChannel } from './fake-message-channel.js';
export {
  LocalChainWorker,
  type TypesWith,
  localFeederWorker,
  localPreviewWorker,
  localRenderWorker,
} from './local-chain-workers.js';
export { FromFeederKind, ToFeederKind } from '../protocol/feeder-messages.js';
