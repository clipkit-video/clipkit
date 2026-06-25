// ClipkitRuntime — public API for the compositor + encoder.
//
// Lifecycle:
//   const rt = new ClipkitRuntime(canvas);
//   const ok = await rt.init();
//   if (!ok) { /* WebGPU not available */ }
//   rt.load(source);
//   await rt.preload();              // load images, videos, fonts
//   rt.frame(time);                  // render one frame for preview
//   const blob = await rt.export({ ... });
//   rt.dispose();

import type { AudioElement, Element, Source, VideoElement, ImageElement, TextElement } from '@clipkit/protocol';
import type { Backend, RenderTarget } from './backend/backend.js';
import { WebGPUBackend } from './backend/webgpu-backend.js';
import { WebGL2Backend } from './backend/webgl-backend.js';
import { AssetCache } from './assets/cache.js';
import { loadFont, fontsReady, registerSourceFonts } from './assets/fonts.js';
import { loadImage, loadVideo, seekVideo } from './assets/loader.js';
import { loadCube } from './assets/lut.js';
import { Mp4FrameSource } from './assets/mp4-frame-source.js';
import { mapToMediaTime, rateOf, timeRemapOf, trimDurationOf } from './assets/media-time.js';
import { loadAudio } from './audio/loader.js';
import { mixSourceAudio } from './audio/mixer.js';
import { audioBufferToWav } from './audio/wav.js';
import { interpolateKeyframes } from './animation/keyframes.js';
import { renderSourceFrame } from './compositor/scene.js';
import { parseColorPremultiplied } from './compositor/color.js';
import type { GroupClipTarget, ImageAsset, LutAsset, MaskedTextAsset, RenderContext, SvgRasterAsset, VideoAsset } from './compositor/render-context.js';
import { MAT4_IDENTITY } from './compositor/render-context.js';
import { cameraMatrix } from './compositor/camera.js';
import { resolveLights, resolveEnvironment, resolveBloom, cameraEyeWorld } from './compositor/lighting.js';
import type { ResolvedBloom } from './compositor/lighting.js';
import { ClipkitExporter, resolveRenderResolution, type ExportOptions, type FrameProducer } from './encoder/exporter.js';
import { getLogger } from './logger.js';
import type { FontAtlas } from './text/font-atlas.js';

export interface RuntimeInitOptions {
  /**
   * Preferred backend. Defaults to 'auto' (try WebGPU, fall back to WebGL2).
   * Use 'webgpu' or 'webgl2' to force a specific backend, e.g. for testing.
   */
  backend?: 'auto' | 'webgpu' | 'webgl2';
}

