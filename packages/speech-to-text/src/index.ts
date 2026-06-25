// @clipkit/speech-to-text — transcribe an audio/video source into word-
// timestamped captions. One Whisper model (Transformers.js / ONNX) runs in the
// browser and in Node; no paid API. The output maps onto the protocol's
// `caption` element via `toCaptionWords`. Authoring-time only — the runtime
// never sees this; it just renders the `words[]` we produce.
//
//   transcribe(audio)        → word-timestamped transcript
//   toCaptionWords(result)   → caption element words[]  (the protocol bridge)
//
// Audio decoding is env-specific — import from the matching entry point:
//   Node:    import { decodeAudioFile } from '@clipkit/speech-to-text/node';
//   Browser: import { decodeAudioBlob } from '@clipkit/speech-to-text/browser';

export { transcribe, type TranscribeOptions, type WhisperModel } from './transcribe.js';
export { toCaptionWords, toCaptionFields, toCaptionSegments, segmentWords, type ToCaptionWordsOptions, type ToCaptionSegmentsOptions, type CaptionSegment } from './caption.js';
export type { TranscriptResult, TranscriptWord, MonoAudio } from './types.js';
