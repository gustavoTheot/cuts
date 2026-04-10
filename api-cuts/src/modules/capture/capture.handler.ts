import type { FastifyReply, FastifyRequest } from "fastify";
import type { CaptureRequest } from "./capture.schema.js";
import { captureSection } from "./capture.service.js";

export async function captureHandler(
  request: FastifyRequest<{ Body: CaptureRequest }>,
  reply: FastifyReply
) {
  const result = await captureSection(request.body, (msg) =>
    request.log.info(msg)
  );
  return reply.status(201).send(result);
}
