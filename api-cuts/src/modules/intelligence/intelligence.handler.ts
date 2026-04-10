import type { FastifyReply, FastifyRequest } from "fastify";
import type { IntelligenceRequest } from "./intelligence.schema.js";
import { analyzeTranscript } from "./intelligence.service.js";

export async function intelligenceHandler(
  request: FastifyRequest<{ Body: IntelligenceRequest }>,
  reply: FastifyReply
) {
  const result = await analyzeTranscript(request.body);
  return reply.status(200).send(result);
}
