import type { NarratedEvent } from "../api/client.ts";
import styles from "./NarratedProgressPanel.module.css";

interface StepState {
  status: "idle" | "running" | "done" | "error";
  message: string;
}

export interface NarratedProgressState {
  active: boolean;
  steps: {
    script: StepState;
    media: StepState;
    render: StepState;
    upload: StepState;
  };
  done?: { presignedUrl: string; script: string };
  error?: string;
}

export function makeInitialNarratedProgress(): NarratedProgressState {
  return {
    active: false,
    steps: {
      script: { status: "idle", message: "" },
      media: { status: "idle", message: "" },
      render: { status: "idle", message: "" },
      upload: { status: "idle", message: "" },
    },
  };
}

export function applyNarratedEvent(
  prev: NarratedProgressState,
  event: NarratedEvent
): NarratedProgressState {
  switch (event.type) {
    case "start":
      return { ...prev, active: true, error: undefined, done: undefined };

    case "step": {
      const key = event.step as keyof NarratedProgressState["steps"];
      return {
        ...prev,
        steps: {
          ...prev.steps,
          [key]: { status: event.status, message: event.message },
        },
      };
    }

    case "done":
      return {
        ...prev,
        active: false,
        done: { presignedUrl: event.presignedUrl, script: event.script },
      };

    case "error":
      return { ...prev, active: false, error: event.message };

    default:
      return prev;
  }
}

const STEP_LABELS: Record<keyof NarratedProgressState["steps"], string> = {
  script: "Roteiro (Gemini)",
  media: "Áudio + B-roll",
  render: "Renderização",
  upload: "Upload",
};

interface Props {
  progress: NarratedProgressState;
  idle: boolean;
}

export function NarratedProgressPanel({ progress, idle }: Props) {
  if (idle) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>
          <FilmIcon />
          <p>
            Preencha o tema e clique em <strong>Gerar História</strong> para
            ver o progresso aqui.
          </p>
        </div>
      </div>
    );
  }

  const steps = Object.entries(progress.steps) as [
    keyof typeof STEP_LABELS,
    StepState
  ][];

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>PROGRESSO</h3>

      <div className={styles.steps}>
        {steps.map(([key, step]) => (
          <div
            key={key}
            className={`${styles.step} ${styles[`step_${step.status}`]}`}
          >
            <span className={styles.stepIcon}>
              {step.status === "done" && <CheckIcon />}
              {step.status === "running" && <SpinnerIcon />}
              {step.status === "error" && <ErrorIcon />}
              {step.status === "idle" && <IdleIcon />}
            </span>
            <div className={styles.stepBody}>
              <span className={styles.stepLabel}>{STEP_LABELS[key]}</span>
              {step.message && (
                <span className={styles.stepMsg}>{step.message}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {progress.error && (
        <div className={styles.errorBanner}>
          <ErrorIcon /> {progress.error}
        </div>
      )}

      {progress.done && (
        <div className={styles.doneBanner}>
          <CheckIcon /> Vídeo gerado com sucesso!
          <a
            className={styles.downloadLink}
            href={progress.done.presignedUrl}
            target="_blank"
            rel="noreferrer"
          >
            Baixar vídeo
          </a>
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

function FilmIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="17" x2="22" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
    </svg>
  );
}
