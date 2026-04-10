import { useState, useEffect } from "react";
import { listSocialAccounts, getSocialAuthUrl, disconnectSocial, type SocialAccount } from "../api/client.ts";
import styles from "./SocialPanel.module.css";

export function SocialPanel() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const data = await listSocialAccounts();
      setAccounts(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Handle OAuth redirect back
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("social_connected");
    const error = params.get("social_error");
    if (connected || error) {
      window.history.replaceState({}, "", "/");
      if (connected) void load();
    }
  }, []);

  async function handleDisconnect(platform: "youtube" | "tiktok") {
    await disconnectSocial(platform);
    setAccounts((prev) => prev.filter((a) => a.platform !== platform));
  }

  function handleConnect(platform: "youtube" | "tiktok") {
    window.location.href = getSocialAuthUrl(platform);
  }

  const youtube = accounts.find((a) => a.platform === "youtube");
  const tiktok = accounts.find((a) => a.platform === "tiktok");

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Plataformas conectadas</h2>
      <p className={styles.sub}>Conecte suas contas para publicar cortes diretamente das plataformas.</p>

      {loading ? (
        <div className={styles.loading}><span className={styles.spinner} /> Carregando...</div>
      ) : (
        <div className={styles.platforms}>
          <PlatformCard
            platform="youtube"
            account={youtube}
            onConnect={() => handleConnect("youtube")}
            onDisconnect={() => handleDisconnect("youtube")}
          />
          <PlatformCard
            platform="tiktok"
            account={tiktok}
            onConnect={() => handleConnect("tiktok")}
            onDisconnect={() => handleDisconnect("tiktok")}
          />
        </div>
      )}
    </section>
  );
}

interface PlatformCardProps {
  platform: "youtube" | "tiktok";
  account?: SocialAccount;
  onConnect: () => void;
  onDisconnect: () => void;
}

const PLATFORM_META = {
  youtube: { label: "YouTube Shorts", color: "#ff0000" },
  tiktok: { label: "TikTok", color: "#010101" },
};

function PlatformCard({ platform, account, onConnect, onDisconnect }: PlatformCardProps) {
  const meta = PLATFORM_META[platform];

  return (
    <div className={`${styles.card} ${account ? styles.cardConnected : ""}`}>
      <div className={styles.cardLeft}>
        <div className={styles.platformIcon} style={{ background: meta.color }}>
          {platform === "youtube" ? <YouTubeIcon /> : <TikTokIcon />}
        </div>
        <div>
          <span className={styles.platformName}>{meta.label}</span>
          {account ? (
            <span className={styles.accountName}>@{account.username}</span>
          ) : (
            <span className={styles.notConnected}>Não conectado</span>
          )}
        </div>
      </div>

      <div className={styles.cardRight}>
        {account ? (
          <>
            <span className={styles.connectedBadge}>
              <CheckIcon /> Conectado
            </span>
            <button className={styles.disconnectBtn} onClick={onDisconnect}>
              Desconectar
            </button>
          </>
        ) : (
          <button className={styles.connectBtn} onClick={onConnect}>
            Conectar
          </button>
        )}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6a3 3 0 0 0-2.1 2.1C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
      <path d="M19.6 3.3a4.5 4.5 0 0 1-3.1-1.2A4.5 4.5 0 0 1 15.2 0h-3.4v15.7a2.1 2.1 0 0 1-2.1 1.9 2.1 2.1 0 0 1-2.1-2.1 2.1 2.1 0 0 1 2.1-2.1c.2 0 .4 0 .6.1V10a5.5 5.5 0 0 0-.6 0 5.5 5.5 0 0 0-5.5 5.5 5.5 5.5 0 0 0 5.5 5.5 5.5 5.5 0 0 0 5.5-5.5V8.2a7.8 7.8 0 0 0 4.5 1.4V6.2a4.5 4.5 0 0 1-2.1-.9z" />
    </svg>
  );
}
