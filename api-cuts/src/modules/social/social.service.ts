import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../../db/client.js";
import { cuts, socialAccounts, socialPosts } from "../../db/schema.js";
import { minioClient } from "../../storage/minio.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import {
  getYouTubeAuthUrl, exchangeYouTubeCode, refreshYouTubeToken, uploadToYouTube,
} from "./platforms/youtube.js";
import {
  getTikTokAuthUrl, exchangeTikTokCode, refreshTikTokToken, uploadToTikTok, consumePkceVerifier,
} from "./platforms/tiktok.js";
import type { Platform } from "./social.schema.js";

const PRESIGNED_TTL = 6 * 60 * 60; // 6 h (TikTok needs time to pull)

// ── OAuth ─────────────────────────────────────────────────────────────────────

export function getAuthUrl(platform: Platform): string {
  const state = nanoid(16);
  if (platform === "youtube") return getYouTubeAuthUrl(state);
  return getTikTokAuthUrl(state);
}

export async function handleCallback(
  platform: Platform,
  code: string,
  state?: string
): Promise<void> {
  if (platform === "youtube") {
    const tokens = await exchangeYouTubeCode(code);
    const existing = db.select().from(socialAccounts).where(eq(socialAccounts.platform, "youtube")).get();
    const now = new Date();
    if (existing) {
      db.update(socialAccounts)
        .set({
          platformUserId: tokens.userId,
          username: tokens.username,
          avatarUrl: tokens.avatarUrl,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenExpiresAt: tokens.expiresAt,
        })
        .where(eq(socialAccounts.platform, "youtube"))
        .run();
    } else {
      db.insert(socialAccounts).values({
        id: nanoid(),
        platform: "youtube",
        platformUserId: tokens.userId,
        username: tokens.username,
        avatarUrl: tokens.avatarUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        createdAt: now,
      }).run();
    }
    return;
  }

  // TikTok — recover PKCE verifier from state
  if (!state) throw new AppError(400, "TikTok callback missing state parameter");
  const codeVerifier = consumePkceVerifier(state);
  const tokens = await exchangeTikTokCode(code, codeVerifier);
  const existing = db.select().from(socialAccounts).where(eq(socialAccounts.platform, "tiktok")).get();
  const now = new Date();
  if (existing) {
    db.update(socialAccounts)
      .set({
        platformUserId: tokens.openId,
        username: tokens.username,
        avatarUrl: tokens.avatarUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
      })
      .where(eq(socialAccounts.platform, "tiktok"))
      .run();
  } else {
    db.insert(socialAccounts).values({
      id: nanoid(),
      platform: "tiktok",
      platformUserId: tokens.openId,
      username: tokens.username,
      avatarUrl: tokens.avatarUrl,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      createdAt: now,
    }).run();
  }
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export function listAccounts() {
  return db.select().from(socialAccounts).all().map((a) => ({
    platform: a.platform as Platform,
    platformUserId: a.platformUserId,
    username: a.username,
    avatarUrl: a.avatarUrl,
    connectedAt: a.createdAt.toISOString(),
  }));
}

export function disconnectAccount(platform: Platform) {
  db.delete(socialAccounts).where(eq(socialAccounts.platform, platform)).run();
}

// ── Token refresh helper ──────────────────────────────────────────────────────

async function getValidToken(platform: Platform): Promise<string> {
  const account = db.select().from(socialAccounts).where(eq(socialAccounts.platform, platform)).get();
  if (!account) throw new AppError(401, `Conta ${platform} não conectada. Conecte sua conta primeiro.`);

  const isExpired = account.tokenExpiresAt && account.tokenExpiresAt < Date.now() + 60_000;
  if (!isExpired) return account.accessToken;

  // Refresh
  if (!account.refreshToken) throw new AppError(401, `Token ${platform} expirado e sem refresh token. Reconecte sua conta.`);

  if (platform === "youtube") {
    const refreshed = await refreshYouTubeToken(account.refreshToken);
    db.update(socialAccounts)
      .set({ accessToken: refreshed.accessToken, tokenExpiresAt: refreshed.expiresAt })
      .where(eq(socialAccounts.platform, platform))
      .run();
    return refreshed.accessToken;
  }

  // TikTok
  const refreshed = await refreshTikTokToken(account.refreshToken);
  db.update(socialAccounts)
    .set({ accessToken: refreshed.accessToken, refreshToken: refreshed.newRefreshToken, tokenExpiresAt: refreshed.expiresAt })
    .where(eq(socialAccounts.platform, platform))
    .run();
  return refreshed.accessToken;
}

// ── Publish ───────────────────────────────────────────────────────────────────

export async function publishCut(opts: {
  cutId: string;
  platform: Platform;
  title?: string;
  description?: string;
}): Promise<{ postId: string; postUrl: string | null; status: string }> {
  const { cutId, platform } = opts;

  const [cut] = db.select().from(cuts).where(eq(cuts.id, cutId)).all();
  if (!cut) throw new AppError(404, `Corte ${cutId} não encontrado`);
  if (cut.status !== "rendered" || !cut.renderedStorageKey) {
    throw new AppError(400, "Corte ainda não está renderizado. Aguarde o processamento terminar.");
  }

  const title = (opts.title ?? cut.title).slice(0, 100);
  const description = opts.description ?? cut.description ?? "";
  const hashtags = JSON.parse(cut.hashtagsJson) as string[];
  const accessToken = await getValidToken(platform);
  const account = db.select().from(socialAccounts).where(eq(socialAccounts.platform, platform)).get()!;

  const postId = nanoid();
  const now = new Date();

  // Create a pending record immediately
  db.insert(socialPosts).values({
    id: postId,
    cutId,
    platform,
    status: "pending",
    createdAt: now,
  }).run();

  try {
    let platformPostId: string;
    let platformPostUrl: string | null;

    if (platform === "youtube") {
      const result = await uploadToYouTube({
        accessToken,
        refreshToken: account.refreshToken,
        title,
        description,
        hashtags,
        storageKey: cut.renderedStorageKey,
      });
      platformPostId = result.videoId;
      platformPostUrl = result.url;
    } else {
      // TikTok — generate a fresh presigned URL for TikTok to pull
      const presignedUrl = await minioClient.presignedGetObject(env.MINIO_BUCKET, cut.renderedStorageKey, PRESIGNED_TTL);
      const result = await uploadToTikTok({
        accessToken,
        title,
        description,
        hashtags,
        presignedUrl,
        durationMs: cut.durationMs,
      });
      platformPostId = result.publishId;
      platformPostUrl = result.url;
    }

    db.update(socialPosts)
      .set({ status: "published", platformPostId, platformPostUrl })
      .where(eq(socialPosts.id, postId))
      .run();

    return { postId, postUrl: platformPostUrl, status: "published" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(socialPosts)
      .set({ status: "failed", errorMessage: message })
      .where(eq(socialPosts.id, postId))
      .run();
    throw err;
  }
}

// ── Post history for a cut ────────────────────────────────────────────────────

export function getPostsForCut(cutId: string) {
  return db.select().from(socialPosts).where(eq(socialPosts.cutId, cutId)).all().map((p) => ({
    id: p.id,
    platform: p.platform,
    postUrl: p.platformPostUrl,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  }));
}
