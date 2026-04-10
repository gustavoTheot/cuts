import { useState, useEffect } from "react";
import { publishCut, getSocialPosts, listSocialAccounts, type CutItem, type SocialAccount, type SocialPost } from "../api/client.ts";
import styles from "./PublishModal.module.css";

interface Props {
  cut: CutItem;
  onClose: () => void;
}

export function PublishModal({ cut, onClose }: Props) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<"youtube" | "tiktok" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(cut.title);
  const [description, setDescription] = useState(cut.description ?? "");

  useEffect(() => {
    Promise.all([listSocialAccounts(), getSocialPosts(cut.id)])
      .then(([accs, ps]) => { setAccounts(accs); setPosts(ps); })
      .finally(() => setLoading(false));
  }, [cut.id]);

  async function handlePublish(platform: "youtube" | "tiktok") {
    setPublishing(platform);
    setError(null);
    try {
      await publishCut({ cutId: cut.id, platform, title, description: description || undefined });
      const updated = await getSocialPosts(cut.id);
      setPosts(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(null);
    }
  }

  const hashtags = cut.hashtags ?? [];
  const youtube = accounts.find((a) => a.platform === "youtube");
  const tiktok = accounts.find((a) => a.platform === "tiktok");
  const youtubePost = posts.find((p) => p.platform === "youtube" && p.status === "published");
  const tiktokPost = posts.find((p) => p.platform === "tiktok" && p.status === "published");

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Publicar corte</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {loading ? (
          <div className={styles.loading}><span className={styles.spinner} /> Carregando...</div>
        ) : (
          <>
            {/* Title & description override */}
            <div className={styles.section}>
              <label className={styles.label}>Título</label>
              <input
                className={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
              />
              <label className={styles.label} style={{ marginTop: 10 }}>Descrição</label>
              <textarea
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={2200}
                placeholder="Descrição opcional..."
              />
            </div>

            {/* Hashtags preview */}
            {hashtags.length > 0 && (
              <div className={styles.section}>
                <label className={styles.label}>Hashtags geradas</label>
                <div className={styles.hashtags}>
                  {hashtags.map((h) => (
                    <span key={h} className={styles.hashtag}>#{h}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Platform buttons */}
            <div className={styles.section}>
              <label className={styles.label}>Publicar em</label>
              <div className={styles.platforms}>
                <PlatformButton
                  platform="youtube"
                  account={youtube}
                  post={youtubePost}
                  publishing={publishing === "youtube"}
                  onPublish={() => handlePublish("youtube")}
                />
                <PlatformButton
                  platform="tiktok"
                  account={tiktok}
                  post={tiktokPost}
                  publishing={publishing === "tiktok"}
                  onPublish={() => handlePublish("tiktok")}
                />
              </div>
            </div>

            {error && <div className={styles.error}>{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

interface PlatformButtonProps {
  platform: "youtube" | "tiktok";
  account?: SocialAccount;
  post?: SocialPost;
  publishing: boolean;
  onPublish: () => void;
}

const PLATFORM_META = {
  youtube: { label: "YouTube Shorts", color: "#ff0000" },
  tiktok: { label: "TikTok", color: "#010101" },
};

function PlatformButton({ platform, account, post, publishing, onPublish }: PlatformButtonProps) {
  const meta = PLATFORM_META[platform];

  if (!account) {
    return (
      <div className={styles.platformRow}>
        <div className={styles.platformInfo}>
          <div className={styles.platformDot} style={{ background: meta.color }} />
          <span className={styles.platformName}>{meta.label}</span>
        </div>
        <a href={`/api/v1/social/auth/${platform}`} className={styles.connectSmallBtn}>
          Conectar conta
        </a>
      </div>
    );
  }

  if (post) {
    return (
      <div className={styles.platformRow}>
        <div className={styles.platformInfo}>
          <div className={styles.platformDot} style={{ background: meta.color }} />
          <div>
            <span className={styles.platformName}>{meta.label}</span>
            <span className={styles.platformUser}>@{account.username}</span>
          </div>
        </div>
        <div className={styles.publishedState}>
          <span className={styles.publishedBadge}>✓ Publicado</span>
          {post.postUrl && (
            <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className={styles.viewLink}>
              Ver post →
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.platformRow}>
      <div className={styles.platformInfo}>
        <div className={styles.platformDot} style={{ background: meta.color }} />
        <div>
          <span className={styles.platformName}>{meta.label}</span>
          <span className={styles.platformUser}>@{account.username}</span>
        </div>
      </div>
      <button
        className={styles.publishBtn}
        onClick={onPublish}
        disabled={publishing}
        style={{ background: meta.color }}
      >
        {publishing ? <><span className={styles.spinnerSmall} /> Publicando...</> : "Publicar"}
      </button>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
