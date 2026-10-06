/**
 * The two ends of a message channel, as `MessageChannel` makes them: what the
 * page hands a worker to talk to another, the feeder to the preview worker
 * and the processor to the feeder alike.
 */
export interface ChannelEnds {
  readonly port1: MessagePort;
  readonly port2: MessagePort;
}
