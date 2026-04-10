import { useState, type FormEvent } from "react";
import type { PipelineRequest } from "../api/client.ts";
import styles from "./CutForm.module.css";

const DURATIONS = [
  { label: "30s", value: 30_000 },
  { label: "45s", value: 45_000 },
  { label: "60s", value: 60_000 },
  { label: "75s", value: 75_000 },
  { label: "90s", value: 90_000 },
];

const LANGUAGES = [
  { label: "Português", value: "pt" },
  { label: "English", value: "en" },
  { label: "Español", value: "es" },
  { label: "Français", value: "fr" },
  { label: "Deutsch", value: "de" },
];

interface Props {
  onSubmit: (req: PipelineRequest) => void;
  processing: boolean;
}

// ── Time helpers ──────────────────────────────────────────────────────────────

/** Parse "H:MM:SS" or "MM:SS" or "SS" into milliseconds. Returns NaN on bad input. */
function parseTime(str: string): number {
  const parts = str.trim().split(":").map(Number);
  if (parts.some(isNaN)) return NaN;
  if (parts.length === 3) {
    const [h, m, s] = parts as [number, number, number];
    return (h * 3600 + m * 60 + s) * 1000;
  }
  if (parts.length === 2) {
    const [m, s] = parts as [number, number];
    return (m * 60 + s) * 1000;
  }
  if (parts.length === 1) {
    return (parts[0] as number) * 1000;
  }
  return NaN;
}

/** Format milliseconds as "M:SS" */
function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CutForm({ onSubmit, processing }: Props) {
  const [mode, setMode] = useState<"auto" | "manual">("auto");

  // Shared
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState("pt");
  const [subtitles, setSubtitles] = useState(false);

  // Auto mode
  const [maxDurationMs, setMaxDurationMs] = useState(60_000);
  const [maxCuts, setMaxCuts] = useState(3);
  const [instructions, setInstructions] = useState("");

  // Manual mode
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [manualTitle, setManualTitle] = useState("");

  // Derived validation for manual mode
  const startMs = parseTime(startTime);
  const endMs = parseTime(endTime);
  const manualValid =
    !isNaN(startMs) && !isNaN(endMs) && endMs > startMs;
  const manualDuration = manualValid ? endMs - startMs : 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    if (mode === "manual") {
      if (!manualValid) return;
      onSubmit({
        url: url.trim(),
        lang,
        subtitles,
        manualCut: {
          startMs,
          endMs,
          title: manualTitle.trim() || undefined,
        },
      });
    } else {
      onSubmit({
        url: url.trim(),
        lang,
        maxCuts,
        maxDurationMs,
        instructions: instructions.trim() || undefined,
        subtitles,
      });
    }
  }

  const canSubmit = !processing && url.trim() &&
    (mode === "auto" || manualValid);

  return (
    <form className={styles.form} onSubmit={handleSubmit}>

      {/* Mode tabs */}
      <div className={styles.modeTabs}>
        <button
          type="button"
          className={`${styles.modeTab} ${mode === "auto" ? styles.modeTabActive : ""}`}
          onClick={() => setMode("auto")}
          disabled={processing}
        >
          <SparkleIcon />
          Automático
        </button>
        <button
          type="button"
          className={`${styles.modeTab} ${mode === "manual" ? styles.modeTabActive : ""}`}
          onClick={() => setMode("manual")}
          disabled={processing}
        >
          <ScissorsIcon />
          Manual
        </button>
      </div>

      {/* URL — shared */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="url">URL do YouTube</label>
        <input
          id="url"
          className={styles.input}
          type="url"
          placeholder="https://youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          disabled={processing}
        />
      </div>

      {/* ── Auto mode fields ── */}
      {mode === "auto" && (
        <>
          <div className={styles.field}>
            <label className={styles.label}>Duração alvo do corte</label>
            <div className={styles.durationRow}>
              {DURATIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  className={`${styles.durationBtn} ${maxDurationMs === d.value ? styles.durationBtnActive : ""}`}
                  onClick={() => setMaxDurationMs(d.value)}
                  disabled={processing}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="maxCuts">Número de cortes</label>
              <select
                id="maxCuts"
                className={styles.select}
                value={maxCuts}
                onChange={(e) => setMaxCuts(Number(e.target.value))}
                disabled={processing}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? "corte" : "cortes"}</option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="lang">Idioma do vídeo</label>
              <select
                id="lang"
                className={styles.select}
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                disabled={processing}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="instructions">
              Instruções <span className={styles.optional}>(opcional)</span>
            </label>
            <textarea
              id="instructions"
              className={styles.textarea}
              placeholder="Ex: foque nos momentos mais técnicos, encontre as partes engraçadas, destaque os insights principais..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              disabled={processing}
            />
          </div>
        </>
      )}

      {/* ── Manual mode fields ── */}
      {mode === "manual" && (
        <>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="startTime">
                Início <span className={styles.optional}>(ex: 1:30 ou 0:45)</span>
              </label>
              <input
                id="startTime"
                className={`${styles.input} ${startTime && isNaN(startMs) ? styles.inputError : ""}`}
                type="text"
                placeholder="0:00"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={processing}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="endTime">
                Fim <span className={styles.optional}>(ex: 2:10 ou 1:15)</span>
              </label>
              <input
                id="endTime"
                className={`${styles.input} ${endTime && (!manualValid && startTime) ? styles.inputError : ""}`}
                type="text"
                placeholder="0:30"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={processing}
              />
            </div>
          </div>

          {manualValid && (
            <div className={styles.durationHint}>
              Duração: <strong>{formatMs(manualDuration)}</strong> ({Math.round(manualDuration / 1000)}s)
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="lang">Idioma do vídeo</label>
            <select
              id="lang"
              className={styles.select}
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              disabled={processing}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="manualTitle">
              Título <span className={styles.optional}>(opcional)</span>
            </label>
            <input
              id="manualTitle"
              className={styles.input}
              type="text"
              placeholder="Título do corte..."
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              maxLength={300}
              disabled={processing}
            />
          </div>
        </>
      )}

      {/* Subtitle toggle — shared */}
      <div className={styles.field}>
        <label className={styles.toggleLabel}>
          <span className={styles.toggleTrack} data-on={subtitles}>
            <span className={styles.toggleThumb} />
          </span>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={subtitles}
            onChange={(e) => setSubtitles(e.target.checked)}
            disabled={processing}
          />
          Queimar legendas no vídeo
        </label>
      </div>

      <button
        type="submit"
        className={styles.submitBtn}
        disabled={!canSubmit}
      >
        {processing ? (
          <>
            <span className={styles.spinner} />
            Processando...
          </>
        ) : (
          <>
            <ScissorsIcon />
            {mode === "auto" ? "Gerar Cortes" : "Gerar Corte"}
          </>
        )}
      </button>
    </form>
  );
}

function ScissorsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}
