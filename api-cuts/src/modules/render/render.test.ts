import { describe, it, expect } from "vitest";
import { generateAss } from "../../lib/subtitle.js";
import { RenderRequestSchema } from "./render.schema.js";

// ── generateAss ───────────────────────────────────────────────────────────────

const SEG = (offset: number, duration: number, text: string) => ({
  offset,
  duration,
  text,
});

describe("generateAss", () => {
  it("produces a valid ASS file with Script Info and Events sections", () => {
    const ass = generateAss(
      [SEG(0, 3000, "Hello world")],
      0,
      30_000,
      1080,
      1920
    );
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("[Events]");
    expect(ass).toContain("Dialogue:");
  });

  it("sets PlayResX/PlayResY from width/height params", () => {
    const ass = generateAss([SEG(0, 2000, "Hi")], 0, 10_000, 720, 1280);
    expect(ass).toContain("PlayResX: 720");
    expect(ass).toContain("PlayResY: 1280");
  });

  it("shifts timestamps relative to cutStartMs", () => {
    // Segment starts at 10s but the cut starts at 8s → should appear at 2s
    const ass = generateAss(
      [SEG(10_000, 3_000, "Shifted")],
      8_000,
      20_000,
      1080,
      1920
    );
    // 2000 ms = 0:00:02.00 in ASS
    expect(ass).toContain("0:00:02.00");
  });

  it("discards segments fully outside the cut window", () => {
    const ass = generateAss(
      [
        SEG(0, 2_000, "Before cut"),    // ends before cutStartMs=5000
        SEG(5_500, 3_000, "Inside"),     // overlaps the window
        SEG(20_000, 2_000, "After cut"), // starts after cutEndMs=15000
      ],
      5_000,
      15_000,
      1080,
      1920
    );
    expect(ass).not.toContain("Before cut");
    expect(ass).toContain("Inside");
    expect(ass).not.toContain("After cut");
  });

  it("splits long segments into multiple dialogue lines", () => {
    const longText = "word ".repeat(20).trim(); // ~100 chars
    const ass = generateAss(
      [SEG(0, 10_000, longText)],
      0,
      30_000,
      1080,
      1920,
      { maxCharsPerLine: 20 }
    );
    const dialogueCount = (ass.match(/^Dialogue:/gm) ?? []).length;
    expect(dialogueCount).toBeGreaterThan(1);
  });

  it("uses bottom alignment by default (ASS alignment=2)", () => {
    const ass = generateAss([SEG(0, 2000, "Hi")], 0, 10_000, 1080, 1920);
    // Alignment=2 appears in the Style line
    expect(ass).toMatch(/Style:.*,2,/);
  });

  it("uses top alignment when position=top (ASS alignment=8)", () => {
    const ass = generateAss([SEG(0, 2000, "Hi")], 0, 10_000, 1080, 1920, {
      position: "top",
    });
    expect(ass).toMatch(/Style:.*,8,/);
  });

  it("escapes curly braces in segment text", () => {
    const ass = generateAss(
      [SEG(0, 2_000, "Text {with} braces")],
      0,
      10_000,
      1080,
      1920
    );
    expect(ass).not.toContain("{with}");
    expect(ass).toContain("\\{with\\}");
  });
});

// ── RenderRequestSchema ───────────────────────────────────────────────────────

describe("RenderRequestSchema", () => {
  const valid = {
    storageKey: "cuts/dQw4w9WgXcQ/5000-50000.mp4",
    tempo_inicial: 5_000,
    tempo_final: 50_000,
    segments: [{ text: "Hello", offset: 5_000, duration: 2_000 }],
  };

  it("accepts a valid request with defaults", () => {
    const r = RenderRequestSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.resolution.width).toBe(1080);
      expect(r.data.resolution.height).toBe(1920);
      expect(r.data.subtitleStyle?.fontSize).toBe(80);
    }
  });

  it("rejects when tempo_final <= tempo_inicial", () => {
    const r = RenderRequestSchema.safeParse({
      ...valid,
      tempo_inicial: 50_000,
      tempo_final: 10_000,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty segments array", () => {
    const r = RenderRequestSchema.safeParse({ ...valid, segments: [] });
    expect(r.success).toBe(false);
  });

  it("accepts custom subtitle style", () => {
    const r = RenderRequestSchema.safeParse({
      ...valid,
      subtitleStyle: { fontSize: 60, position: "top", bold: false },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.subtitleStyle?.fontSize).toBe(60);
      expect(r.data.subtitleStyle?.position).toBe("top");
      expect(r.data.subtitleStyle?.bold).toBe(false);
    }
  });
});
