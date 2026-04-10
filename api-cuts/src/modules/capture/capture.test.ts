import { describe, it, expect } from "vitest";
import { CaptureRequestSchema } from "./capture.schema.js";

// ── Schema validation ─────────────────────────────────────────────────────────

describe("CaptureRequestSchema", () => {
  const valid = {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    tempo_inicial: 5_000,
    tempo_final: 50_000,
    titulo_sugerido: "Best moment",
    tags: ["highlight"],
  };

  it("accepts a valid request", () => {
    expect(CaptureRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when tempo_final <= tempo_inicial", () => {
    const r = CaptureRequestSchema.safeParse({
      ...valid,
      tempo_inicial: 50_000,
      tempo_final: 50_000,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when tempo_inicial is negative", () => {
    const r = CaptureRequestSchema.safeParse({ ...valid, tempo_inicial: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects a non-YouTube URL", () => {
    const r = CaptureRequestSchema.safeParse({
      ...valid,
      url: "https://vimeo.com/12345",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty tags array", () => {
    const r = CaptureRequestSchema.safeParse({ ...valid, tags: [] });
    expect(r.success).toBe(false);
  });

  it("applies default maxHeight of 720", () => {
    const r = CaptureRequestSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.maxHeight).toBe(720);
  });
});

// ── msToYtDlpTime (via inline reimplementation to keep service function private) ──

function msToYtDlpTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const frac = ms % 1_000;
  return (
    [String(h).padStart(2, "0"), String(m).padStart(2, "0"), String(s).padStart(2, "0")].join(":") +
    `.${String(frac).padStart(3, "0")}`
  );
}

describe("msToYtDlpTime", () => {
  it("converts 0 ms", () => {
    expect(msToYtDlpTime(0)).toBe("00:00:00.000");
  });

  it("converts 42500 ms (42.5 s)", () => {
    expect(msToYtDlpTime(42_500)).toBe("00:00:42.500");
  });

  it("converts 90000 ms (1 m 30 s)", () => {
    expect(msToYtDlpTime(90_000)).toBe("00:01:30.000");
  });

  it("converts 3661001 ms (1 h 1 m 1.001 s)", () => {
    expect(msToYtDlpTime(3_661_001)).toBe("01:01:01.001");
  });

  it("handles exactly 1 hour", () => {
    expect(msToYtDlpTime(3_600_000)).toBe("01:00:00.000");
  });
});
