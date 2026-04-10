import { getTranscription } from "../transcription/transcription.service.js";
import { analyzeTranscript } from "../intelligence/intelligence.service.js";
import { captureSection } from "../capture/capture.service.js";
import { renderClip } from "../render/render.service.js";
import { SubtitleStyleSchema } from "../render/render.schema.js";
import type { PipelineRequest, PipelineEvent, ReadyCut } from "./pipeline.schema.js";

/**
 * Generator that runs the full pipeline and yields SSE events at each step.
 * Errors in individual cut processing are non-fatal — they emit a `cut_error`
 * event and the pipeline continues to the next cut.
 */
export async function* runPipeline(
  request: PipelineRequest
): AsyncGenerator<PipelineEvent> {
  const {
    url,
    lang,
    instructions,
    maxCuts,
    maxDurationMs,
    subtitleStyle,
    subtitles,
    model,
  } = request;

  // Use a fixed 15s floor so the duration filter doesn't silently discard
  // cuts that are shorter than half the selected max duration.
  const minDurationMs = 15_000;
  const resolvedStyle = SubtitleStyleSchema.parse(subtitleStyle ?? {});

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
    yield {
      type: "step",
      step: "intelligence",
      status: "done",
      message: detail,
    };
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
      // 3a. Capture
      yield { type: "cut_progress", index: i, total, phase: "capturing", titulo };

      const captured = await captureSection(
        {
          url,
          tempo_inicial: corte.tempo_inicial,
          tempo_final: corte.tempo_final,
          titulo_sugerido: titulo,
          tags: corte.tags,
          maxHeight: 720,
        },
        () => {} // suppress verbose yt-dlp logs in SSE
      );

      // 3b. Render
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
