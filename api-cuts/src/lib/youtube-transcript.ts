// Shim: youtube-transcript declares "type":"module" but its "main" field
// points to a CJS build. We import the ESM build directly to work around it.
export {
  YoutubeTranscript,
  YoutubeTranscriptError,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  fetchTranscript,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — no types for the ESM sub-path, class identity is identical
} from "youtube-transcript/dist/youtube-transcript.esm.js";
