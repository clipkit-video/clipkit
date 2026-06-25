// transcribeFile — the safe, one-call Node entry: decode + transcribe a file,
// returning a TranscriptResult. The model runs in a worker subprocess so the
// caller's process is never touched by onnxruntime-node's teardown abort. Both
// the CLI and the MCP server use this; neither has to know about the quirk.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TranscriptResult } from './types.js';

const WORKER = fileURLToPath(new URL('./worker.js', import.meta.url));

export interface TranscribeFileOptions {
  /** Whisper model id (Hugging Face). Default 'Xenova/whisper-base'. */
  model?: string;
  /** Force a language (e.g. 'en'); omit to auto-detect. */
  language?: string;
  /** Streamed worker stderr (model-download progress lines). */
  onLog?: (line: string) => void;
}

/**
 * Transcribe an audio/video file → word-timestamped transcript. Requires
 * `ffmpeg` on PATH. Runs the model in an isolated worker, so a long-running
 * caller (MCP server) stays alive regardless of the model runtime's teardown.
 */
export function transcribeFile(file: string, options: TranscribeFileOptions = {}): Promise<TranscriptResult> {
  const { model, language, onLog } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, JSON.stringify({ file, model, language })], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => onLog?.(d.toString()));
    child.on('error', reject);
    child.on('close', () => {
      const trimmed = out.trim();
      if (!trimmed) {
        reject(new Error('transcription produced no output (check ffmpeg + the file)'));
        return;
      }
      try {
        resolve(JSON.parse(trimmed) as TranscriptResult);
      } catch {
        reject(new Error('transcription output was not valid JSON'));
      }
    });
  });
}
