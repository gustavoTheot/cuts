import type { FastifyPluginAsync } from "fastify";
import { PipelineRequestSchema } from "./pipeline.schema.js";
import { runPipeline } from "./pipeline.service.js";

const pipelineRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/pipeline", async (request, reply) => {
    // Validate body manually — we bypass Fastify serialization for SSE
    const parsed = PipelineRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      });
    }

    // Open SSE stream
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable Nginx buffering
    });

    const emit = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Heartbeat keeps the connection alive through proxies and long downloads
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(": heartbeat\n\n");
    }, 15_000);

    emit({ type: "start", message: "Pipeline iniciado…" });

    try {
      for await (const event of runPipeline(parsed.data)) {
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
};

export default pipelineRoutes;
