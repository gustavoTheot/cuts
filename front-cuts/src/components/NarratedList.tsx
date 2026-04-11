import { useState, useEffect, useCallback } from "react";
import { listNarrated, type NarratedItem } from "../api/client.ts";
import { NarratedCard } from "./NarratedCard.tsx";
import styles from "./NarratedList.module.css";

interface Props {
  refreshTrigger: number;
}

export function NarratedList({ refreshTrigger }: Props) {
  const [items, setItems] = useState<NarratedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listNarrated();
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar histórias");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount and when triggered externally
  useEffect(() => {
    void load();
  }, [load, refreshTrigger]);

  // Poll every 5s while any item is still processing
  useEffect(() => {
    const hasProcessing = items.some((i) => i.status === "processing");
    if (!hasProcessing) return;

    const timer = setTimeout(() => void load(), 5000);
    return () => clearTimeout(timer);
  }, [items, load]);

  if (loading) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Histórias geradas</h2>
        </div>
        <div className={styles.loadingRow}>
          <span className={styles.spin} />
          Carregando…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Histórias geradas</h2>
        </div>
        <div className={styles.errorRow}>{error}</div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>
          Histórias geradas
          {items.length > 0 && (
            <span className={styles.count}>{items.length}</span>
          )}
        </h2>
        <button className={styles.refreshBtn} onClick={() => void load()}>
          <RefreshIcon />
        </button>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          Nenhuma história gerada ainda. Use o formulário acima para criar.
        </div>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <NarratedCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
