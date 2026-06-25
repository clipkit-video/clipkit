import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipkitRuntime } from '@clipkit/runtime';
import type { Source } from '@clipkit/protocol';
import { validate } from '@clipkit/protocol';
import { EXAMPLES, HELLO_CLIPKIT, type ExampleId } from './examples';

// The default-default — also lives in examples.ts as HELLO_CLIPKIT. Kept here
// only to keep this file self-contained if examples.ts is ever removed.
// Edit the version in examples.ts when changing the default.
const INITIAL_SOURCE_FALLBACK: Source = {
  output_format: 'mp4',
  width: 1920,
  height: 1080,
  duration: 10,
  frame_rate: 30,
  elements: [
    {
      id: 'bg',
      type: 'shape',
      layer: 4,
      time: 0,
      duration: 10,
      shape: 'rectangle',
      x: 960,
      y: 540,
      width: 1600,
      height: 800,
      fill_color: '#1e293b',
      border_radius: 40,
      opacity: 100,
    },
    {
      id: 'accent',
      type: 'shape',
      layer: 3,
      time: 0,
      duration: 10,
      shape: 'ellipse',
      x: 400,
      y: 300,
      width: 300,
      height: 300,
      fill_color: '#3b82f6',
      opacity: 100,
      animations: [
        { type: 'scale-in', duration: 0.8, easing: 'ease-out-back' },
        { type: 'fade-out', duration: 0.5, time: 'end' },
      ],
    },
    {
      id: 'title',
      type: 'text',
      layer: 2,
      time: 0,
      duration: 10,
      text: 'Hello Clipkit!',
      x: 960,
      y: 380,
      font_family: 'sans-serif',
      font_size: 96,
      font_weight: 'bold',
      fill_color: '#ffffff',
      opacity: 100,
      animations: [
        { type: 'fade-in', duration: 1.0 },
        { type: 'slide-up-in', duration: 1.0, easing: 'ease-out-cubic' },
      ],
    },
    // To add audio: drop in an element like this with a CORS-enabled URL.
    // The runtime decodes it on preload(), mixes it via OfflineAudioContext
    // during export(), and writes an AAC track into the MP4.
    //   {
    //     id: 'soundtrack',
    //     type: 'audio',
    //     track: 5,
    //     time: 0,
    //     duration: 10,
    //     source: 'https://your-cdn.example.com/audio.mp3',
    //     volume: 80,
    //   },
    {
      // Word-timed caption. Try changing `style` to:
      //   'fade_reveal'  | 'kinetic_typewriter' | 'word_pop'
      id: 'captions',
      type: 'caption',
      layer: 1,
      time: 1,
      duration: 8,
      x: 960,
      y: 760,
      font_family: 'sans-serif',
      font_size: 64,
      font_weight: 'bold',
      fill_color: '#ffffff',
      highlight_color: '#ffd60a',
      style: 'tiktok_bounce',
      words: [
        { text: 'Word', start: 0, end: 0.45 },
        { text: 'timed', start: 0.45, end: 0.95 },
        { text: 'captions', start: 0.95, end: 1.7 },
        { text: 'with', start: 1.7, end: 2.0 },
        { text: 'kinetic', start: 2.0, end: 2.6 },
        { text: 'styles!', start: 2.6, end: 3.6 },
      ],
    },
  ],
};

// Suppress the unused-warning while keeping the fallback exported.
void INITIAL_SOURCE_FALLBACK;

