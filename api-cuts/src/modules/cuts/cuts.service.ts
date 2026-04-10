import { eq, desc, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { cuts } from "../../db/schema.js";
import { minioClient } from "../../storage/minio.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import type { CutItem, ListCutsQuery } from "./cuts.schema.js";

const PRESIGNED_TTL = 24 * 60 * 60; // 24 h

async function presign(key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return await minioClient.presignedGetObject(env.MINIO_BUCKET, key, PRESIGNED_TTL);
  } catch {
    return null; // MinIO may be unavailable in dev
  }
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listCuts(
  query: ListCutsQuery
): Promise<{
  items: CutItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const { page, limit } = query;
  const offset = (page - 1) * limit;

  const countRow = db
    .select({ total: sql<number>`count(*)` })
    .from(cuts)
    .get();
  const total = countRow?.total ?? 0;

  const rows = db
    .select()
    .from(cuts)
    .orderBy(desc(cuts.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  const items: CutItem[] = await Promise.all(
    rows.map(async (row) => {
      // Prefer rendered key for the presigned URL, fall back to raw
      const storageKey = row.renderedStorageKey ?? row.rawStorageKey ?? null;
      const presignedUrl = await presign(storageKey);

      return {
        id: row.id,
        sourceVideoId: row.sourceVideoId,
        title: row.title,
        description: row.description ?? null,
        tags: JSON.parse(row.tagsJson) as string[],
        startMs: row.startMs,
        endMs: row.endMs,
        durationMs: row.durationMs,
        status: row.status,
        presignedUrl,
        createdAt: row.createdAt.toISOString(),
      };
    })
  );

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

// ── Get by ID ─────────────────────────────────────────────────────────────────

export async function getCutById(id: string): Promise<CutItem> {
  const [row] = db.select().from(cuts).where(eq(cuts.id, id)).all();
  if (!row) throw new AppError(404, `Cut ${id} not found`);

  const storageKey = row.renderedStorageKey ?? row.rawStorageKey ?? null;
  const presignedUrl = await presign(storageKey);

  return {
    id: row.id,
    sourceVideoId: row.sourceVideoId,
    title: row.title,
    description: row.description ?? null,
    tags: JSON.parse(row.tagsJson) as string[],
    startMs: row.startMs,
    endMs: row.endMs,
    durationMs: row.durationMs,
    status: row.status,
    presignedUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateCut(
  id: string,
  data: { title?: string; description?: string | null }
): Promise<CutItem> {
  const [row] = db.select().from(cuts).where(eq(cuts.id, id)).all();
  if (!row) throw new AppError(404, `Cut ${id} not found`);

  const updates: Partial<typeof cuts.$inferInsert> = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;

  if (Object.keys(updates).length > 0) {
    db.update(cuts).set(updates).where(eq(cuts.id, id)).run();
  }

  return getCutById(id);
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteCut(id: string): Promise<void> {
  const [row] = db.select().from(cuts).where(eq(cuts.id, id)).all();
  if (!row) throw new AppError(404, `Cut ${id} not found`);

  // Delete MinIO objects (best-effort — don't fail if already gone)
  const keysToDelete = [row.rawStorageKey, row.renderedStorageKey].filter(Boolean) as string[];
  await Promise.allSettled(
    keysToDelete.map((key) =>
      minioClient.removeObject(env.MINIO_BUCKET, key)
    )
  );

  db.delete(cuts).where(eq(cuts.id, id)).run();
}
