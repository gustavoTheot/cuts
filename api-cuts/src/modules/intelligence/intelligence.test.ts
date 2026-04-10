import { describe, it, expect } from "vitest";

// Test the pure/exported helpers by importing them via the service module.
// We isolate only the logic that doesn't require external I/O.

// Re-export the helpers for testing by importing from the module path.
// The functions are not exported from the service intentionally (internal),
// so we test the behavior through schema validation instead.

import { LlmResponseSchema, CutSchema } from "./intelligence.schema.js";

describe("CutSchema", () => {
  it("accepts a valid cut object", () => {
    const result = CutSchema.safeParse({
      tempo_inicial: 5000,
      tempo_final: 35000,
      titulo_sugerido: "Melhor momento do vídeo",
      tags: ["highlight", "engraçado"],
      justificativa: "Momento de alto impacto",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a cut without optional justificativa", () => {
    const result = CutSchema.safeParse({
      tempo_inicial: 0,
      tempo_final: 20000,
      titulo_sugerido: "Introdução",
      tags: ["intro"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when tempo_inicial is negative", () => {
    const result = CutSchema.safeParse({
      tempo_inicial: -1000,
      tempo_final: 20000,
      titulo_sugerido: "Test",
      tags: ["t"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when tags array is empty", () => {
    const result = CutSchema.safeParse({
      tempo_inicial: 0,
      tempo_final: 20000,
      titulo_sugerido: "Test",
      tags: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when titulo_sugerido exceeds 100 chars", () => {
    const result = CutSchema.safeParse({
      tempo_inicial: 0,
      tempo_final: 20000,
      titulo_sugerido: "a".repeat(101),
      tags: ["t"],
    });
    expect(result.success).toBe(false);
  });
});

describe("LlmResponseSchema", () => {
  it("parses a valid LLM response with multiple cuts", () => {
    const result = LlmResponseSchema.safeParse({
      cortes: [
        {
          tempo_inicial: 3000,
          tempo_final: 38000,
          titulo_sugerido: "Dica de ouro",
          tags: ["dica", "produtividade"],
          justificativa: "Insight valioso e conciso",
        },
        {
          tempo_inicial: 90000,
          tempo_final: 130000,
          titulo_sugerido: "O momento mais engraçado",
          tags: ["humor"],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cortes).toHaveLength(2);
    }
  });

  it("rejects when cortes key is missing", () => {
    const result = LlmResponseSchema.safeParse({ cuts: [] });
    expect(result.success).toBe(false);
  });

  it("rejects when cortes contains an invalid cut", () => {
    const result = LlmResponseSchema.safeParse({
      cortes: [
        {
          tempo_inicial: 0,
          // missing tempo_final
          titulo_sugerido: "Test",
          tags: ["t"],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
