const BASE = "/api/v1";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CutItem {
  id: string;
  sourceVideoId: string;
  title: string;
  description: string | null;
  tags: string[];
  hashtags?: string[];
  startMs: number;
  endMs: number;
  durationMs: number;
  status: string;
  presignedUrl: string | null;
  createdAt: string;
}

export interface SocialAccount {
  platform: "youtube" | "tiktok";
  platformUserId: string;
  username: string;
  avatarUrl: string | null;
  connectedAt: string;
}

export interface SocialPost {
  id: string;
  platform: string;
  postUrl: string | null;
  status: string;
  createdAt: string;
}

export interface ListCutsResponse {
  items: CutItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ManualCut {
  startMs: number;
  endMs: number;
  title?: string;
}

export interface PipelineRequest {
  url: string;
  lang?: string;
  instructions?: string;
  maxCuts?: number;
  maxDurationMs?: number;
  subtitles?: boolean;
  manualCut?: ManualCut;
}

export type PipelineEvent =
  | { type: "start"; message: string }
  | { type: "step"; step: "transcription" | "intelligence"; status: "running" | "done"; message: string }
  | { type: "cut_progress"; index: number; total: number; phase: "capturing" | "rendering"; titulo: string }
  | { type: "cut_phase_progress"; index: number; phase: "capturing" | "rendering"; percent: number }
  | { type: "cut_ready"; index: number; cut: ReadyCut }
  | { type: "cut_error"; index: number; titulo: string; message: string }
  | { type: "done"; successCount: number; failCount: number; requestedCount: number }
  | { type: "error"; message: string };

export interface ReadyCut {
  id: string;
  titulo: string;
  tags: string[];
  durationMs: number;
  startMs: number;
  endMs: number;
  presignedUrl: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function listCuts(page = 1, limit = 9): Promise<ListCutsResponse> {
  const res = await fetch(`${BASE}/cuts?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error(`Erro ao listar cortes: ${res.statusText}`);
  return res.json() as Promise<ListCutsResponse>;
}

export async function deleteCut(id: string): Promise<void> {
  const res = await fetch(`${BASE}/cuts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Erro ao remover corte: ${res.statusText}`);
}

export async function updateCut(
  id: string,
  data: { title?: string; description?: string | null }
): Promise<CutItem> {
  const res = await fetch(`${BASE}/cuts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Erro ao atualizar corte: ${res.statusText}`);
  return res.json() as Promise<CutItem>;
}

// ── Social ────────────────────────────────────────────────────────────────────

export async function listSocialAccounts(): Promise<SocialAccount[]> {
  const res = await fetch(`${BASE}/social/accounts`);
  if (!res.ok) throw new Error("Erro ao listar contas sociais");
  const data = (await res.json()) as { accounts: SocialAccount[] };
  return data.accounts;
}

export function getSocialAuthUrl(platform: "youtube" | "tiktok"): string {
  return `${BASE}/social/auth/${platform}`;
}

export async function disconnectSocial(platform: "youtube" | "tiktok"): Promise<void> {
  await fetch(`${BASE}/social/accounts/${platform}`, { method: "DELETE" });
}

export async function publishCut(opts: {
  cutId: string;
  platform: "youtube" | "tiktok";
  title?: string;
  description?: string;
}): Promise<{ postId: string; postUrl: string | null; status: string }> {
  const res = await fetch(`${BASE}/social/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Erro ao publicar: ${res.statusText}`);
  }
  return res.json() as Promise<{ postId: string; postUrl: string | null; status: string }>;
}

export async function getSocialPosts(cutId: string): Promise<SocialPost[]> {
  const res = await fetch(`${BASE}/social/posts/${cutId}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { posts: SocialPost[] };
  return data.posts;
}

/**
 * Opens an SSE connection to the pipeline endpoint.
 * Calls onEvent for each SSE message and onClose when the stream ends.
 * Returns a cancel function.
 */
export function startPipeline(
  request: PipelineRequest,
  onEvent: (event: PipelineEvent) => void,
  onClose: () => void
): () => void {
  let aborted = false;
  const controller = new AbortController();

  (async () => {
    const res = await fetch(`${BASE}/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      onEvent({ type: "error", message: `Erro HTTP ${res.status}` });
      onClose();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done || aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.replace(/^data: /, "").trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as PipelineEvent;
          onEvent(parsed);
        } catch {
          // malformed SSE line — ignore
        }
      }
    }

    onClose();
  })().catch((err: unknown) => {
    if (aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    onEvent({ type: "error", message: msg });
    onClose();
  });

  return () => {
    aborted = true;
    controller.abort();
  };
}