const DEFAULT_EXAMPLE: ExampleId = 'hello';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ClipkitRuntime | null>(null);

  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeApi, setActiveApi] = useState<'webgpu' | 'webgl2' | null>(null);
  const [backendPref, setBackendPref] = useState<'auto' | 'webgpu' | 'webgl2'>('auto');
  const [exampleId, setExampleId] = useState<ExampleId>(DEFAULT_EXAMPLE);

  const [jsonText, setJsonText] = useState(() => JSON.stringify(HELLO_CLIPKIT, null, 2));
  const [source, setSource] = useState<Source>(HELLO_CLIPKIT);
  const [parseError, setParseError] = useState<string | null>(null);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Refs mirror state so the long-lived RAF loop reads fresh values without restarting.
  const sourceRef = useRef(source);
  const timeRef = useRef(time);
  const playingRef = useRef(playing);
  useEffect(() => { sourceRef.current = source; }, [source]);
  useEffect(() => { timeRef.current = time; }, [time]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const duration = useMemo(
    () => (typeof source.duration === 'number' ? source.duration : 10),
    [source.duration],
  );
  const durationRef = useRef(duration);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // Init runtime. Reruns when the user switches backend preference.
  useEffect(() => {
    let cancelled = false;
    let localRuntime: ClipkitRuntime | null = null;
    setReady(false);
    setInitError(null);
    setActiveApi(null);
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const runtime = new ClipkitRuntime(canvas);
        const ok = await runtime.init({ backend: backendPref });
        if (cancelled) { runtime.dispose(); return; }
        if (!ok) {
          setInitError(
            `Backend "${backendPref}" failed to initialize. ` +
              (backendPref === 'webgpu'
                ? 'WebGPU requires Chrome / Edge or another browser with WebGPU enabled.'
                : backendPref === 'webgl2'
                ? 'WebGL2 init failed. The canvas may have been locked to another context — try a hard refresh.'
                : 'Neither WebGPU nor WebGL2 is available in this browser.'),
          );
          return;
        }
        setActiveApi(runtime.api);
        runtime.load(sourceRef.current);
        await runtime.preload();
        if (cancelled) { runtime.dispose(); return; }
        localRuntime = runtime;
        runtimeRef.current = runtime;
        setReady(true);
      } catch (e) {
        if (!cancelled) setInitError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (localRuntime) {
        localRuntime.dispose();
        if (runtimeRef.current === localRuntime) runtimeRef.current = null;
      }
      setReady(false);
    };
  }, [backendPref]);

  // When source changes, reload + preload + re-render.
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready) return;
    let cancelled = false;
    (async () => {
      runtime.load(source);
      try {
        await runtime.preload();
      } catch (e) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error('[playground] preload failed', e);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [source, ready]);

  // JSON editor live validation.
  const handleJsonChange = (text: string) => {
    setJsonText(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setParseError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    const result = validate(parsed);
    if (!result.valid) {
      const first = result.errors[0];
      setParseError(
        `${first ? `${first.path.join('.') || '(root)'} — ${first.message}` : 'validation failed'}${
          result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : ''
        }`,
      );
      return;
    }
    setParseError(null);
    setSource(result.data);
  };

  // Preview audio playback. The runtime only mixes audio at export time —
  // for preview, we maintain an HTMLAudioElement per audio URL and sync
  // its play/pause/currentTime to the playhead inside the RAF loop.
  //
  // tracksRef holds `{ audio, startSec }` for each audio element in the
  // current source. Rebuilt whenever the source changes.
  const audioTracksRef = useRef<Array<{ audio: HTMLAudioElement; startSec: number }>>([]);
  useEffect(() => {
    // Pause + drop any previously-allocated audio elements.
    for (const t of audioTracksRef.current) t.audio.pause();
    const next: Array<{ audio: HTMLAudioElement; startSec: number }> = [];
    for (const el of source.elements) {
      if (el.type !== 'audio') continue;
      const url = String((el as { source?: unknown }).source ?? '');
      if (!url) continue;
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      const startSec = typeof el.time === 'number' ? el.time : parseFloat(String(el.time ?? 0)) || 0;
      next.push({ audio, startSec });
    }
    audioTracksRef.current = next;
    return () => {
      for (const t of next) t.audio.pause();
    };
  }, [source]);

  // Continuous RAF loop: always renders inside a frame so the WebGPU swap-chain
  // texture is presented to the compositor. Advances time when playing.
  useEffect(() => {
    if (!ready) return;
    let frameId = 0;
    let lastWallTime = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastWallTime) / 1000;
      lastWallTime = now;
      if (playingRef.current) {
        const next = timeRef.current + dt;
        if (next >= durationRef.current) {
          timeRef.current = durationRef.current;
          playingRef.current = false;
          setTime(durationRef.current);
          setPlaying(false);
        } else {
          timeRef.current = next;
          setTime(next);
        }
      }
      const runtime = runtimeRef.current;
      if (runtime) runtime.frame(timeRef.current);

      // Audio sync — re-seek if drift > 250ms, toggle play/pause to match.
      for (const t of audioTracksRef.current) {
        const localT = timeRef.current - t.startSec;
        const shouldPlay = playingRef.current && localT >= 0 && localT < t.audio.duration;
        if (shouldPlay) {
          if (Math.abs(t.audio.currentTime - localT) > 0.25) {
            t.audio.currentTime = Math.max(0, localT);
          }
          if (t.audio.paused) t.audio.play().catch(() => {});
        } else {
          if (!t.audio.paused) t.audio.pause();
          if (localT < 0 && t.audio.currentTime !== 0) t.audio.currentTime = 0;
        }
      }

      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [ready]);

  const handleExport = async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setExporting(true);
    setExportError(null);
    setExportProgress(0);
    try {
      const blob = await runtime.export({
        codec: 'avc1.42002A',
        bitrate: 5_000_000,
        framerate: 30,
        onProgress: setExportProgress,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clipkit-export.mp4';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  return (
    <div className="app">
      <div className="header">
        <h1>Clipkit playground</h1>
        <div className="header-right">
          <label className="backend-select">
            example:
            <select
              value={exampleId}
              onChange={(e) => {
                const id = e.target.value as ExampleId;
                setExampleId(id);
                const ex = EXAMPLES.find((x) => x.id === id);
                if (ex) {
                  setTime(0);
                  setPlaying(false);
                  setJsonText(JSON.stringify(ex.source, null, 2));
                  setSource(ex.source);
                  setParseError(null);
                }
              }}
            >
              {EXAMPLES.map((ex) => (
                <option key={ex.id} value={ex.id}>{ex.name}</option>
              ))}
            </select>
          </label>
          <label className="backend-select">
            backend:
            <select
              value={backendPref}
              onChange={(e) => setBackendPref(e.target.value as 'auto' | 'webgpu' | 'webgl2')}
            >
              <option value="auto">auto</option>
              <option value="webgpu">webgpu</option>
              <option value="webgl2">webgl2</option>
            </select>
          </label>
          <span className="status">
            {initError ? 'init error' : ready ? `${activeApi} ready` : 'initializing…'}
          </span>
        </div>
      </div>

      <div className="split">
        <div className="pane editor-pane">
          <div className="pane-label">source.json</div>
          <textarea
            className="editor"
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
            spellCheck={false}
          />
          {parseError && <div className="error inline">{parseError}</div>}
        </div>

        <div className="pane preview-pane">
          <div className="pane-label">preview</div>
          {initError && <div className="error">{initError}</div>}
          <div className="stage">
            {/* `key` forces React to remount the canvas when the backend changes.
                Once a canvas has been bound to one context type (webgpu or
                webgl2), it can't be bound to another — the underlying
                HTMLCanvasElement is locked. Remounting gets us a fresh one. */}
            <canvas key={`canvas-${backendPref}`} ref={canvasRef} />
          </div>
          {exportError && <div className="error">{exportError}</div>}
          <div className="controls">
            <button disabled={!ready || exporting} onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <span className="time">
              {time.toFixed(2)}s / {duration.toFixed(2)}s
            </span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={time}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
              disabled={!ready || exporting}
            />
            <button disabled={!ready || exporting} onClick={handleExport}>
              {exporting ? `Exporting ${Math.round(exportProgress * 100)}%` : 'Export MP4'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
