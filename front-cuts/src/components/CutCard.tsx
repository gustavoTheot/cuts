import type { CutItem } from "../api/client.ts";
import styles from "./CutCard.module.css";

interface Props {
  cut: CutItem;
  onDelete: (id: string) => void;
  deleting: boolean;
}

function formatMs(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: undefined,
  });
}

export function CutCard({ cut, onDelete, deleting }: Props) {
  const duration = formatMs(cut.durationMs);
  const start = formatMs(cut.startMs);
  const date = formatDate(cut.createdAt);
  const isReady = cut.status === "rendered" && cut.presignedUrl;

  return (
    <div className={styles.card}>
      {/* Thumbnail / preview */}
      <div className={styles.thumb}>
        {isReady ? (
          <video
            className={styles.video}
            src={cut.presignedUrl!}
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
            onMouseLeave={(e) => {
              const v = e.currentTarget as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
          />
        ) : (
          <div className={styles.noThumb}>
            <ScissorsIcon />
            <span>{cut.status}</span>
          </div>
        )}
        <span className={styles.duration}>{duration}</span>
      </div>

      {/* Info */}
      <div className={styles.body}>
        <h3 className={styles.title}>{cut.title}</h3>

        <div className={styles.meta}>
          <span className={styles.metaItem}>
            <ClockIcon />
            {duration}s
          </span>
          <span className={styles.metaItem}>{date}, {start}</span>
        </div>

        {cut.tags.length > 0 && (
          <div className={styles.tags}>
            {cut.tags.slice(0, 4).map((tag) => (
              <span key={tag} className={styles.tag}>{tag}</span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className={styles.actions}>
          {isReady ? (
            <a
              href={cut.presignedUrl!}
              download
              className={styles.downloadBtn}
              onClick={(e) => e.stopPropagation()}
            >
              <DownloadIcon />
              Baixar
            </a>
          ) : (
            <span className={styles.statusBadge}>{cut.status}</span>
          )}

          <button
            className={styles.deleteBtn}
            onClick={() => onDelete(cut.id)}
            disabled={deleting}
            title="Remover corte"
          >
            {deleting ? <SpinnerSmall /> : <TrashIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function ScissorsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

function SpinnerSmall() {
  return <span className={styles.spinSmall} />;
}
