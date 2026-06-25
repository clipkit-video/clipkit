// PerfHud — small floating overlay showing live engine stats while
// preview is running. Useful for diagnosing choppiness: at a glance
// you can tell whether the bottleneck is the worker (frames not
// arriving fast enough), the main thread (paint gap jitter), or
// buffer starvation (engine can't keep up with playback).
//
// Toggled by Shift+P (wired in Editor.tsx). Polls engine.getStats()
// every 250ms — cheap enough to not affect the metrics it measures.

import { useEffect, useState } from 'react';
import type { EngineStats } from '@clipkit/playback';
import { useEditorContext } from '@clipkit/editor-core';
import { useEditorStore } from '@clipkit/editor-core';

const POLL_MS = 250;

export function PerfHud() {
  const { engine } = useEditorContext();
  const open = useEditorStore((s) => s.ui.perfHudOpen);
  const [stats, setStats] = useState<EngineStats | null>(null);

  useEffect(() => {
    if (!open || !engine) return;
    const tick = (): void => setStats(engine.getStats());
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [open, engine]);

  if (!open || !stats) return null;

  return (
    <div
      role="status"
      aria-label="Playback performance"
      className="pointer-events-none absolute top-2 right-2 z-40 select-none rounded-md px-2.5 py-2 font-mono text-[10.5px] leading-tight"
      style={{
        background: 'rgba(0, 0, 0, 0.78)',
        color: 'var(--color-foreground)',
        backdropFilter: 'blur(6px)',
        minWidth: 168,
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-muted-foreground/70 uppercase tracking-wider">
        <span>perf</span>
        <span className="text-[9px] opacity-70">shift+p</span>
      </div>
      <Row label="fps" value={`${stats.fps} / ${stats.targetFps}`} tone={fpsTone(stats)} />
      <Row label="buffer" value={`${stats.bufferAheadSec.toFixed(2)}s`} tone={bufferTone(stats)} />
      <Row
        label="gap"
        value={`${stats.frameGapMs.toFixed(1)} (${stats.frameGapMaxMs.toFixed(0)})`}
        tone={gapTone(stats)}
      />
      <Row
        label="worker"
        value={`${stats.workerLatencyMs.toFixed(1)}ms`}
        tone={workerTone(stats)}
      />
      <Row
        label="↳ decode"
        value={`${stats.prepareMs.toFixed(1)}ms`}
        tone={subTone(stats.prepareMs, stats.targetFps)}
      />
      <Row
        label="↳ render"
        value={`${stats.renderMs.toFixed(1)}ms`}
        tone={subTone(stats.renderMs, stats.targetFps)}
      />
      <Row
        label="↳ readback"
        value={`${stats.videoFrameMs.toFixed(1)}ms`}
        tone={subTone(stats.videoFrameMs, stats.targetFps)}
      />
      <Row label="blur smp" value={stats.blurSamples.toFixed(1)} tone="muted" />
      <Row
        label="↳ total"
        value={`${stats.workerTotalMs.toFixed(1)}ms`}
        tone={subTone(stats.workerTotalMs, stats.targetFps)}
      />
      <Row
        label="queue lag"
        value={`${stats.queueLagMs.toFixed(1)}ms`}
        tone={subTone(stats.queueLagMs, stats.targetFps)}
      />
      <Row
        label="drawImage"
        value={`${stats.drawImageMs.toFixed(1)}ms`}
        tone={subTone(stats.drawImageMs, stats.targetFps)}
      />
      <Row
        label="starve"
        value={`${stats.starvationCount}`}
        tone={stats.starvationCount > 0 ? 'red' : 'green'}
      />
      <Row label="inflight" value={`${stats.inflight}`} tone="muted" />
    </div>
  );
}

type Tone = 'green' | 'yellow' | 'red' | 'muted';

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  return (
    <div className="flex items-center justify-between gap-3 tabular-nums">
      <span className="text-muted-foreground/70">{label}</span>
      <span style={{ color: toneColor(tone) }}>{value}</span>
    </div>
  );
}

function toneColor(t: Tone): string {
  switch (t) {
    case 'green':  return 'oklch(0.78 0.18 145)';
    case 'yellow': return 'oklch(0.82 0.18 90)';
    case 'red':    return 'oklch(0.70 0.25 25)';
    case 'muted':  return 'var(--color-muted-foreground)';
  }
}

// ── Threshold rules ───────────────────────────────────────────────

function fpsTone(s: EngineStats): Tone {
  if (s.fps >= s.targetFps * 0.95) return 'green';
  if (s.fps >= s.targetFps * 0.8) return 'yellow';
  return 'red';
}

function bufferTone(s: EngineStats): Tone {
  if (s.bufferAheadSec >= 0.5) return 'green';
  if (s.bufferAheadSec >= 0.15) return 'yellow';
  return 'red';
}

function gapTone(s: EngineStats): Tone {
  const targetGap = 1000 / s.targetFps;
  if (s.frameGapMaxMs <= targetGap * 1.5) return 'green';
  if (s.frameGapMaxMs <= targetGap * 2.5) return 'yellow';
  return 'red';
}

function workerTone(s: EngineStats): Tone {
  const budget = 1000 / s.targetFps;
  if (s.workerLatencyMs <= budget) return 'green';
  if (s.workerLatencyMs <= budget * 2) return 'yellow';
  return 'red';
}

function subTone(ms: number, targetFps: number): Tone {
  const budget = 1000 / targetFps;
  if (ms <= budget) return 'green';
  if (ms <= budget * 2) return 'yellow';
  return 'red';
}
