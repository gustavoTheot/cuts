import { describe, it, expect } from "vitest";
import { extractVideoId } from "./transcription.service.js";
import { AppError } from "../../shared/errors.js";

describe("extractVideoId", () => {
  it("extracts ID from watch?v= URL", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  it("extracts ID from youtu.be short URL", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from YouTube Shorts URL", () => {
    expect(
      extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")
    ).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from URL with extra query params", () => {
    expect(
      extractVideoId(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&list=PL123"
      )
    ).toBe("dQw4w9WgXcQ");
  });

  it("throws AppError 400 for non-YouTube URL", () => {
    expect(() => extractVideoId("https://vimeo.com/123456")).toThrow(AppError);
    expect(() => extractVideoId("https://vimeo.com/123456")).toThrow(
      "Cannot extract video ID from URL"
    );
  });

  it("throws AppError 400 for malformed URL", () => {
    expect(() => extractVideoId("not-a-url")).toThrow(AppError);
  });
});
