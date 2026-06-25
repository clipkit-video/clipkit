import type { Source } from "@clipkit/protocol"
import { Muxer, ArrayBufferTarget } from "mp4-muxer"
import { encodeAudioBuffer, pickAudioCodec, type PickedAudioCodec } from "../audio/encoder.js"

export interface ExportAudioOptions {
  /** Pre-mixed audio buffer ready to encode. Runtime produces this via mixSourceAudio. */
  buffer: AudioBuffer
  /** AAC bitrate in bits/second. Default 128 kbps. */
  bitrate?: number
  /** Codec string. Default 'mp4a.40.2' (AAC-LC). */
  codec?: string
}

/**
 * Named output resolutions. Render-time choice — the Source's
 * width/height stay as the authoring coordinate space; this multiplies
 * the canvas backing store so the encoder pulls higher-density frames.
 *
 * 'source' (default) renders at the Source's declared dimensions —
 * unchanged from the pre-resolution behavior.
 *
 * The named tiers anchor on output height and derive width from the
 * Source's aspect ratio:
 *   480p  →  height 480
 *   720p  →  height 720
 *   1080p →  height 1080
 *   1440p →  height 1440
 *   4k    →  height 2160
 */
export type RenderResolution = 'source' | '480p' | '720p' | '1080p' | '1440p' | '4k';

export interface ExportOptions {
  codec?: string
  bitrate?: number
  framerate?: number
  onProgress?: (progress: number) => void
  /** Optional audio track. When present, the muxer adds an audio stream. */
  audio?: ExportAudioOptions
  /**
   * Output resolution. Defaults to 'source' (no upscaling). When set
   * to a named tier, the exporter resizes the backend canvas to a
   * higher pixel density and the encoder produces an MP4 at that size.
   * Bitrate auto-scales unless overridden.
   */
  renderResolution?: RenderResolution
}

/**
 * Heights for each named resolution tier. Source aspect ratio drives
 * the width.
 */
const RESOLUTION_HEIGHTS: Record<Exclude<RenderResolution, 'source'>, number> = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '4k': 2160,
};

/**
 * Default video bitrates per resolution tier. Tuned for landing-page /
 * UI motion graphics with lots of text — slightly conservative on the
 * low end, generous at 4K where chroma sampling shows blockiness fast.
 */
const RESOLUTION_BITRATES: Record<Exclude<RenderResolution, 'source'>, number> = {
  '480p':  1_500_000,
  '720p':  4_000_000,
  '1080p': 8_000_000,
  '1440p': 16_000_000,
  '4k':    35_000_000,
};

/**
 * H.264 codec strings per resolution tier. The level field caps the
 * pixel area the encoder will accept — Level 4.2 (default elsewhere)
 * tops out at 1080p, so 1440p / 4K must move up to Level 5.1, which
 * covers up to 4K30. High Profile (640) gives noticeably better
 * compression than Baseline (420) at the same bitrate.
 */
const RESOLUTION_CODECS: Record<Exclude<RenderResolution, 'source'>, string> = {
  '480p':  'avc1.42E01F', // Baseline @ Level 3.1 (covers 854×480)
  '720p':  'avc1.42E01F', // Baseline @ Level 3.1
  '1080p': 'avc1.42002A', // Baseline @ Level 4.2
  '1440p': 'avc1.640033', // High @ Level 5.1
  '4k':    'avc1.640033', // High @ Level 5.1
};

/**
 * Encoder pacing + stall guards for the export path.
 *
 * BACKPRESSURE_LIMIT — max frames allowed in the VideoEncoder queue before the
 * render loop pauses for it to drain. Bounds memory and stops frame submission
 * from racing ahead of a slow (software) encoder.
 *
 * FLUSH_TIMEOUT_MS — ceiling on encoder.flush(). With backpressure the queue is
 * tiny by the time we flush, so a flush that exceeds this is a genuine stall;
 * we reject it so the failure is visible instead of an infinite "100%" hang.
 */
const BACKPRESSURE_LIMIT = 8;
const FLUSH_TIMEOUT_MS = 120_000;

/**
 * Resolve a RenderResolution + Source dimensions into the concrete
 * physical canvas size, pixel ratio, and a sensible default bitrate.
 */
