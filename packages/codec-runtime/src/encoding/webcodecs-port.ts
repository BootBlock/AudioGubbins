/**
 * The browser's WebCodecs audio encoding, by the members AAC export uses, so
 * the worker passes the real `AudioEncoder` and `AudioData` and a Node test a
 * fake of them (ADR-0091: AAC-LC is encoded only by the browser's encoder).
 */

/** An `AudioData` the encoder is handed, by the member the export uses. */
export interface AudioDataLike {
  close(): void;
}

/** An encoded chunk the encoder answers, by the members the export reads. */
export interface EncodedAudioChunkLike {
  /** Microseconds from the first frame encoded; negative for the encoder's priming. */
  readonly timestamp: number;
  readonly byteLength: number;
  copyTo(destination: Uint8Array): void;
}

/** What the encoder says beside a chunk: its decoder configuration, with the first. */
export interface EncodedAudioChunkMetadataLike {
  readonly decoderConfig?: {
    /** The AudioSpecificConfig of AAC. */
    readonly description?: AllowSharedBufferSource;
  };
}

/** What a WebCodecs audio encoder is made with. */
export interface AudioEncoderInitLike {
  output(chunk: EncodedAudioChunkLike, metadata?: EncodedAudioChunkMetadataLike): void;
  error(error: DOMException): void;
}

/** An `AudioEncoder`, by the members the export uses. */
export interface AudioEncoderLike {
  readonly encodeQueueSize: number;
  configure(config: AudioEncoderConfig): void;
  encode(data: AudioDataLike): void;
  flush(): Promise<void>;
  close(): void;
  addEventListener(type: 'dequeue', listener: () => void): void;
  removeEventListener(type: 'dequeue', listener: () => void): void;
}

/** The constructors the worker passes: the browser's own, or a test's. */
export interface WebCodecsAudioEncoding {
  readonly AudioEncoder: new (init: AudioEncoderInitLike) => AudioEncoderLike;
  readonly AudioData: new (init: AudioDataInit) => AudioDataLike;
}
