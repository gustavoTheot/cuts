import { getTranscription } from "../transcription/transcription.service.js";
import { analyzeTranscript } from "../intelligence/intelligence.service.js";
import { captureSection } from "../capture/capture.service.js";
import { renderClip } from "../render/render.service.js";
import { SubtitleStyleSchema } from "../render/render.schema.js";
import type { PipelineRequest, PipelineEvent, ReadyCut } from "./pipeline.schema.js";

/**
 * Generator that runs the full pipeline and yields SSE events at each step.
 * Supports two modes:
 *  - auto:   transcription → AI intelligence → capture+render per cut
 *  - manual: (optional transcription for subtitles) → capture+render for the given segment
 */
export async function* runPipeline(
  request: PipelineRequest
): AsyncGenerator<PipelineEvent> {
  const {
    url,
    lang,
    subtitleStyle,
    subtitles,
    manualCut,
  } = request;

  const resolvedStyle = SubtitleStyleSchema.parse(subtitleStyle ?? {});

  yield { type: "start", message: "Pipeline iniciado…" };

  // ════════════════════════════════════════════════════════════════════════════
  // MANUAL MODE — skip AI, capture exactly the user-specified segment
  // ════════════════════════════════════════════════════════════════════════════
  if (manualCut) {
    const { startMs, endMs, title } = manualCut;
    const titulo = title?.trim() || `Corte ${Math.round(startMs / 1000)}s–${Math.round(endMs / 1000)}s`;

    // Fetch transcription only when subtitles are enabled
    let transcriptionSegments: Awaited<ReturnType<typeof getTranscription>>["segments"] = [];
    if (subtitles) {
      yield { type: "step", step: "transcription", status: "running", message: "Buscando transcrição para legendas…" };
      try {
        const t = await getTranscription(url, lang);
        transcriptionSegments = t.segments;
        yield { type: "step", step: "transcription", status: "done", message: `${t.segments.length} segmentos encontrados` };
      } catch {
        yield { type: "step", step: "transcription", status: "done", message: "Transcrição indisponível — gerando sem legenda" };
      }
    }

    try {
      yield { type: "cut_progress", index: 0, total: 1, phase: "capturing", titulo };

      const captured = await captureSection(
        { url, tempo_inicial: startMs, tempo_final: endMs, titulo_sugerido: titulo, tags: [], hashtags: [], maxHeight: 720 },
        () => {}
      );

      yield { type: "cut_progress", index: 0, total: 1, phase: "rendering", titulo };

      const rendered = await renderClip(
        {
          cutId: captured.id,
          storageKey: captured.storageKey,
          tempo_inicial: startMs,
          tempo_final: endMs,
          segments: transcriptionSegments.length > 0 ? transcriptionSegments : [{ offset: startMs, duration: endMs - startMs, text: "" }],
          subtitleStyle: resolvedStyle,
          noSubtitles: !subtitles || transcriptionSegments.length === 0,
          resolution: { width: 1080, height: 1920 },
        },
        () => {}
      );

      const cut: ReadyCut = {
        id: captured.id,
        titulo,
        tags: [],
        durationMs: endMs - startMs,
        startMs,
        endMs,
        presignedUrl: rendered.presignedUrl,
      };

      yield { type: "cut_ready", index: 0, cut };
      yield { type: "done", successCount: 1, failCount: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: "cut_error", index: 0, titulo, message };
      yield { type: "done", successCount: 0, failCount: 1 };
    }

    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTO MODE — transcription → AI → capture+render per cut
  // ════════════════════════════════════════════════════════════════════════════
  const {
    instructions,
    maxCuts,
    maxDurationMs,
    model,
  } = request;

  // Minimum = 70% of target, floored at 15 s.
  const minDurationMs = Math.max(15_000, Math.round(maxDurationMs * 0.7));

  // ── Step 1: Transcription ──────────────────────────────────────────────────
  yield { type: "step", step: "transcription", status: "running", message: "Buscando transcrição do vídeo…" };

  const transcription = await getTranscription(url, lang);

  yield {
    type: "step",
    step: "transcription",
    status: "done",
    message: `${transcription.segments.length} segmentos encontrados${transcription.cached ? " (cache)" : ""}`,
  };

  // ── Step 2: Intelligence ───────────────────────────────────────────────────
  yield { type: "step", step: "intelligence", status: "running", message: "Analisando com IA…" };

  const intelligence = await analyzeTranscript({
    url,
    lang,
    instructions,
    maxCuts,
    minDurationMs,
    maxDurationMs,
    model,
  });

  if (intelligence.cortes.length === 0) {
    const rawCount = intelligence.rawCount ?? 0;
    const detail = rawCount > 0
      ? `A IA sugeriu ${rawCount} corte(s), mas todos ficaram fora da duração permitida (${(maxDurationMs / 1000).toFixed(0)}s máx). Tente aumentar a duração ou mudar as instruções.`
      : "A IA não encontrou cortes adequados. Tente mudar as instruções ou aumentar a duração.";
    yield { type: "step", step: "intelligence", status: "done", message: detail };
    yield { type: "done", successCount: 0, failCount: 0 };
    return;
  }

  yield {
    type: "step",
    step: "intelligence",
    status: "done",
    message: `${intelligence.cortes.length} corte(s) identificado(s) pelo modelo ${intelligence.model}`,
  };

  // ── Step 3: Capture + Render (per cut) ────────────────────────────────────
  const total = intelligence.cortes.length;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < total; i++) {
    const corte = intelligence.cortes[i];
    if (!corte) continue;
    const titulo = corte.titulo_sugerido;

    try {
      yield { type: "cut_progress", index: i, total, phase: "capturing", titulo };

      const captured = await captureSection(
        {
          url,
          tempo_inicial: corte.tempo_inicial,
          tempo_final: corte.tempo_final,
          titulo_sugerido: titulo,
          tags: corte.tags,
          hashtags: corte.hashtags ?? [],
          maxHeight: 720,
        },
        () => {}
      );

      yield { type: "cut_progress", index: i, total, phase: "rendering", titulo };

      const rendered = await renderClip(
        {
          cutId: captured.id,
          storageKey: captured.storageKey,
          tempo_inicial: corte.tempo_inicial,
          tempo_final: corte.tempo_final,
          segments: transcription.segments,
          subtitleStyle: resolvedStyle,
          noSubtitles: !subtitles,
          resolution: { width: 1080, height: 1920 },
        },
        () => {}
      );

      const cut: ReadyCut = {
        id: captured.id,
        titulo,
        tags: corte.tags,
        durationMs: corte.tempo_final - corte.tempo_inicial,
        startMs: corte.tempo_inicial,
        endMs: corte.tempo_final,
        presignedUrl: rendered.presignedUrl,
      };

      yield { type: "cut_ready", index: i, cut };
      successCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: "cut_error", index: i, titulo, message };
      failCount++;
    }
  }

  yield { type: "done", successCount, failCount };
}
