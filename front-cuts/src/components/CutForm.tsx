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

export function CutForm({ onSubmit, processing }: Props) {
  const [url, setUrl] = useState("");
  const [maxDurationMs, setMaxDurationMs] = useState(60_000);
  const [maxCuts, setMaxCuts] = useState(3);
  const [lang, setLang] = useState("pt");
  const [instructions, setInstructions] = useState("");
  const [subtitles, setSubtitles] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit({
      url: url.trim(),
      lang,
      maxCuts,
      maxDurationMs,
      instructions: instructions.trim() || undefined,
      subtitles,
    });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
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

      <div className={styles.field}>
        <label className={styles.label}>Duração máxima do corte</label>
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
          rows={4}
          disabled={processing}
        />
      </div>

      <button
        type="submit"
        className={styles.submitBtn}
        disabled={processing || !url.trim()}
      >
        {processing ? (
          <>
            <span className={styles.spinner} />
            Processando...
          </>
        ) : (
          <>
            <ScissorsIcon />
            Gerar Cortes
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
