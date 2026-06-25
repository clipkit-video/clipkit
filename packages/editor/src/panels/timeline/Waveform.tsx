// Clip waveform — draws REAL min/max peaks (A3's extractWaveformPeaks,
// cached per URL) onto a canvas sized to the clip. Decode failures
// (silent video containers, CORS) just render nothing.

'use client';

import { useEffect, useRef } from 'react';
import { extractWaveformPeaks, type WaveformPeaks } from '@clipkit/playback';

export function Waveform({
  url,
  trimStart = 0,
  mediaWindow,
  color,
  className,
}: {
  url: string;
  /** Seconds into the media where the clip starts. */
  trimStart?: number;
  /** Seconds of media the clip shows (defaults to the rest). */
  mediaWindow?: number;
  /** Peak tint (clip-type colored per design/refs). */
  color?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    extractWaveformPeaks(url)
      .then((wf: WaveformPeaks) => {
        if (cancelled || !canvasRef.current) return;
        draw(canvasRef.current, wf, trimStart, mediaWindow, color);
      })
      .catch(() => {
        /* no decodable audio — leave the clip body plain */
      });
    return () => {
      cancelled = true;
    };
  }, [url, trimStart, mediaWindow, color]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}

function draw(
  canvas: HTMLCanvasElement,
  wf: WaveformPeaks,
  trimStart: number,
  mediaWindow: number | undefined,
  color?: string,
): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const windowSec = mediaWindow ?? Math.max(0, wf.duration - trimStart);
  if (windowSec <= 0) return;
  const startBucket = trimStart * wf.peaksPerSecond;
  const bucketsPerPx = (windowSec * wf.peaksPerSecond) / w;
  const mid = h / 2;
  const totalBuckets = wf.peaks.length / 2;

  ctx.fillStyle = color ?? 'rgba(255, 255, 255, 0.28)';
  for (let x = 0; x < w; x++) {
    const b0 = Math.floor(startBucket + x * bucketsPerPx);
    const b1 = Math.max(b0 + 1, Math.floor(startBucket + (x + 1) * bucketsPerPx));
    let min = 0;
    let max = 0;
    for (let b = b0; b < b1 && b < totalBuckets; b++) {
      if (b < 0) continue;
      min = Math.min(min, wf.peaks[b * 2]!);
      max = Math.max(max, wf.peaks[b * 2 + 1]!);
    }
    const y0 = mid - max * (mid - 1);
    const y1 = mid - min * (mid - 1);
    ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}
