import type { FastifyReply, FastifyRequest } from "fastify";
import type { RenderRequest } from "./render.schema.js";
import { renderClip } from "./render.service.js";

export async function renderHandler(
  request: FastifyRequest<{ Body: RenderRequest }>,
  reply: FastifyReply
) {
  const result = await renderClip(request.body, (msg) =>
    request.log.info(msg)
  );
  return reply.status(201).send(result);
}