export function resolveRenderResolution(
  resolution: RenderResolution,
  sourceWidth: number,
  sourceHeight: number,
): {
  physicalWidth: number;
  physicalHeight: number;
  pixelRatio: number;
  defaultBitrate: number;
  defaultCodec: string;
} {
  if (resolution === 'source') {
    // Pick a codec based on the source's actual height, not a fixed
    // tier — a 4K source authored natively still needs Level 5.1.
    const codec = sourceHeight > 1080 ? 'avc1.640033' : 'avc1.42002A';
    return {
      physicalWidth: sourceWidth,
      physicalHeight: sourceHeight,
      pixelRatio: 1,
      defaultBitrate: 5_000_000,
      defaultCodec: codec,
    };
  }
  const targetHeight = RESOLUTION_HEIGHTS[resolution];
  const pixelRatio = targetHeight / sourceHeight;
  return {
    physicalWidth: Math.round(sourceWidth * pixelRatio),
    physicalHeight: targetHeight,
    pixelRatio,
    defaultBitrate: RESOLUTION_BITRATES[resolution],
    defaultCodec: RESOLUTION_CODECS[resolution],
  };
}

/**
 * H.264 (and ffmpeg's yuv420p) require EVEN frame dimensions. A named
 * resolution tier derives width from the source aspect ratio, which can land
 * odd — e.g. a 16:9 source at 480p gives 1920×(480/1080) = 853. Floor each
 * encode dimension to the nearest even pixel so every tier / aspect ratio
 * encodes cleanly. Export-only: the live preview backend is never resized
 * through this.
 */
function toEvenDimension(n: number): number {
  const floored = Math.max(2, Math.floor(n))
  return floored % 2 === 0 ? floored : floored - 1
}

/**
 * Minimal interface the exporter needs from the runtime. Decouples the
 * encoder from the specific renderer implementation. The new ClipkitRuntime
 * will satisfy this interface.
 */
export interface FrameProducer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  renderAsync(source: Source, time: number): Promise<void>
  /**
   * Block until the GPU has finished drawing the current frame. MUST be awaited
   * between renderAsync() and any canvas read-back (drawImage/getImageData/
   * toDataURL/new VideoFrame). On async hardware GL (ANGLE → NVIDIA L4)
   * renderAsync() returns once commands are QUEUED, not executed, so a read-back
   * without this barrier captures a half-drawn or stale frame → periodic dimming
   * + ghosting (worst on thin text). It's a no-op on synchronous SwiftShader, so
   * it's safe everywhere. (The still path already does this — see harness.ts.)
   */
  gpuFinish(): Promise<void>
}

