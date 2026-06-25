// "Transcribe" affordance for a caption element — turns an audio/video element
// on the timeline into the caption's words, running Whisper IN THE BROWSER.
//
// The caption is ONE element holding the whole transcript; `max_length` windows
// it (a few words / N letters at a time) at render. Whisper runs in a Web WORKER
// (transcribe.worker.ts) so inference never freezes the editor; the heavy model
// only loads when you transcribe.

'use client';

import { useState } from 'react';
import type { CaptionWord, Element } from '@clipkit/protocol';
import { useEditor, useEditorStore } from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';

const MODEL = 'Xenova/whisper-base'; // multilingual, ~75 MB; cached after first run.
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

interface MonoAudio { samples: Float32Array; sampleRate: number }
interface TranscriptLike { text: string; words: { text: string; start: number; end: number }[]; duration: number }

/** Run Whisper inference in a Web Worker. Resolves the transcript result. */
function runWorker(audio: MonoAudio, onStatus: (s: string) => void): Promise<TranscriptLike> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribe.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; info?: { status: string; progress?: number }; result?: TranscriptLike; message?: string };
      if (m.type === 'progress') {
        if (m.info?.status === 'progress' && m.info.progress != null) onStatus(`downloading model ${m.info.progress.toFixed(0)}%`);
        else if (m.info?.status === 'ready') onStatus('transcribing…');
      } else if (m.type === 'result' && m.result) {
        worker.terminate();
        resolve(m.result);
      } else if (m.type === 'error') {
        worker.terminate();
        reject(new Error(m.message ?? 'transcription failed'));
      }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'worker error')); };
    // Transfer the PCM buffer (zero-copy) so the main thread isn't blocked copying it.
    worker.postMessage({ samples: audio.samples, sampleRate: audio.sampleRate, model: MODEL }, [audio.samples.buffer]);
  });
}

export function CaptionTranscribe() {
  const { updateElement } = useEditor();
  const selId = useEditorStore((s) => s.selection[0]);
  const elements = useEditorStore((s) => s.source.elements);
  const caption = elements.find((e) => e.id === selId && e.type === 'caption');
  const sources = elements.filter(
    (e): e is Element & { source: string; name?: string; id?: string } =>
      (e.type === 'video' || e.type === 'audio') && typeof (e as { source?: unknown }).source === 'string',
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState('');
  const picked = sources.find((s) => (s.id ?? s.source) === pickedId);

  const transcribeFrom = async (src: Element & { source: string }): Promise<void> => {
    if (!caption || typeof caption.id !== 'string') return;
    setBusy(true);
    setStatus('loading…');
    try {
      const res = await fetch(src.source);
      if (!res.ok) throw new Error('could not read the source media');
      const blob = await res.blob();

      const browser = await import('@clipkit/speech-to-text/browser');
      const core = await import('@clipkit/speech-to-text');
      setStatus('decoding audio…');
      const audio = await browser.decodeAudioBlob(blob);

      setStatus('transcribing…');
      const result = await runWorker(audio, setStatus);
      const words: CaptionWord[] = core.toCaptionWords(result);
      if (words.length === 0) { setStatus('no speech detected'); return; }

      // Fill THIS caption with the whole transcript + window it (auto chunks by
      // a few words). The source's timeline position offsets the caption so it
      // syncs to the media.
      const offset = num((src as { time?: unknown }).time, 0);
      const patch: Partial<Element> = {
        words,
        // Window by default so a transcript never dumps on screen at once.
        max_length: typeof (caption as { max_length?: unknown }).max_length === 'number' ? (caption as { max_length: number }).max_length : 16,
        ...(offset ? { time: offset } : {}),
      } as Partial<Element>;
      updateElement(caption.id, patch);
      setStatus(`${words.length} words`);
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'transcription failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 pb-1.5 mb-1 border-b border-border">
      <span className="text-[10px] font-medium text-muted-foreground">Transcribe from</span>
      {sources.length === 0 ? (
        <span className="text-[10px] text-muted-foreground/70">Add an audio or video element to transcribe its speech into captions.</span>
      ) : (
        <div className="flex items-center gap-1">
          <select
            value={pickedId}
            disabled={busy}
            onChange={(e) => setPickedId(e.target.value)}
            className={cn('h-6 flex-1 min-w-0 bg-field hover:bg-field-hover rounded-md px-1.5 text-[11px] text-foreground/90 outline-none cursor-pointer transition-colors disabled:opacity-40')}
          >
            <option value="">Select a source…</option>
            {sources.map((s) => (
              <option key={s.id ?? s.source} value={s.id ?? s.source}>
                {s.type === 'video' ? '▶ ' : '♪ '}{s.name ?? s.type}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !picked}
            onClick={() => picked && void transcribeFrom(picked)}
            className={cn('h-6 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none shrink-0')}
          >
            {busy ? '…' : 'Transcribe'}
          </button>
        </div>
      )}
      {status && <span className="text-[10px] text-muted-foreground tabular-nums">{status}</span>}
    </div>
  );
}
