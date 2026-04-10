import ffmpegStatic from "ffmpeg-static";

/** Returns the ffmpeg binary path — bundled static build or system PATH. */
export function getFfmpegPath(): string {
  return (ffmpegStatic as unknown as string) ?? "ffmpeg";
}
