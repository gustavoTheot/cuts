import { useState } from "react";
import type { NarratedItem } from "../api/client.ts";
import styles from "./NarratedCard.module.css";

interface Props {
  item: NarratedItem;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  processing: "Processando",
  done: "Pronto",
  failed: "Falhou",
};

export function NarratedCard({ item }: Props) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const isProcessing = item.status === "processing";
  const isDone = item.status === "done";
  const isFailed = item.status === "failed";

  return (
    <div className={`${styles.card} ${isFailed ? styles.cardFailed : ""}`}>
      <div className={styles.header}>
        <span className={`${styles.badge} ${styles[`badge_${item.status}`]}`}>
          {isProcessing && <span className={styles.spin} />}
          {STATUS_LABEL[item.status] ?? item.status}
        </span>
        <span className={styles.date}>{formatDate(item.createdAt)}</span>
      </div>

      <p className={styles.tema}>{item.tema}</p>

      {item.script && (
        <div className={styles.scriptSection}>
          <button
            className={styles.scriptToggle}
            onClick={() => setScriptOpen((v) => !v)}
          >
            {scriptOpen ? "Ocultar roteiro" : "Ver roteiro"}
            <ChevronIcon open={scriptOpen} />
          </button>
          {scriptOpen && <p className={styles.script}>{item.script}</p>}
        </div>
      )}

      {isDone && (
        <div className={styles.footer}>
          {item.storageKey ? (
            <span className={styles.ready}>Vídeo disponível no armazenamento</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