export class ClipkitExporter {
  private canvas: HTMLCanvasElement | OffscreenCanvas
  private renderer: FrameProducer
  private encoder: VideoEncoder | null = null
  private muxer: Muxer<ArrayBufferTarget> | null = null
  private tempCanvas: HTMLCanvasElement
  private tempCtx: CanvasRenderingContext2D

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, renderer: FrameProducer) {
    this.canvas = canvas
    this.renderer = renderer

    this.tempCanvas = document.createElement("canvas")
    this.tempCtx = this.tempCanvas.getContext("2d")!
  }

  async export(source: Source, options: ExportOptions = {}): Promise<Blob> {
    const {
      codec = "avc1.42002A", // H.264 Baseline Profile Level 4.2 (supports 1080p)
      bitrate = 5_000_000,
      framerate = source.frame_rate || 30,
      onProgress,
    } = options

    // Apply schema-aware defaults — Source dimensions are optional in the
    // schema but mandatory for encoding.
    const sourceWidth = source.width ?? 1920
    const sourceHeight = source.height ?? 1080
    const duration = typeof source.duration === "number" ? source.duration : 10

    // Output dimensions come from the runtime canvas — the runtime is
    // expected to have resize()'d the backend to the right pixel ratio
    // before calling export(). Falls back to source dims if not. Clamped to
    // even (H.264 requires it) — the backend canvas may be odd at some tiers.
    const width = toEvenDimension(this.canvas.width || sourceWidth)
    const height = toEvenDimension(this.canvas.height || sourceHeight)

    console.log("[clipkit] Starting export:", { codec, bitrate, framerate, sourceWidth, sourceHeight, width, height, duration, hasAudio: !!options.audio })

    this.tempCanvas.width = width
    this.tempCanvas.height = height

    const totalFrames = Math.ceil(duration * framerate)

    // Motion blur — exact sub-frame supersampling (PROTOCOL.md §3.x).
    // N renders per output frame across a shutter window centered on the
    // frame time, averaged per 8-bit channel in float (single rounding).
    // samples=1 or no motion_blur block → the plain single-render path.
    const mb = source.motion_blur
    const mbSamples = mb
      ? Math.max(1, Math.min(32, Math.round(typeof mb.samples === "number" ? mb.samples : 8)))
      : 1
    const mbShutter = mb && typeof mb.shutter === "number"
      ? Math.min(1, Math.max(0, mb.shutter))
      : 0.5
    const blurOn = mbSamples > 1 && mbShutter > 0
    const mbAccum = blurOn ? new Float32Array(width * height * 4) : null

    console.log("[clipkit] Encoding", totalFrames, "frames at", framerate, "fps",
      blurOn ? `(motion blur: ${mbSamples} samples, shutter ${mbShutter})` : "")

    const target = new ArrayBufferTarget()

    // Negotiate an audio codec this environment can actually encode. Chromium
    // on Linux (the render container) has NO AAC encoder, so AAC throws
    // "Unsupported codec type" mid-export; pickAudioCodec falls back to Opus
    // there (MP4 muxes both). null → no audio encoder at all: render silently
    // instead of crashing.
    let audioPick: PickedAudioCodec | null = null
    if (options.audio) {
      audioPick = await pickAudioCodec(
        options.audio.buffer.sampleRate,
        options.audio.buffer.numberOfChannels,
        options.audio.bitrate,
      )
      if (!audioPick) {
        console.warn("[clipkit] No supported audio encoder — rendering without audio.")
      }
    }

    const muxerConfig: ConstructorParameters<typeof Muxer<ArrayBufferTarget>>[0] = {
      target,
      video: {
        codec: "avc",
        width,
        height,
      },
      fastStart: "in-memory",
    }

    // Add the audio track only when we have a working encoder for it.
    if (options.audio && audioPick) {
      muxerConfig.audio = {
        codec: audioPick.muxer,
        sampleRate: options.audio.buffer.sampleRate,
        numberOfChannels: options.audio.buffer.numberOfChannels,
      }
    }

    this.muxer = new Muxer(muxerConfig)

    // Encode audio first (it's fast — single pass over the pre-mixed buffer).
    // Audio chunks reach the muxer before video chunks; mp4-muxer handles
    // interleaving on finalize. Non-fatal: an audio failure must never sink the
    // whole render — drop audio and keep the video.
    if (options.audio && audioPick) {
      console.log("[clipkit] Encoding audio:", {
        codec: audioPick.muxer,
        sampleRate: options.audio.buffer.sampleRate,
        channels: options.audio.buffer.numberOfChannels,
        duration: options.audio.buffer.duration.toFixed(2) + "s",
      })
      try {
        await encodeAudioBuffer(options.audio.buffer, this.muxer, {
          bitrate: options.audio.bitrate,
          codec: audioPick.encoder,
        })
        console.log("[clipkit] Audio encoded")
      } catch (e) {
        console.warn(
          "[clipkit] Audio encode failed — continuing without audio:",
          e instanceof Error ? e.message : String(e),
        )
      }
    }

    // Progress is driven from the encoder OUTPUT (frames actually encoded), not
    // from submission. Submission races ahead of a slow software encoder — which
    // is exactly why the bar used to hit 100% while flush() was still draining.
    // Now 100% means every frame is truly encoded + muxed.
    let encodedChunks = 0
    // Latch encoder faults. The WebCodecs error callback fires asynchronously and
    // does not reliably reject the pending flush() across browsers, so we capture
    // it and throw at the next checkpoint — turning a silent hang into a visible,
    // catchable failure.
    let encoderError: Error | null = null

    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        this.muxer?.addVideoChunk(chunk, metadata)
        encodedChunks++
        if (onProgress) onProgress(Math.min(1, encodedChunks / totalFrames))
        if (encodedChunks % 30 === 0 || encodedChunks === totalFrames) {
          console.log(`[clipkit] Encoded ${encodedChunks}/${totalFrames}`)
        }
      },
      error: (error) => {
        encoderError = error instanceof Error ? error : new Error(String(error))
        console.error("[clipkit] VideoEncoder error:", encoderError.message)
      },
    })

    this.encoder.configure({
      codec,
      width,
      height,
      bitrate,
    })

    // Render and encode each frame
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      const currentTime = frameIndex * (1 / framerate)

      if (blurOn && mbAccum) {
        mbAccum.fill(0)
        for (let k = 0; k < mbSamples; k++) {
          const tk = Math.min(
            Math.max(currentTime + ((k + 0.5) / mbSamples - 0.5) * (mbShutter / framerate), 0),
            duration,
          )
          await this.renderer.renderAsync(source, tk)
          await this.renderer.gpuFinish() // drain GPU before read-back (hardware-GL capture race)
          this.tempCtx.drawImage(this.canvas as CanvasImageSource, 0, 0, width, height)
          const sample = this.tempCtx.getImageData(0, 0, width, height).data
          for (let i = 0; i < sample.length; i++) mbAccum[i] += sample[i]
        }
        const out = this.tempCtx.createImageData(width, height)
        const od = out.data
        const inv = 1 / mbSamples
        for (let i = 0; i < od.length; i++) od[i] = Math.round(mbAccum[i] * inv)
        this.tempCtx.putImageData(out, 0, 0)
      } else {
        await this.renderer.renderAsync(source, currentTime)
        await this.renderer.gpuFinish() // drain GPU before read-back (hardware-GL capture race)
        this.tempCtx.drawImage(this.canvas as CanvasImageSource, 0, 0, width, height)
      }

      const videoFrame = new VideoFrame(this.tempCanvas, {
        timestamp: (frameIndex * 1_000_000) / framerate, // microseconds
        duration: 1_000_000 / framerate,
      })

      // Backpressure — never let submission race more than a few frames ahead of
      // the (often software) encoder. Without this a heavy comp queues hundreds
      // of VideoFrames faster than they drain: memory climbs and flush() can take
      // (or appear to take) forever. 'dequeue' is the modern drain signal; race a
      // short macrotask timer so we never wedge if it isn't delivered.
      while (this.encoder.encodeQueueSize > BACKPRESSURE_LIMIT) {
        if (encoderError) throw encoderError
        await new Promise<void>((resolve) => {
          const enc = this.encoder!
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            enc.removeEventListener("dequeue", finish)
            resolve()
          }
          enc.addEventListener("dequeue", finish, { once: true })
          setTimeout(finish, 50)
        })
      }
      if (encoderError) throw encoderError

      // Encode frame
      const keyFrame = frameIndex % 30 === 0 // Keyframe every 30 frames
      this.encoder.encode(videoFrame, { keyFrame })

      // Close frame to free memory. Progress comes from the encoder OUTPUT
      // callback (chunks actually encoded), not from submission here.
      videoFrame.close()
    }

    // Watchdog around flush — a wedged software encoder can leave flush() pending
    // forever, which is what hung the export at "100%" with no error and no
    // download. With backpressure the queue is small here, so a flush that blows
    // past this ceiling is a real stall: reject so the UI surfaces an error
    // instead of an infinite spinner. Ceiling is generous — legit heavy comps are
    // fine; an actual hang is not.
    if (encoderError) throw encoderError
    await Promise.race([
      this.encoder.flush(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Export stalled: encoder.flush did not resolve within ${FLUSH_TIMEOUT_MS / 1000}s`,
              ),
            ),
          FLUSH_TIMEOUT_MS,
        ),
      ),
    ])
    if (encoderError) throw encoderError
    console.log("[clipkit] Encoding complete")

    this.muxer.finalize()
    const { buffer } = target

    if (!buffer || buffer.byteLength === 0) {
      throw new Error("Muxer produced no output")
    }

    console.log("[clipkit] Muxer finalized, size:", (buffer.byteLength / 1024 / 1024).toFixed(2), "MB")

    const mp4Blob = new Blob([buffer], { type: "video/mp4" })

    // Cleanup
    this.encoder.close()
    this.encoder = null
    this.muxer = null

    console.log("[clipkit] Export complete, size:", (mp4Blob.size / 1024 / 1024).toFixed(2), "MB")
    return mp4Blob
  }

  /**
   * Render each frame and hand its PNG bytes (base64, with alpha) to `onFrame`.
   * No encoder/muxer — this feeds the transparent export path (ProRes 4444 /
   * VP9-alpha), which assembles the PNGs with a server-side ffmpeg. `alpha`
   * relies on the renderer having been told to clear transparent (the runtime
   * arranges that). Returns the frame count.
   */
  async exportFrames(
    source: Source,
    options: {
      framerate?: number
      alpha?: boolean
      onFrame: (index: number, pngBase64: string) => void | Promise<void>
      onProgress?: (progress: number) => void
    },
  ): Promise<number> {
    const framerate = options.framerate ?? source.frame_rate ?? 30
    const duration = typeof source.duration === "number" ? source.duration : 10
    // Even dims for the downstream ffmpeg encode (yuv420p), same as export().
    const width = toEvenDimension(this.canvas.width || (source.width ?? 1920))
    const height = toEvenDimension(this.canvas.height || (source.height ?? 1080))
    this.tempCanvas.width = width
    this.tempCanvas.height = height
    const totalFrames = Math.ceil(duration * framerate)

    for (let i = 0; i < totalFrames; i++) {
      await this.renderer.renderAsync(source, i / framerate)
      await this.renderer.gpuFinish() // drain GPU before read-back (hardware-GL capture race)
      // Transparent output must not composite onto the previous frame.
      if (options.alpha) this.tempCtx.clearRect(0, 0, width, height)
      this.tempCtx.drawImage(this.canvas as CanvasImageSource, 0, 0, width, height)
      const dataUrl = this.tempCanvas.toDataURL("image/png")
      await options.onFrame(i, dataUrl.slice(dataUrl.indexOf(",") + 1))
      options.onProgress?.((i + 1) / totalFrames)
    }
    return totalFrames
  }
}
