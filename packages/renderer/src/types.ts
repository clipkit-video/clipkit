// Public types for @clipkit/renderer.

import type { Source } from '@clipkit/protocol';

export type RenderResolution = 'source' | '480p' | '720p' | '1080p' | '1440p' | '4k';

export interface RenderOptions {
  /** The ClipKit Source to render. */
  source: Source;
  /**
   * Runtime backend. Default 'auto' lets the runtime negotiate
   * WebGPU → WebGL2. Force 'webgl2' for the most portable software path.
   */
  backend?: 'auto' | 'webgpu' | 'webgl2';
  /**
   * Output resolution. Default 'source' (no scaling — matches the Source's
   * dimensions). Named tiers anchor on height and keep the Source's aspect.
   */
  resolution?: RenderResolution;
  /** Override the auto-selected video bitrate (bits/second). */
  bitrate?: number;
  /** Called per frame during encode. `frame` is the latest; `total` the expected count. */
  onProgress?: (frame: number, total: number) => void;
  /** Called with each in-page console line (debugging). */
  onLog?: (line: string) => void;
  /** Hard timeout in ms. The render fails if no result arrives in time. Default 5 min. */
  timeoutMs?: number;
  /** Show the Chrome window instead of running headless (debugging). */
  showBrowser?: boolean;
}

export interface RenderResult {
  /** Encoded MP4 (H.264) bytes. */
  buffer: Buffer;
  /** Output file extension — always 'mp4'. */
  ext: 'mp4';
  /** Content-type. */
  mime: 'video/mp4';
  /** Composition width / height / duration / fps (echoed from the Source). */
  width: number;
  height: number;
  durationSec: number;
  frameRate: number;
}
