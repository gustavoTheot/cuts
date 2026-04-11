import type { FastifyPluginAsync } from "fastify";
import { desc } from "drizzle-orm";
import { db } from "../../db/client.js";
import { narratedVideos } from "../../db/schema.js";
import { NarratedRequestSchema } from "./narrated.schema.js";
import { runNarratedPipeline } from "./narrated.service.js";

const narratedRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /narrated/generate ── SSE pipeline ───────────────────────────────
  fastify.post("/narrated/generate", async (request, reply) => {
    const parsed = NarratedRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      });
    }

    // Open SSE stream — same pattern used by /pipeline
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // prevent Nginx from buffering the stream
    });

    const emit = (event: unknown) =>
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

    // Keep the connection alive through long renders (≈ 1–2 min)
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(": heartbeat\n\n");
    }, 15_000);

    emit({ type: "start", message: "Pipeline de narração iniciado…" });

    try {
      for await (const event of runNarratedPipeline(parsed.data)) {
        emit(event);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message });
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
  });

  // ── GET /narrated ── list all narrated videos ─────────────────────────────
  fastify.get("/narrated", async (_request, reply) => {
    const rows = db
      .select()
      .from(narratedVideos)
      .orderBy(desc(narratedVideos.createdAt))
      .all();
    return reply.status(200).send({ items: rows });
  });
};

export default narratedRoutes;
