// `clipkit transcribe <file>` — transcribe an audio/video file into
// word-timestamped captions (the protocol's `caption` element `words[]`).
//
// Runs Whisper locally via @clipkit/speech-to-text (no API, no key). Prints the
// words[] JSON by default, or a full caption element with --element. Progress
// goes to stderr so stdout stays clean, machine-readable JSON — the agent path.
//
// The model runs in an isolated worker (transcribeFile), so onnxruntime-node's
// harmless teardown abort never affects this process — clean exit 0 on success.

import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { toCaptionWords } from '@clipkit/speech-to-text';
import { transcribeFile } from '@clipkit/speech-to-text/node';

interface Opts {
  model: string;
  language?: string;
  out?: string;
  element?: boolean;
  layer: string;
}

export function transcribeCommand(program: Command): void {
  program
    .command('transcribe <file>')
    .description('Transcribe an audio/video file into caption words (local Whisper; needs ffmpeg)')
    .option('-m, --model <id>', 'Whisper model id (Hugging Face)', 'Xenova/whisper-base')
    .option('-l, --language <code>', 'force a language (e.g. en); default auto-detect')
    .option('-o, --out <file>', 'write JSON here (default: stdout)')
    .option('-e, --element', 'emit a full caption element instead of just words[]')
    .option('-t, --layer <n>', 'layer for --element (lower = nearer front)', '3')
    .action(async (file: string, opts: Opts) => {
      const log = (s: string): void => void process.stderr.write(s);
      log(`transcribing ${file} (${opts.model})…\n`);

      const seen = new Set<string>();
      const result = await transcribeFile(file, {
        model: opts.model,
        language: opts.language,
        onLog: (line) => {
          // The worker logs "  ↓ <file>" lines as the model downloads.
          if (line.includes('↓') && !seen.has(line)) { seen.add(line); log(line); }
        },
      });

      const words = toCaptionWords(result);
      log(`  ${words.length} words, ${result.duration.toFixed(1)}s\n`);

      const payload = opts.element
        ? { type: 'caption', time: 0, layer: Number(opts.layer) || 3, words }
        : words;
      const json = JSON.stringify(payload, null, 2);
      if (opts.out) {
        await writeFile(opts.out, json + '\n');
        log(`wrote ${opts.out}\n`);
      } else {
        process.stdout.write(json + '\n');
      }
    });
}
