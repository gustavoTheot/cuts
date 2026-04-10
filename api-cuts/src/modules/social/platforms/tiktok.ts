import { createHash, randomBytes } from "node:crypto";
import { env } from "../../../config/env.js";
import { AppError } from "../../../shared/errors.js";

const TIKTOK_API = "https://open.tiktokapis.com/v2";
const REDIRECT_URI = `${new URL(env.FRONTEND_URL).origin.replace("5173", "3000")}/api/v1/social/callback/tiktok`;

// In-memory store: state → code_verifier (expires after 10 min)
const pkceStore = new Map<string, { verifier: string; expiresAt: number }>();

function generateCodeVerifier(): string {
  return randomBytes(48).toString("base64url").slice(0, 96);
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Store verifier keyed by state, auto-expire after 10 min */
function storePkce(state: string, verifier: string) {
  pkceStore.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
  // Cleanup old entries
  for (const [k, v] of pkceStore) {
    if (v.expiresAt < Date.now()) pkceStore.delete(k);
  }
}

export function consumePkceVerifier(state: string): string {
  const entry = pkceStore.get(state);
  if (!entry || entry.expiresAt < Date.now()) {
    throw new AppError(400, "PKCE state expired or not found — restart the OAuth flow");
  }
  pkceStore.delete(state);
  return entry.verifier;
}

export function getTikTokAuthUrl(state: string): string {
  if (!env.TIKTOK_CLIENT_KEY) throw new AppError(501, "TikTok OAuth not configured — set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET");

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  storePkce(state, verifier);

  const params = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    scope: "user.info.basic,video.publish,video.upload",
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  openId: string;
  username: string;
  avatarUrl: string | null;
}

export async function exchangeTikTokCode(code: string, codeVerifier: string): Promise<TikTokTokens> {
  const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data.error) throw new AppError(502, `TikTok token exchange failed: ${JSON.stringify(data)}`);

  const openId = data.open_id as string;
  const accessToken = data.access_token as string;
  const expiresAt = Date.now() + (Number(data.expires_in) * 1000);

  // Fetch user info
  const userRes = await fetch(`${TIKTOK_API}/user/info/?fields=display_name,avatar_url`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userData = (await userRes.json()) as { data?: { user?: { display_name?: string; avatar_url?: string } } };
  const user = userData.data?.user;

  return {
    accessToken,
    refreshToken: data.refresh_token as string,
    expiresAt,
    openId,
    username: user?.display_name ?? "TikTok User",
    avatarUrl: user?.avatar_url ?? null,
  };
}

export async function refreshTikTokToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number; newRefreshToken: string }> {
  const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data.error) throw new AppError(502, `TikTok token refresh failed`);
  return {
    accessToken: data.access_token as string,
    expiresAt: Date.now() + (Number(data.expires_in) * 1000),
    newRefreshToken: (data.refresh_token as string) ?? refreshToken,
  };
}

export interface TikTokUploadResult {
  publishId: string;
  url: string | null;
}

/**
 * Publishes a video to TikTok using the PULL_FROM_URL method.
 * TikTok fetches the video directly from the presigned MinIO URL.
 */
export async function uploadToTikTok(opts: {
  accessToken: string;
  title: string;
  description: string;
  hashtags: string[];
  presignedUrl: string;
  durationMs: number;
}): Promise<TikTokUploadResult> {
  const { accessToken, title, description, hashtags, presignedUrl, durationMs } = opts;

  const hashtagLine = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const caption = [title, description, hashtagLine]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2200);

  // Initialize the post
  const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: caption,
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: Math.min(1000, durationMs / 2),
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: presignedUrl,
        video_size: 0,
        chunk_size: 0,
        total_chunk_count: 1,
      },
    }),
  });

  const initData = (await initRes.json()) as { data?: { publish_id?: string }; error?: { message?: string } };
  if (!initRes.ok || initData.error?.message) {
    throw new AppError(502, `TikTok publish init failed: ${initData.error?.message ?? JSON.stringify(initData)}`);
  }

  const publishId = initData.data?.publish_id ?? "";

  return {
    publishId,
    url: null,
  };
}
