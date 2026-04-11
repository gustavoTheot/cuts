import { useState, useCallback } from "react";
import { CutForm } from "./components/CutForm.tsx";
import {
  ProgressPanel,
  makeInitialProgress,
  applyEvent,
  type ProgressState,
} from "./components/ProgressPanel.tsx";
import { CutsList } from "./components/CutsList.tsx";
import { SocialPanel } from "./components/SocialPanel.tsx";
import { NarratedForm } from "./components/NarratedForm.tsx";
import {
  NarratedProgressPanel,
  makeInitialNarratedProgress,
  applyNarratedEvent,
  type NarratedProgressState,
} from "./components/NarratedProgressPanel.tsx";
import { NarratedList } from "./components/NarratedList.tsx";
import { startPipeline, startNarrated, type PipelineRequest, type PipelineEvent, type NarratedRequest } from "./api/client.ts";
import styles from "./App.module.css";

type Tab = "cortes" | "historias";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("cortes");

  // ── Cortes state ──────────────────────────────────────────────────────────
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(makeInitialProgress());
  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleFormSubmit = useCallback((request: PipelineRequest) => {
    cancelFn?.();

    setProcessing(true);
    setProgress((prev) => ({
      ...makeInitialProgress(),
      active: true,
      error: prev.error,
    }));

    const cancel = startPipeline(
      request,
      (event: PipelineEvent) => {
        setProgress((prev) => applyEvent(prev, event));
        if (event.type === "cut_ready") {
          setRefreshTrigger((n) => n + 1);
        }
      },
      () => {
        setProcessing(false);
        setCancelFn(null);
        setRefreshTrigger((n) => n + 1);
      }
    );

    setCancelFn(() => cancel);
  }, [cancelFn]);

  const isPanelIdle = !processing && !progress.active && !progress.error && !progress.done;

  // ── Histórias state ───────────────────────────────────────────────────────
  const [narratedProcessing, setNarratedProcessing] = useState(false);
  const [narratedProgress, setNarratedProgress] = useState<NarratedProgressState>(
    makeInitialNarratedProgress()
  );
  const [narratedCancelFn, setNarratedCancelFn] = useState<(() => void) | null>(null);
  const [narratedRefresh, setNarratedRefresh] = useState(0);

  const handleNarratedSubmit = useCallback((request: NarratedRequest) => {
    narratedCancelFn?.();

    setNarratedProcessing(true);
    setNarratedProgress(makeInitialNarratedProgress());

    const cancel = startNarrated(
      request,
      (event) => {
        setNarratedProgress((prev) => applyNarratedEvent(prev, event));
      },
      () => {
        setNarratedProcessing(false);
        setNarratedCancelFn(null);
        setNarratedRefresh((n) => n + 1);
      }
    );

    setNarratedCancelFn(() => cancel);
  }, [narratedCancelFn]);

  const isNarratedPanelIdle =
    !narratedProcessing &&
    !narratedProgress.active &&
    !narratedProgress.error &&
    !narratedProgress.done;

  return (
    <div className={styles.app}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>
            <ScissorsIcon />
          </div>
          <div>
            <span className={styles.logoName}>api-cuts</span>
            <span className={styles.logoSub}>Gerador de cortes para redes sociais</span>
          </div>
        </div>

        {/* Tab switcher */}
        <nav className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === "cortes" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("cortes")}
          >
            <ScissorsIcon size={14} />
            Cortes
          </button>
          <button
            className={`${styles.tab} ${activeTab === "historias" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("historias")}
          >
            <FilmIcon />
            Histórias Curtas
          </button>
        </nav>
      </header>

      {/* Main content */}
      <main className={styles.main}>
        {activeTab === "cortes" ? (
          <>
            <section className={styles.topSection}>
              <h1 className={styles.pageTitle}>Novo corte</h1>
              <div className={styles.topGrid}>
                <div className={styles.formPanel}>
                  <CutForm onSubmit={handleFormSubmit} processing={processing} />
                </div>
                <div className={styles.progressPanel}>
                  <ProgressPanel progress={progress} idle={isPanelIdle} />
                </div>
              </div>
            </section>

            <CutsList refreshTrigger={refreshTrigger} />
            <SocialPanel />
          </>
        ) : (
          <>
            <section className={styles.topSection}>
              <h1 className={styles.pageTitle}>Nova história curta</h1>
              <p className={styles.pageDesc}>
                Gere um vídeo narrado de 60–70 segundos com B-roll, legenda e voz sintética a
                partir de um tema ou ideia.
              </p>
              <div className={styles.topGrid}>
                <div className={styles.formPanel}>
                  <NarratedForm onSubmit={handleNarratedSubmit} processing={narratedProcessing} />
                </div>
                <div className={styles.progressPanel}>
                  <NarratedProgressPanel
                    progress={narratedProgress}
                    idle={isNarratedPanelIdle}
                  />
                </div>
              </div>
            </section>

            <NarratedList refreshTrigger={narratedRefresh} />
          </>
        )}
      </main>
    </div>
  );
}

function ScissorsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

function FilmIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
