import type { FastifyReply, FastifyRequest } from "fastify";
import type { ListCutsQuery } from "./cuts.schema.js";
import { listCuts, deleteCut } from "./cuts.service.js";

export async function listCutsHandler(
  request: FastifyRequest<{ Querystring: ListCutsQuery }>,
  reply: FastifyReply
) {
  const result = await listCuts(request.query);
  return reply.status(200).send(result);
}

export async function deleteCutHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  await deleteCut(request.params.id);
  return reply.status(200).send({ success: true });
}
