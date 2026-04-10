import type { FastifyReply, FastifyRequest } from "fastify";
import type { TranscriptionRequest } from "./transcription.schema.js";
import { getTranscription } from "./transcription.service.js";

export async function transcribeHandler(
  request: FastifyRequest<{ Body: TranscriptionRequest }>,
  reply: FastifyReply
) {
  const { url, lang } = request.body;
  const result = await getTranscription(url, lang);
  return reply.status(200).send(result);
}
