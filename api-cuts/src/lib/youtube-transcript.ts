// Re-export: youtube-transcript >= 1.3 ships proper ESM/CJS builds via "exports",
// so no deep import is needed.
export {
  YoutubeTranscript,
  YoutubeTranscriptError,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  fetchTranscript,
} from "youtube-transcript";