export class ClipkitRuntime implements FrameProducer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;

  private backend!: Backend;
  private currentSource: Source | null = null;
  /** When true, frame() clears to a transparent background if the Source has no
   *  background_color — set during alpha (transparent) frame export. */
  private transparentBackground = false;
  private images = new AssetCache<ImageAsset>();
  private videos = new AssetCache<VideoAsset>();
  private audioBuffers = new AssetCache<AudioBuffer>();
  private fontAtlases = new AssetCache<FontAtlas>();
  private svgRasters = new AssetCache<SvgRasterAsset>();
  private maskedTexts = new AssetCache<MaskedTextAsset>();
  private groupTargets = new AssetCache<GroupClipTarget>();
  /**
   * Eviction epoch for the groupTargets pool — bumped once per frame() and once
   * per renderFinalFrame(), threaded into RenderContext.frameIndex so pool
   * entries can be stamped last-touched for frame-boundary LRU eviction. NOT a
   * clean 1:1 output-frame ordinal: it advances per motion-blur SAMPLE (each
   * export sample funnels through frame()) and the renderFinalFrame→frame()
   * fallback bumps twice. Only ever compared for equality at eviction time, so
   * gaps/jumps are harmless — do not treat it as a frame number.
   */
  private frameIndex = 0;
  /**
   * Soft cap (bytes) on the offscreen-FBO pool (groupTargets). After each render
   * pass's endFrame(), entries NOT touched this frame are evicted LRU-first
   * until total pooled bytes (logical w*h*4 per target) drop under this. SOFT:
   * targets touched this frame are never evicted, so a single frame whose
   * working set exceeds the cap stays above it (graceful — never thrashes).
   * Default 512 MiB: a glassy element peaks at ~3 full-surface 1080p targets
   * (::bd + ::fx + ::fx-scratch ≈ 25 MB), so 512 MiB holds ~18-20
   * concurrently-active glass elements — well above any real frame's live set —
   * while bounding the cross-timeline tail of inactive-element keys that is the
   * unbounded-growth / cloud-BLACK cause. Logical bytes ≈ real VRAM only when
   * pixelRatio=1 (the cloud Job, renderResolution='source'); high-DPI preview
   * under-accounts by pixelRatio² (harmless — just a looser bound off-cloud).
   * Override via setGroupTargetPoolCap(); ≤ 0 disables eviction (legacy).
   */
  private groupTargetPoolCapBytes = 512 * 1024 * 1024;
  private luts = new AssetCache<LutAsset>();
  /** Scratch targets for renderFinalFrame's blur accumulation. */
  private blurTargets: { target: RenderTarget; width: number; height: number }[] = [];
  private initialized = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
  }

  async init(options: RuntimeInitOptions = {}): Promise<boolean> {
    if (this.initialized) return true;
    const prefer = options.backend ?? 'auto';

    if (prefer === 'webgpu' || prefer === 'auto') {
      const webgpu = new WebGPUBackend(this.canvas);
      if (await webgpu.init()) {
        this.backend = webgpu;
        this.initialized = true;
        getLogger().info('Runtime initialized with WebGPU backend');
        return true;
      }
      if (prefer === 'webgpu') return false;
    }

    if (prefer === 'webgl2' || prefer === 'auto') {
      const webgl = new WebGL2Backend(this.canvas);
      if (await webgl.init()) {
        this.backend = webgl;
        this.initialized = true;
        getLogger().info('Runtime initialized with WebGL2 backend');
        return true;
      }
    }

    return false;
  }

  /** Which graphics API this runtime is using. Only valid after init() resolves true. */
  get api(): 'webgpu' | 'webgl2' | null {
    return this.initialized ? this.backend.capabilities.api : null;
  }

  /** Set the current source. Does NOT trigger asset loading — call preload(). */
  load(source: Source): void {
    this.currentSource = source;
    // Resize the backend to match the source's intrinsic dimensions.
    const w = source.width ?? 1920;
    const h = source.height ?? 1080;
    this.backend.resize(w, h);
  }

  /**
   * Load every external asset referenced by the current source. Images
   * and videos are downloaded; fonts are requested via FontFace API.
   * Idempotent — already-loaded URLs are skipped.
   */
  async preload(source?: Source): Promise<void> {
    if (!this.initialized) throw new Error('ClipkitRuntime.preload() called before init()');
    const src = source ?? this.currentSource;
    if (!src) throw new Error('No source loaded');

    // Register Source-declared @font-face entries first. Each becomes a
    // FontFace added to document.fonts so the subsequent loadFont()
    // calls resolve against them. Without this, the runtime would fall
    // back to whatever font the host page happens to have available.
    if (src.fonts && src.fonts.length > 0) {
      await registerSourceFonts(src.fonts);
    }

    const fontRequests: Promise<void>[] = [];
    const imageRequests: Promise<void>[] = [];
    const videoRequests: Promise<void>[] = [];
    const audioRequests: Promise<void>[] = [];
    const lutRequests: Promise<void>[] = [];

    // LUT effects can sit on any element at any nesting depth.
    const lutUrls = new Set<string>();
    const scanLuts = (els: Element[]): void => {
      for (const el of els) {
        const effects = (el as { effects?: { type?: string; source?: string }[] }).effects;
        if (Array.isArray(effects)) {
          for (const fx of effects) {
            if (fx.type === 'lut' && typeof fx.source === 'string' && fx.source) lutUrls.add(fx.source);
          }
        }
        const kids = (el as { elements?: Element[] }).elements;
        if (Array.isArray(kids)) scanLuts(kids);
      }
    };
    scanLuts(src.elements);
    for (const url of lutUrls) lutRequests.push(this.preloadLut(url));

    // One decoder + one texture per video URL (v1 simplification):
    // elements sharing a URL share a playhead. When their timings
    // diverge (different time/trim/rate/loop/time_remap) the last
    // element's decoded frame wins for ALL of them and the decoder
    // thrashes between positions — warn the author toward distinct
    // URLs (a ?copy=N query suffix is enough).
    const videoTimings = new Map<string, Set<string>>();
    const scanVideoTimings = (els: Element[]): void => {
      for (const el of els) {
        if (el.type === 'video' && typeof el.source === 'string' && el.source) {
          const v = el as VideoElement;
          const sig = JSON.stringify([v.time, v.trim_start, v.trim_duration, v.playback_rate, v.loop, v.time_remap]);
          let set = videoTimings.get(v.source);
          if (!set) videoTimings.set(v.source, (set = new Set()));
          set.add(sig);
        }
        const kids = (el as { elements?: Element[] }).elements;
        if (Array.isArray(kids)) scanVideoTimings(kids);
      }
    };
    scanVideoTimings(src.elements);
    for (const [url, sigs] of videoTimings) {
      if (sigs.size > 1) {
        getLogger().warn(
          `${sigs.size} video elements share ${url} with different timings — they share ONE decoder, so all will show the same frames and seeking will thrash. Give each element its own URL (append e.g. ?copy=2).`,
        );
      }
    }

    // Recursive — group children need their assets too (a flat scan
    // left videos/images nested in groups unloaded).
    const scanAssets = (els: Element[]): void => {
      for (const element of els) {
        if (element.type === 'image') {
          imageRequests.push(this.preloadImage(element as ImageElement));
        } else if (element.type === 'video') {
          videoRequests.push(this.preloadVideo(element as VideoElement));
          // Videos can carry an audio track; decode it for the scheduler /
          // export mix. Quiet no-op for silent videos and in workers.
          audioRequests.push(this.preloadVideoAudio(element as VideoElement));
        } else if (element.type === 'audio') {
          audioRequests.push(this.preloadAudio(element as AudioElement));
        } else if (element.type === 'text' || element.type === 'caption') {
          const text = element as TextElement;
          fontRequests.push(loadFont(text.font_family ?? 'sans-serif', text.font_weight ?? 'normal'));
        } else if (element.type === 'group') {
          const kids = (element as { elements?: Element[] }).elements;
          if (Array.isArray(kids)) scanAssets(kids);
        }
        // §4.8 Phase 2: a material normal map on ANY element type loads
        // through the shared image cache.
        const nm = (element as { material?: { normal_map?: unknown } }).material?.normal_map;
        if (typeof nm === 'string' && nm) {
          imageRequests.push(this.preloadImageUrl(nm));
        }
      }
    };
    scanAssets(src.elements);

    // §4.8 Phase 3: an image environment loads as an equirect texture
    // (shared image cache) and we cache its average color for the
    // roughness-blurred reflection fallback.
    const env = src.environment as { type?: string; src?: string } | undefined;
    if (env && env.type === 'image' && typeof env.src === 'string' && env.src) {
      imageRequests.push(this.preloadEnvImage(env.src));
    }

    // Global preload timeout — 20s — fail open if any asset path is
    // stuck. Individual per-asset try/catches already swallow errors;
    // this catches the case where a request neither rejects nor
    // resolves (slow CDN, blocked CORS preflight, FontFaceSet stuck
    // on a never-resolving load). Without it, "initializing…" can
    // hang forever on a single bad asset.
    // Per-asset timeouts: a single slow/stuck asset (e.g. a large remote video)
    // must not hold the whole preload hostage. Each request resolves within
    // PRELOAD_ASSET_TIMEOUT_MS; we log the category that ran long so it's
    // diagnosable instead of a silent 20s stall. A longer global net still
    // backstops a pathological case.
    const PRELOAD_ASSET_TIMEOUT_MS = 10000;
    const guard = (label: string, ps: Promise<unknown>[]): Promise<unknown>[] =>
      ps.map((p) =>
        Promise.race([
          p,
          new Promise<void>((resolve) =>
            setTimeout(() => {
              getLogger().warn(
                `Preload: a ${label} asset exceeded ${PRELOAD_ASSET_TIMEOUT_MS}ms — proceeding without waiting for it.`,
              );
              resolve();
            }, PRELOAD_ASSET_TIMEOUT_MS),
          ),
        ]),
      );
    const allAssets = Promise.all([
      ...guard('font', fontRequests),
      ...guard('image', imageRequests),
      ...guard('video', videoRequests),
      ...guard('audio', audioRequests),
      ...guard('lut', lutRequests),
    ]);
    const timeout = new Promise<void>((resolve) => setTimeout(() => {
      getLogger().warn('Preload global timeout — proceeding with whatever loaded.');
      resolve();
    }, 30000));
    await Promise.race([allAssets, timeout]);
    await Promise.race([fontsReady(), new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
  }

  private async preloadAudio(element: AudioElement): Promise<void> {
    const url = String(element.source ?? '');
    if (!url) return;
    if (this.audioBuffers.has(url)) return;
    try {
      await this.audioBuffers.getOrLoad(url, async () => loadAudio(url));
    } catch (err) {
      getLogger().warn(
        `Failed to preload audio ${url}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Decode a video's embedded audio track. decodeAudioData accepts MP4
   * containers directly (it extracts the first audio track), so this is
   * the same loadAudio path audio elements use. Failures are expected
   * (video without audio) and logged at debug. Workers skip — the
   * main-thread AudioScheduler owns preview audio.
   */
  private async preloadVideoAudio(element: VideoElement): Promise<void> {
    if (typeof AudioContext === 'undefined') return;
    const url = String(element.source ?? '');
    if (!url) return;
    if (this.audioBuffers.has(url)) return;
    try {
      await this.audioBuffers.getOrLoad(url, async () => loadAudio(url));
    } catch (err) {
      getLogger().debug(
        `Video ${url} has no decodable audio track:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async preloadLut(url: string): Promise<void> {
    if (this.luts.has(url)) return;
    try {
      await this.luts.getOrLoad(url, async () => {
        const { bitmap, size } = await loadCube(url);
        const texture = this.backend.createTexture(bitmap);
        return { texture, size };
      });
    } catch (err) {
      getLogger().warn(
        `Failed to load LUT ${url}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async preloadImage(element: ImageElement): Promise<void> {
    return this.preloadImageUrl(String(element.source ?? ''));
  }

  /**
   * Preload an arbitrary image URL into the shared image cache (used by
   * image elements AND material normal maps, §4.8 Phase 2). Normal maps
   * upload as plain rgba8unorm and are sampled linearly — no premultiply
   * or sRGB transform corrupts the encoded normals.
   */
  /** Average color of each loaded equirect environment image (§4.8). */
  private envAvg = new Map<string, [number, number, number]>();

  /**
   * Preload an equirect environment image AND compute its average color
   * (downscale to 1×1) for the roughness-blurred reflection fallback.
   */
  private async preloadEnvImage(url: string): Promise<void> {
    await this.preloadImageUrl(url);
    if (this.envAvg.has(url)) return;
    const asset = this.images.get(url);
    if (!asset) return;
    try {
      const oc = new OffscreenCanvas(1, 1);
      const g = oc.getContext('2d');
      if (!g) return;
      g.drawImage(asset.bitmap as unknown as CanvasImageSource, 0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      this.envAvg.set(url, [d[0]! / 255, d[1]! / 255, d[2]! / 255]);
    } catch {
      this.envAvg.set(url, [0.5, 0.5, 0.5]);
    }
  }

  private async preloadImageUrl(url: string): Promise<void> {
    if (!url) return;
    if (this.images.has(url)) return;
    // Wrap in try/catch — a single CORS-blocked or 404 image
    // shouldn't kill the whole preload (which would block worker
    // init). The image renderer already handles "no asset" by
    // silently skipping the draw.
    try {
      await this.images.getOrLoad(url, async () => {
        const bitmap = await loadImage(url);
        const texture = this.backend.createTexture(bitmap);
        return { bitmap, texture };
      });
    } catch (err) {
      getLogger().warn(
        `Failed to preload image ${url}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async preloadVideo(element: VideoElement): Promise<void> {
    const url = String(element.source ?? '');
    if (!url) return;
    if (this.videos.has(url)) return;

    // Primary path in EVERY context: deterministic WebCodecs decode
    // (fetch + demux + VideoDecoder). One pipeline for preview, editor
    // export, and the render service — frame N is the same pixels
    // everywhere. Fallbacks when the container/codec can't be handled:
    //   - page contexts → HTMLVideoElement (seek-based, approximate)
    //   - worker contexts → asset stays absent; the host pumps frames
    //     via pushExternalVideoFrame()
    try {
      await this.videos.getOrLoad(url, async () => {
        const frameSource = await Mp4FrameSource.load(url);
        const first = await frameSource.getFrame(0);
        if (!first) throw new Error('decoder produced no first frame');
        const texture = this.backend.createTexture(first);
        return {
          video: null,
          frameSource,
          texture,
          lastUploadedTime: first.timestamp,
          width: frameSource.width,
          height: frameSource.height,
        };
      });
      return;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (typeof document === 'undefined') {
        getLogger().warn(
          `WebCodecs decode unavailable for ${url} (${reason}); host frame-pump fallback required.`,
        );
        return;
      }
      getLogger().warn(
        `WebCodecs decode unavailable for ${url} (${reason}); falling back to HTMLVideoElement.`,
      );
    }

    try {
      await this.videos.getOrLoad(url, async () => {
        const video = await loadVideo(url);
        const texture = this.backend.createTexture(video);
        return {
          video,
          frameSource: null,
          texture,
          lastUploadedTime: video.currentTime,
          width: video.videoWidth,
          height: video.videoHeight,
        };
      });
    } catch (err) {
      getLogger().warn(
        `Failed to preload video ${url}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Whether a decodable video asset exists for this URL. */
  hasVideoAsset(url: string): boolean {
    return this.videos.has(url);
  }


  /**
   * Walk the element tree and collect every ACTIVE video element with
   * the LOCAL clock value it should be evaluated at. Groups translate
   * the clock (child times are group-relative) and, with time_remap
   * (§5.8.4), WARP it — so nested videos inside speed-ramped/frozen/
   * reversed groups decode the right frames. Fixes the former flat
   * scan, which never updated videos nested in groups at all.
   */
  private collectActiveVideos(
    elements: readonly Element[],
    clock: number,
    parentDuration: number,
    out: Array<{ el: VideoElement; clock: number }>,
  ): void {
    for (const element of elements) {
      const start = numberOrZero(element.time);
      const dur = parseDuration(element.duration, parentDuration - start);
      if (clock < start || clock > start + dur) continue;
      if (element.type === 'video') {
        out.push({ el: element as VideoElement, clock });
      } else if (element.type === 'group') {
        const group = element as { elements?: Element[]; time_remap?: unknown };
        const local = clock - start;
        const remap = timeRemapOf(group.time_remap);
        const childClock = remap
          ? Math.max(0, interpolateKeyframes(remap, local))
          : local;
        if (Array.isArray(group.elements)) {
          this.collectActiveVideos(group.elements, childClock, dur, out);
        }
      }
    }
  }

  /**
   * Decode + upload the exact video frame each active frameSource-backed
   * video element needs at composition time `time`. Await this before
   * the synchronous `frame(time)` pass in contexts that use the
   * WebCodecs path (the playback worker). Element-backed and externally
   * pumped assets are untouched.
   */
  async prepareVideoFrames(time: number): Promise<void> {
    const src = this.currentSource;
    if (!src) return;
    const sourceDuration = typeof src.duration === 'number' ? src.duration : 0;

    const active: Array<{ el: VideoElement; clock: number }> = [];
    this.collectActiveVideos(src.elements, time, sourceDuration, active);
    const uploads: Promise<void>[] = [];
    for (const { el, clock } of active) {
      const url = String(el.source ?? '');
      const asset = this.videos.get(url);
      if (!asset?.frameSource) continue;

      const mediaTime = mapToMediaTime(
        clock,
        {
          elementStart: numberOrZero(el.time),
          trimStart: numberOrZero(el.trim_start),
          trimDuration: trimDurationOf(el.trim_duration),
          rate: rateOf(el.playback_rate),
          loop: el.loop === true,
          timeRemap: timeRemapOf(el.time_remap),
        },
        asset.frameSource.duration,
      );

      const frameSource = asset.frameSource;
      uploads.push(
        frameSource.getFrame(mediaTime).then((frame) => {
          if (!frame) return;
          if (asset.lastUploadedTime !== frame.timestamp) {
            this.backend.updateTexture(asset.texture, frame);
            asset.lastUploadedTime = frame.timestamp;
          }
        }),
      );
    }
    if (uploads.length > 0) await Promise.all(uploads);
  }

  /**
   * Feed one decoded video frame for a source URL from outside the
   * runtime. This is the worker-context video path: the host decodes
   * with an HTMLVideoElement on the main thread, transfers ImageBitmaps
   * here, and the video renderer samples the resulting texture exactly
   * like an element-backed asset.
   *
   * The bitmap is uploaded immediately and then closed. If the media
   * dimensions change (different bitmap size), the texture is recreated.
   */
  pushExternalVideoFrame(url: string, bitmap: ImageBitmap): void {
    if (!this.initialized) {
      bitmap.close();
      return;
    }
    const existing = this.videos.get(url);
    if (
      existing &&
      existing.width === bitmap.width &&
      existing.height === bitmap.height
    ) {
      this.backend.updateTexture(existing.texture, bitmap);
      bitmap.close();
      return;
    }
    if (existing) this.backend.destroyTexture(existing.texture);
    const texture = this.backend.createTexture(bitmap);
    this.videos.set(url, {
      video: null,
      frameSource: null,
      texture,
      lastUploadedTime: 0,
      width: bitmap.width,
      height: bitmap.height,
    });
    bitmap.close();
  }

  /** Render one frame at the given time. Synchronous. */
  frame(time: number): void {
    if (!this.initialized) return;
    const src = this.currentSource;
    if (!src) return;
    this.frameIndex++;
    // Clear to the Source's background_color (default opaque black).
    // This makes the schema field actually render — no more full-canvas
    // backdrop rectangles as a workaround.
    const clear =
      typeof src.background_color === 'string'
        ? parseColorPremultiplied(src.background_color)
        : this.transparentBackground
          ? ([0, 0, 0, 0] as [number, number, number, number])
          : undefined;
    const bloom = resolveBloom(src, time);
    this.backend.beginFrame(clear);
    if (bloom) {
      // Render the scene into an offscreen target, then bloom → surface.
      const w = this.backend.width, h = this.backend.height;
      const scene = this.acquireBlurTarget(6, w, h);
      this.backend.pushTarget(scene, (clear ?? [0, 0, 0, 0]) as [number, number, number, number]);
      renderSourceFrame(src, this.makeContext(time));
      this.backend.popTarget();
      this.applyBloom(scene, w, h, bloom);
    } else {
      renderSourceFrame(src, this.makeContext(time));
    }
    this.backend.endFrame();
    // Eviction runs AFTER endFrame() so WebGPU's queue.submit() has flushed
    // before any gpuTexture.destroy() (no destroy-before-submit). WebGL has no
    // submit and is trivially safe here.
    this.evictGroupTargets();
  }

  /**
   * Whole-frame bloom post (§4.8): extract pixels above the threshold,
   * Gaussian-blur them, and add them back over the scene. Bright regions
   * (specular highlights, emissive surfaces, bright media) bleed light;
   * the amount is driven by each region's own brightness. Draws the final
   * composite to the CURRENT target (the surface). Reuses blur slots 3/4.
   */
  private applyBloom(scene: RenderTarget, w: number, h: number, bloom: ResolvedBloom): void {
    const bright = this.acquireBlurTarget(3, w, h);
    const tmp = this.acquireBlurTarget(4, w, h);
    const full = { cx: w / 2, cy: h / 2, width: w, height: h } as const;

    // Bright-pass: extract bright pixels into `bright`.
    this.backend.pushTarget(bright, [0, 0, 0, 0]);
    this.backend.drawStylizedQuad({ ...full, texture: scene.texture, mode: 'bloom_bright', p0: bloom.threshold, p1: bloom.knee });
    this.backend.popTarget();

    // Separable Gaussian: horizontal into tmp, vertical back into bright.
    this.backend.pushTarget(tmp, [0, 0, 0, 0]);
    this.backend.drawFilteredQuad({ ...full, texture: bright.texture, blurRadius: bloom.radius, blurDir: [1, 0], brightness: 1, contrast: 1, saturation: 1 });
    this.backend.popTarget();
    this.backend.pushTarget(bright, [0, 0, 0, 0]);
    this.backend.drawFilteredQuad({ ...full, texture: tmp.texture, blurRadius: bloom.radius, blurDir: [0, 1], brightness: 1, contrast: 1, saturation: 1 });
    this.backend.popTarget();

    // Composite: the scene, then the blurred bright added × intensity.
    const i = bloom.intensity;
    this.backend.drawTexturedQuad({ ...full, rotation: 0, texture: scene.texture });
    this.backend.drawTexturedQuad({ ...full, rotation: 0, texture: bright.texture, tint: [i, i, i, i], blend: 'add' });
  }

  /**
   * Render one frame WITH source-level motion blur (§2.1) — the
   * preview's "final quality" path, used when the playhead is parked.
   * Renders N sub-frame samples into an offscreen layer and keeps a
   * GPU running average (avg_k = avg_{k-1}·k/(k+1) + sample·1/(k+1)),
   * then composites the result to the canvas. Within a few 8-bit
   * rounding steps of the exporter's exact float average — preview
   * parity, not the normative path. Falls back to frame() when the
   * source has no motion blur. Video textures are decoded once at the
   * frame time (call prepareVideoFrames first), not per sample —
   * WebGPU executes the whole frame's draws at submit, so per-sample
   * uploads would all show the last sample's pixels anyway.
   */
  renderFinalFrame(time: number, sampleOverride?: number): void {
    if (!this.initialized) return;
    const src = this.currentSource;
    if (!src) return;
    // Bump ONCE per output frame — all motion-blur sub-frame samples (each
    // building its own makeContext) must share this frameIndex so they all
    // stamp their shared pool entries as touched this frame.
    this.frameIndex++;
    const mb = src.motion_blur;
    let samples = mb
      ? Math.max(1, Math.min(32, Math.round(typeof mb.samples === 'number' ? mb.samples : 8)))
      : 1;
    // Live playback passes a budgeted sample count (≤ the source's) so
    // blur stays visible at realtime cost; pause-refine and export use
    // the full count.
    if (sampleOverride !== undefined) samples = Math.max(1, Math.min(samples, Math.round(sampleOverride)));
    const shutter = mb && typeof mb.shutter === 'number'
      ? Math.min(1, Math.max(0, mb.shutter))
      : 0.5;
    if (samples <= 1 || shutter <= 0) {
      this.frame(time);
      return;
    }
    const fps = src.frame_rate ?? 30;
    const dur = typeof src.duration === 'number' ? src.duration : Number.POSITIVE_INFINITY;
    const clear =
      typeof src.background_color === 'string'
        ? parseColorPremultiplied(src.background_color)
        : ([0, 0, 0, 1] as const);
    const w = this.backend.width;
    const h = this.backend.height;
    const scene = this.acquireBlurTarget(0, w, h);
    let avg = this.acquireBlurTarget(1, w, h);
    let spare = this.acquireBlurTarget(2, w, h);
    const full = { cx: w / 2, cy: h / 2, width: w, height: h, rotation: 0 } as const;

    this.backend.beginFrame(clear as [number, number, number, number]);
    for (let k = 0; k < samples; k++) {
      const tk = Math.min(
        Math.max(time + ((k + 0.5) / samples - 0.5) * (shutter / fps), 0),
        dur,
      );
      this.backend.pushTarget(scene, clear as [number, number, number, number]);
      renderSourceFrame(src, this.makeContext(tk));
      this.backend.popTarget();

      if (k === 0) {
        this.backend.pushTarget(avg, [0, 0, 0, 0]);
        this.backend.drawTexturedQuad({ ...full, texture: scene.texture });
        this.backend.popTarget();
      } else {
        const a = 1 / (k + 1);
        const keep = 1 - a;
        this.backend.pushTarget(spare, [0, 0, 0, 0]);
        this.backend.drawTexturedQuad({ ...full, texture: avg.texture, tint: [keep, keep, keep, keep] });
        this.backend.drawTexturedQuad({ ...full, texture: scene.texture, tint: [a, a, a, a], blend: 'add' });
        this.backend.popTarget();
        [avg, spare] = [spare, avg];
      }
    }
    const bloom = resolveBloom(src, time);
    if (bloom) {
      this.applyBloom(avg, w, h, bloom);
    } else {
      this.backend.drawTexturedQuad({ ...full, texture: avg.texture });
    }
    this.backend.endFrame();
    // After submit — safe to destroy evicted targets on both backends.
    this.evictGroupTargets();
  }

  /** Resolve when all submitted GPU work has executed (see Backend.finish). */
  async gpuFinish(): Promise<void> {
    if (!this.initialized) return;
    await this.backend.finish();
  }

  /**
   * Set the soft cap (bytes) for the offscreen-FBO pool. ≤ 0 disables eviction
   * (unbounded — the legacy behavior). Lets the cloud render Job tighten the cap
   * on memory-constrained SwiftShader instances.
   */
  setGroupTargetPoolCap(bytes: number): void {
    this.groupTargetPoolCapBytes = bytes;
  }

  /**
   * Frame-boundary LRU eviction of the groupTargets offscreen-FBO pool. MUST be
   * called only AFTER backend.endFrame() (post queue.submit on WebGPU) so
   * destroyRenderTarget()'s synchronous gpuTexture.destroy() can never race a
   * not-yet-submitted command encoder. Entries touched THIS frame (lastTouched
   * === this.frameIndex) are never candidates; stale entries are dropped
   * least-recently-touched first until total pooled bytes (w*h*4) fall under the
   * cap. Safe because every pooled target is fully rewritten (create-or-reuse →
   * pushTarget+clear+draw) each frame it is used, so evicting an unused entry
   * only costs a realloc next time. No double-destroy: delete() removes the
   * entry, so the size-change path (group.ts/scene.ts) and dispose() never see
   * it again. MUST stay STATELESS across calls (no cached candidate/untouched
   * set) — frameIndex can advance >1 per output frame (per motion-blur sample +
   * the renderFinalFrame→frame() fallback).
   */
  private evictGroupTargets(): void {
    const cap = this.groupTargetPoolCapBytes;
    if (cap <= 0) return;
    let total = 0;
    const candidates: Array<{ key: string; entry: GroupClipTarget; bytes: number }> = [];
    for (const [key, entry] of this.groupTargets.entries()) {
      const bytes = entry.width * entry.height * 4;
      total += bytes;
      // Never evict an entry touched this frame.
      if (entry.lastTouched !== this.frameIndex) {
        candidates.push({ key, entry, bytes });
      }
    }
    if (total <= cap) return;
    // LRU first: oldest lastTouched evicted first (undefined sorts oldest).
    candidates.sort(
      (a, b) => (a.entry.lastTouched ?? -1) - (b.entry.lastTouched ?? -1),
    );
    for (const c of candidates) {
      if (total <= cap) break;
      this.backend.destroyRenderTarget(c.entry.target);
      this.groupTargets.delete(c.key);
      total -= c.bytes;
    }
  }

  private acquireBlurTarget(slot: number, width: number, height: number): RenderTarget {
    const existing = this.blurTargets[slot];
    if (existing && existing.width === width && existing.height === height) {
      return existing.target;
    }
    if (existing) this.backend.destroyRenderTarget(existing.target);
    const target = this.backend.createRenderTarget(width, height);
    this.blurTargets[slot] = { target, width, height };
    return target;
  }

  /**
   * Render one frame at the given time, awaiting any per-element async
   * work (video seeking) first. Used by the exporter to render frames
   * deterministically.
   */
  async renderAsync(source: Source, time: number): Promise<void> {
    if (!this.initialized) return;
    if (source !== this.currentSource) this.load(source);

    // Seek each active element-backed video to the right playhead.
    const sourceDuration = typeof source.duration === 'number' ? source.duration : 0;
    const seeks: Promise<void>[] = [];
    const activeSeek: Array<{ el: VideoElement; clock: number }> = [];
    this.collectActiveVideos(source.elements, time, sourceDuration, activeSeek);
    for (const { el, clock } of activeSeek) {
      const url = String(el.source ?? '');
      const asset = this.videos.get(url);
      if (!asset || !asset.video) continue;
      const videoTime = mapToMediaTime(
        clock,
        {
          elementStart: numberOrZero(el.time),
          trimStart: numberOrZero(el.trim_start),
          trimDuration: trimDurationOf(el.trim_duration),
          rate: rateOf(el.playback_rate),
          loop: el.loop === true,
          timeRemap: timeRemapOf(el.time_remap),
        },
        Number.isFinite(asset.video.duration) ? asset.video.duration : 0,
      );
      seeks.push(seekVideo(asset.video, videoTime));
    }
    if (seeks.length > 0) await Promise.all(seeks);

    // FrameSource-backed videos decode their exact frame here.
    await this.prepareVideoFrames(time);

    this.frame(time);
  }

  /**
   * Export to MP4. Renders frames serially through the same backend used
   * for preview — the canvas visibly resizes during export. For an off-
   * screen export, construct a separate ClipkitRuntime around an
   * OffscreenCanvas at the desired dimensions.
   */
  /**
   * Render each frame and stream its PNG (with alpha when `alpha`) to `onFrame`.
   * The transparent export path — the PNGs are assembled by a server-side ffmpeg
   * (ProRes 4444 / VP9-alpha). WebCodecs can't encode alpha, so this is the only
   * route to transparent output.
   */
  /**
   * Mix all of the loaded Source's audio (audio elements + video-embedded
   * tracks) into one AudioBuffer for export. Shared by both export paths —
   * the opaque MP4 path (export → WebCodecs muxer) and the transparent frame
   * path (exportFrames → WAV → ffmpeg) — so they never diverge. Returns null
   * when the comp has no audio (or the mix fails); the caller exports silently.
   */
  private async mixExportAudio(src: Source): Promise<AudioBuffer | null> {
    const totalDuration = typeof src.duration === 'number' ? src.duration : 10;
    const bufferMap = new Map<string, AudioBuffer>();
    for (const [url, buffer] of this.audioBuffers.entries()) bufferMap.set(url, buffer);
    try {
      return await mixSourceAudio(src, bufferMap, totalDuration);
    } catch (err) {
      getLogger().warn('Audio mix failed; exporting video only:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async exportFrames(options: {
    framerate?: number;
    alpha?: boolean;
    onFrame: (index: number, pngBase64: string) => void | Promise<void>;
    /**
     * Receives the mixed audio as a 16-bit PCM WAV (raw bytes) once, before
     * the frames stream. Not called when the comp has no audio. The frame
     * path has no muxer, so audio rides as a separate WAV the server-side
     * ffmpeg maps in as a second input.
     */
    onAudio?: (wav: ArrayBuffer) => void | Promise<void>;
    onProgress?: (progress: number) => void;
  }): Promise<number> {
    if (!this.initialized) throw new Error('ClipkitRuntime.exportFrames() called before init()');
    const src = this.currentSource;
    if (!src) throw new Error('No source loaded');

    // Mix + emit audio first (the frame path can't mux it inline). Shares the
    // exact mixing logic with export() via mixExportAudio so the two paths
    // can't drift. Silent comps emit nothing — onAudio is simply not called.
    if (options.onAudio) {
      const mixed = await this.mixExportAudio(src);
      if (mixed) await options.onAudio(audioBufferToWav(mixed));
    }

    this.transparentBackground = options.alpha === true;
    try {
      const exporter = new ClipkitExporter(this.canvas, this);
      return await exporter.exportFrames(src, options);
    } finally {
      this.transparentBackground = false;
    }
  }

  async export(options: ExportOptions = {}): Promise<Blob> {
    if (!this.initialized) throw new Error('ClipkitRuntime.export() called before init()');
    const src = this.currentSource;
    if (!src) throw new Error('No source loaded');

    // Mix audio if the source has any audio elements.
    let audioOptions: ExportOptions['audio'] = options.audio;
    if (!audioOptions) {
      const mixed = await this.mixExportAudio(src);
      if (mixed) audioOptions = { buffer: mixed };
    }

    // Resolve renderResolution → physical canvas dims + default bitrate.
    // The backend gets resized so coordinate math stays in source units
    // but the rasterized output is at the higher physical resolution.
    const sourceWidth = src.width ?? 1920;
    const sourceHeight = src.height ?? 1080;
    const resolution = options.renderResolution ?? 'source';
    const { pixelRatio, defaultBitrate, defaultCodec } = resolveRenderResolution(
      resolution,
      sourceWidth,
      sourceHeight,
    );

    const previousPhysW = this.backend.width * 1; // logical, but resize takes logical
    const previousPhysH = this.backend.height * 1;
    if (pixelRatio !== 1) {
      getLogger().info(
        `Export at ${resolution}: scaling backend to ${Math.round(sourceWidth * pixelRatio)}×${Math.round(sourceHeight * pixelRatio)} (pixelRatio=${pixelRatio.toFixed(3)})`,
      );
      this.backend.resize(sourceWidth, sourceHeight, pixelRatio);
    }

    try {
      const exporter = new ClipkitExporter(this.canvas, this);
      return await exporter.export(src, {
        codec: defaultCodec,
        bitrate: defaultBitrate,
        ...options,
        audio: audioOptions,
      });
    } finally {
      // Restore the backend to logical 1× so subsequent preview frames
      // don't render into a 4× backing store.
      if (pixelRatio !== 1) {
        this.backend.resize(previousPhysW, previousPhysH);
      }
    }
  }

  /** Release all GPU resources. After this the runtime is unusable. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Free textures via destroyTexture? No — dispose() on the backend
    // releases the device, which cascades through all textures.
    this.images.clear();
    for (const [, asset] of this.videos.entries()) asset.frameSource?.dispose();
    this.videos.clear();
    this.fontAtlases.clear();
    this.svgRasters.clear();
    this.maskedTexts.clear();
    for (const [, t] of this.groupTargets.entries()) this.backend.destroyRenderTarget(t.target);
    this.groupTargets.clear();
    for (const t of this.blurTargets) if (t) this.backend.destroyRenderTarget(t.target);
    this.blurTargets = [];
    this.luts.clear();
    this.backend.dispose();
  }

  private makeContext(time: number): RenderContext {
    const src = this.currentSource;
    const sourceDuration = src && typeof src.duration === 'number' ? src.duration : 0;
    const canvas = { width: this.backend.width, height: this.backend.height };
    // §4.4.2: the scene camera IS the root model matrix. Its xy block is
    // identity and z = 0 content keeps w = 1, so flat content renders
    // exactly as without a camera; layers reset to identity (§4.4.3).
    const rootMatrix = src?.camera ? cameraMatrix(src.camera, time, canvas) : MAT4_IDENTITY;
    // §4.4.3: `z` orders ALWAYS (no camera ⇒ pure stacking, camera ⇒
    // stacking + perspective), `track` is the tiebreak. So the depth
    // sort runs unless the author opted into fixed paint order via
    // `camera.sort: 'paint'`. Perf guard: a doc with NO camera and NO
    // depth fields anywhere can't reorder (all z = 0 ⇒ track order), so
    // skip the sort entirely — keeps the 2D / huge-track path cheap and
    // byte-identical.
    const depthSort = src?.camera
      ? src.camera.sort !== 'paint'
      : !!src && anyElementHasDepth(src.elements);
    // §4.8 lighting: resolve scene lights + the camera eye. Empty lights
    // ⇒ nothing is shaded (unlit, byte-identical).
    const lights = src ? resolveLights(src, time) : [];
    const environment = src ? resolveEnvironment(src, time) : null;
    // Image env: substitute the cached average color (from the loaded
    // equirect pixels) for the roughness-blurred reflection fallback.
    if (environment?.image) {
      const avg = this.envAvg.get(environment.image);
      if (avg) environment.avg = [avg[0], avg[1], avg[2]];
    }
    const eye = src?.camera
      ? cameraEyeWorld(src.camera, time, canvas)
      : [canvas.width / 2, canvas.height / 2, 1000] as [number, number, number];
    return {
      backend: this.backend,
      canvas,
      time,
      sourceDuration,
      frameIndex: this.frameIndex,
      images: this.images,
      videos: this.videos,
      fontAtlases: this.fontAtlases,
      svgRasters: this.svgRasters,
      maskedTexts: this.maskedTexts,
      groupTargets: this.groupTargets,
      luts: this.luts,
      modelMatrix: rootMatrix,
      worldMatrix: MAT4_IDENTITY,
      lights,
      eye,
      environment,
      depthSort,
      opacityFactor: 1,
      timeOffset: 0,
      surfaceWidth: this.backend.width,
      surfaceHeight: this.backend.height,
    };
  }
}

// ─── Local helpers (mirrors of compositor/scene.ts; kept private to avoid
// a circular import) ─────────────────────────────────────────────────────────

/**
 * True if any element in the tree carries a depth field (`z`, `x_rotation`,
 * `y_rotation`, or a 3D position path) — the perf guard for the no-camera
 * depth sort. `z_rotation` is in-plane (2D) and does NOT count. Mirrors the
 * `has` check in resolve.ts `resolve3D`.
 */
function anyElementHasDepth(elements: readonly Element[]): boolean {
  for (const raw of elements) {
    const el = raw as Element & {
      z?: unknown; x_rotation?: unknown; y_rotation?: unknown;
      elements?: Element[]; mask?: { elements?: Element[] };
    };
    if (el.z !== undefined || el.x_rotation !== undefined || el.y_rotation !== undefined) return true;
    if (
      el.keyframe_animations?.some(
        (k) =>
          k.property === 'z' || k.property === 'x_rotation' || k.property === 'y_rotation' ||
          (k.property === 'position' &&
            k.keyframes.some((kf) => Array.isArray(kf.value) && kf.value.length === 3)),
      )
    ) {
      return true;
    }
    if (el.type === 'group' && Array.isArray(el.elements) && anyElementHasDepth(el.elements)) return true;
    if (el.mask?.elements && anyElementHasDepth(el.mask.elements)) return true;
  }
  return false;
}

function isActiveAt(element: Element, time: number, sourceDuration: number): boolean {
  const start = numberOrZero(element.time);
  const dur = parseDuration(element.duration, sourceDuration - start);
  return time >= start && time <= start + dur;
}

function numberOrZero(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseDuration(v: unknown, fallback: number): number {
  if (v === 'auto' || v === 'end' || v == null) return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

// Mark unused logger import so tree-shakers don't complain.
void getLogger;
