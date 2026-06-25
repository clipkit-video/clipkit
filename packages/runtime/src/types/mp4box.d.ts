// Minimal type shim for mp4box (no official types). Only the surface
// the Mp4FrameSource uses.

declare module 'mp4box' {
  export interface MP4MediaTrack {
    id: number;
    codec: string;
    timescale: number;
    duration: number;
    nb_samples: number;
    video?: { width: number; height: number };
    track_width: number;
    track_height: number;
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    videoTracks: MP4MediaTrack[];
    audioTracks: MP4MediaTrack[];
  }

  export interface MP4Sample {
    number: number;
    track_id: number;
    timescale: number;
    /** Composition timestamp in track timescale units. */
    cts: number;
    /** Decode timestamp in track timescale units. */
    dts: number;
    duration: number;
    is_sync: boolean;
    data: Uint8Array;
  }

  export interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
  }

  export interface MP4File {
    onReady: ((info: MP4Info) => void) | null;
    onError: ((error: string) => void) | null;
    onSamples: ((trackId: number, user: unknown, samples: MP4Sample[]) => void) | null;
    appendBuffer(buffer: MP4ArrayBuffer): number;
    flush(): void;
    setExtractionOptions(
      trackId: number,
      user?: unknown,
      options?: { nbSamples?: number; rapAlignement?: boolean },
    ): void;
    start(): void;
    stop(): void;
    getTrackById(id: number): {
      mdia: {
        minf: {
          stbl: {
            stsd: {
              entries: Array<Record<string, { write(stream: DataStream): void } | undefined>>;
            };
          };
        };
      };
    };
  }

  export class DataStream {
    constructor(arrayBuffer?: ArrayBuffer, byteOffset?: number, endianness?: number);
    buffer: ArrayBuffer;
  }

  /** Endianness flags for DataStream's third constructor arg. */
  export const Endianness: {
    BIG_ENDIAN: number;
    LITTLE_ENDIAN: number;
  };

  export function createFile(): MP4File;
}
