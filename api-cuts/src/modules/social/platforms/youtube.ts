import { google } from "googleapis";
import { createReadStream, existsSync, mkdirSync, unlinkSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { env } from "../../../config/env.js";
import { minioClient } from "../../../storage/minio.js";
import { AppError } from "../../../shared/errors.js";

const REDIRECT_URI = `${new URL(env.FRONTEND_URL).origin.replace("5173", "3000")}/api/v1/social/callback/youtube`;

export function getYouTubeAuthUrl(state: string): string {
  if (!env.YOUTUBE_CLIENT_ID) throw new AppError(501, "YouTube OAuth not configured — set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET");
  const oauth2 = new google.auth.OAuth2(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET, REDIRECT_URI);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/userinfo.profile"],
    state,
  });
}

export interface YouTubeTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  userId: string;
  username: string;
  avatarUrl: string | null;
}

export async function exchangeYouTubeCode(code: string): Promise<YouTubeTokens> {
  const oauth2 = new google.auth.OAuth2(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET, REDIRECT_URI);
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  const profile = google.oauth2({ version: "v2", auth: oauth2 });
  const { data: userInfo } = await profile.userinfo.get();

  return {
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ?? null,
    userId: userInfo.id!,
    username: userInfo.name ?? userInfo.email ?? "YouTube User",
    avatarUrl: userInfo.picture ?? null,
  };
}

export async function refreshYouTubeToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const oauth2 = new google.auth.OAuth2(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET, REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2.refreshAccessToken();
  return {
    accessToken: credentials.access_token!,
    expiresAt: credentials.expiry_date ?? Date.now() + 3600_000,
  };
}

export interface YouTubeUploadResult {
  videoId: string;
  url: string;
}

export async function uploadToYouTube(opts: {
  accessToken: string;
  refreshToken: string | null;
  title: string;
  description: string;
  hashtags: string[];
  storageKey: string;
}): Promise<YouTubeUploadResult> {
  const { accessToken, refreshToken, title, description, hashtags, storageKey } = opts;

  const oauth2 = new google.auth.OAuth2(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET, REDIRECT_URI);
  oauth2.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  const youtube = google.youtube({ version: "v3", auth: oauth2 });

  // Build description with hashtags
  const hashtagLine = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const fullDescription = [description, "", hashtagLine].filter(Boolean).join("\n");

  // Download from MinIO to a temp file
  const tmpDir = join(tmpdir(), "api-cuts");
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, `yt_upload_${Date.now()}.mp4`);

  try {
    const stream = await minioClient.getObject(env.MINIO_BUCKET, storageKey);
    await pipeline(stream, createWriteStream(tmpPath));

    const res = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: title.slice(0, 100),
          description: fullDescription.slice(0, 5000),
          tags: hashtags.map((h) => h.replace(/^#/, "")),
          categoryId: "22", // People & Blogs — common for Shorts
          defaultLanguage: "pt",
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        mimeType: "video/mp4",
        body: createReadStream(tmpPath),
      },
    });

    const videoId = res.data.id!;
    return {
      videoId,
      url: `https://www.youtube.com/shorts/${videoId}`,
    };
  } finally {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}
