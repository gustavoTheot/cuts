import { useState, useEffect, useCallback } from "react";
import { listCuts, deleteCut, updateCut, type CutItem } from "../api/client.ts";
import { CutCard } from "./CutCard.tsx";
import { PublishModal } from "./PublishModal.tsx";
import styles from "./CutsList.module.css";

const PAGE_SIZE = 9;

interface Props {
  refreshTrigger: number;
}

export function CutsList({ refreshTrigger }: Props) {
  const [items, setItems] = useState<CutItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [publishingCut, setPublishingCut] = useState<CutItem | null>(null);

  const handleUpdate = useCallback(
    async (id: string, data: { title?: string; description?: string | null }) => {
      const updated = await updateCut(id, data);
      setItems((prev) => prev.map((c) => (c.id === id ? updated : c)));
    },
    []
  );

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await listCuts(p, PAGE_SIZE);
        setItems(data.items);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setPage(data.page);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Reload when refreshTrigger changes or on mount
  useEffect(() => {
    void load(1);
  }, [refreshTrigger, load]);

  // Auto-poll while any cut is still processing or captured (waiting to render)
  const hasProcessingCuts = items.some(
    (c) => c.status === "processing" || c.status === "captured"
  );
  useEffect(() => {
    if (!hasProcessingCuts) return;
    const timer = setInterval(() => void load(page), 4_000);
    return () => clearInterval(timer);
  }, [hasProcessingCuts, load, page]);

  async function handleDelete(id: string) {
    setDeletingIds((prev) => new Set([...prev, id]));
    try {
      await deleteCut(id);
      // If this was the last item on the page, go to previous page
      const newTotal = total - 1;
      const newTotalPages = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
      const targetPage = Math.min(page, newTotalPages);
      await load(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <>
    {publishingCut && (
      <PublishModal cut={publishingCut} onClose={() => setPublishingCut(null)} />
    )}
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Cortes gerados</h2>
        {total > 0 && (
          <span className={styles.count}>{total} no total</span>
        )}
      </div>

      {error && (
        <div className={styles.error}>{error}</div>
      )}

      {loading && items.length === 0 && (
        <div className={styles.loading}>
          <span className={styles.spinner} />
          Carregando...
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className={styles.empty}>
          Nenhum corte gerado ainda. Use o formulário acima para criar o primeiro!
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className={styles.grid}>
            {items.map((cut) => (
              <CutCard
                key={cut.id}
                cut={cut}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
                onPublish={setPublishingCut}
                deleting={deletingIds.has(cut.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                className={styles.pageBtn}
                onClick={() => load(page - 1)}
                disabled={page <= 1 || loading}
              >
                ← Anterior
              </button>

              <div className={styles.pageNumbers}>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce<(number | "...")[]>((acc, p, i, arr) => {
                    if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("...");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, i) =>
                    item === "..." ? (
                      <span key={`dots-${i}`} className={styles.dots}>…</span>
                    ) : (
                      <button
                        key={item}
                        className={`${styles.pageNum} ${item === page ? styles.pageNumActive : ""}`}
                        onClick={() => load(item as number)}
                        disabled={loading}
                      >
                        {item}
                      </button>
                    )
                  )}
              </div>

              <button
                className={styles.pageBtn}
                onClick={() => load(page + 1)}
                disabled={page >= totalPages || loading}
              >
                Próximo →
              </button>
            </div>
          )}
        </>
      )}
    </section>
    </>
  );
}
