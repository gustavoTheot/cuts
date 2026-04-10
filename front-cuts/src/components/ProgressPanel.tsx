import type { PipelineEvent } from "../api/client.ts";
import styles from "./ProgressPanel.module.css";

interface StepState {
  status: "idle" | "running" | "done" | "error";
  message: string;
}

interface CutProgress {
  index: number;
  titulo: string;
  phase: "capturing" | "rendering";
  percent?: number;
  error?: string;
}

export interface ProgressState {
  active: boolean;
  steps: {
    transcription: StepState;
    intelligence: StepState;
    capture: StepState;
  };
  cutProgress: CutProgress[];
  done?: { successCount: number; failCount: number };
  error?: string;
}

export function makeInitialProgress(): ProgressState {
  return {
    active: false,
    steps: {
      transcription: { status: "idle", message: "" },
      intelligence: { status: "idle", message: "" },
      capture: { status: "idle", message: "" },
    },
    cutProgress: [],
  };
}

export function applyEvent(prev: ProgressState, event: PipelineEvent): ProgressState {
  switch (event.type) {
    case "start":
      return { ...prev, active: true, error: undefined, done: undefined, cutProgress: [] };

    case "step": {
      const stepKey = event.step as keyof ProgressState["steps"];
      return {
        ...prev,
        steps: {
          ...prev.steps,
          [stepKey]: { status: event.status, message: event.message },
        },
      };
    }

    case "cut_progress": {
      const existing = prev.cutProgress.findIndex((c) => c.index === event.index);
      const updated: CutProgress = {
        index: event.index,
        titulo: event.titulo,
        phase: event.phase,
      };
      const cutProgress =
        existing >= 0
          ? prev.cutProgress.map((c, i) => (i === existing ? updated : c))
          : [...prev.cutProgress, updated];
      return {
        ...prev,
        cutProgress,
        steps: {
          ...prev.steps,
          capture: { status: "running", message: `Corte ${event.index + 1}/${event.total} — ${event.phase === "capturing" ? "Capturando" : "Renderizando"}` },
        },
      };
    }

    case "cut_phase_progress": {
      const cutProgress = prev.cutProgress.map((c) =>
        c.index === event.index ? { ...c, phase: event.phase, percent: event.percent } : c
      );
      return { ...prev, cutProgress };
    }

    case "cut_ready": {
      const cutProgress = prev.cutProgress.map((c) =>
        c.index === event.index ? { ...c, phase: "rendering" as const, percent: 100 } : c
      );
      return { ...prev, cutProgress };
    }

    case "cut_error": {
      const existing = prev.cutProgress.findIndex((c) => c.index === event.index);
      const errCut: CutProgress = {
        index: event.index,
        titulo: event.titulo,
        phase: "capturing",
        error: event.message,
      };
      const cutProgress =
        existing >= 0
          ? prev.cutProgress.map((c, i) => (i === existing ? errCut : c))
          : [...prev.cutProgress, errCut];
      return { ...prev, cutProgress };
    }

    case "done":
      return {
        ...prev,
        active: false,
        done: { successCount: event.successCount, failCount: event.failCount },
        steps: {
          ...prev.steps,
          capture: {
            status: "done",
            message: `${event.successCount} corte(s) gerado(s)${event.failCount > 0 ? `, ${event.failCount} erro(s)` : ""}`,
          },
        },
      };

    case "error":
      return { ...prev, active: false, error: event.message };

    default:
      return prev;
  }
}

interface Props {
  progress: ProgressState;
  idle: boolean;
}

const STEP_LABELS = {
  transcription: "Transcrição",
  intelligence: "Análise de IA",
  capture: "Captura e Renderização",
};

export function ProgressPanel({ progress, idle }: Props) {
  if (idle) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>
          <ScissorsIcon />
          <p>
            Preencha o formulário e clique em{" "}
            <strong>Gerar Cortes</strong> para ver o progresso aqui.
          </p>
        </div>
      </div>
    );
  }

  const steps = Object.entries(progress.steps) as [keyof typeof STEP_LABELS, StepState][];

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>PROGRESSO</h3>
      <div className={styles.steps}>
        {steps.map(([key, step]) => (
          <div key={key} className={`${styles.step} ${styles[`step_${step.status}`]}`}>
            <span className={styles.stepIcon}>
              {step.status === "done" && <CheckIcon />}
              {step.status === "running" && <SpinnerIcon />}
              {step.status === "error" && <ErrorIcon />}
              {step.status === "idle" && <IdleIcon />}
            </span>
            <div className={styles.stepBody}>
              <span className={styles.stepLabel}>{STEP_LABELS[key]}</span>
              {step.message && <span className={styles.stepMsg}>{step.message}</span>}
            </div>
          </div>
        ))}
      </div>

      {progress.cutProgress.length > 0 && (
        <div className={styles.cuts}>
          {progress.cutProgress.map((c) => (
            <div key={c.index} className={`${styles.cutRow} ${c.error ? styles.cutRowError : ""}`}>
              <span className={styles.cutTitle}>{c.titulo}</span>
              {c.error ? (
                <span className={styles.cutErr}>{c.error}</span>
              ) : (
                <div className={styles.cutPhaseRow}>
                  <span className={styles.cutPhase}>
                    {c.phase === "capturing" ? "Capturando" : "Renderizando"}
                    {c.percent !== undefined ? ` ${c.percent}%` : "…"}
                  </span>
                  {c.percent !== undefined && (
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${c.percent}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {progress.error && (
        <div className={styles.errorBanner}>
          <ErrorIcon /> {progress.error}
        </div>
      )}

      {progress.done && (
        <div className={styles.doneBanner}>
          <CheckIcon /> {progress.done.successCount} corte(s) gerado(s) com sucesso!
        </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SpinnerIcon() {
  return <span className={styles.spin} />;
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IdleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function ScissorsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}
