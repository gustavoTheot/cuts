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
import { startPipeline, type PipelineRequest, type PipelineEvent } from "./api/client.ts";
import styles from "./App.module.css";

export default function App() {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(makeInitialProgress());
  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleFormSubmit = useCallback((request: PipelineRequest) => {
    // Cancel any ongoing pipeline
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

        // When a cut is ready, trigger a list refresh
        if (event.type === "cut_ready") {
          setRefreshTrigger((n) => n + 1);
        }
      },
      () => {
        setProcessing(false);
        setCancelFn(null);
        // Final refresh when pipeline finishes
        setRefreshTrigger((n) => n + 1);
      }
    );

    setCancelFn(() => cancel);
  }, [cancelFn]);

  const isPanelIdle = !processing && !progress.active && !progress.error && !progress.done;

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
      </header>

      {/* Main content */}
      <main className={styles.main}>
        <section className={styles.topSection}>
          <h1 className={styles.pageTitle}>Novo corte</h1>

          <div className={styles.topGrid}>
            {/* Form */}
            <div className={styles.formPanel}>
              <CutForm onSubmit={handleFormSubmit} processing={processing} />
            </div>

            {/* Progress */}
            <div className={styles.progressPanel}>
              <ProgressPanel progress={progress} idle={isPanelIdle} />
            </div>
          </div>
        </section>

        {/* Cuts list */}
        <CutsList refreshTrigger={refreshTrigger} />

        {/* Social connections */}
        <SocialPanel />
      </main>
    </div>
  );
}

function ScissorsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}
