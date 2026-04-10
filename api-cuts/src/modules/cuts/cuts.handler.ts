import type { FastifyReply, FastifyRequest } from "fastify";
import type { ListCutsQuery, UpdateCutBody } from "./cuts.schema.js";
import { listCuts, getCutById, updateCut, deleteCut } from "./cuts.service.js";

export async function listCutsHandler(
  request: FastifyRequest<{ Querystring: ListCutsQuery }>,
  reply: FastifyReply
) {
  const result = await listCuts(request.query);
  return reply.status(200).send(result);
}

export async function getCutHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const cut = await getCutById(request.params.id);
  return reply.status(200).send(cut);
}

export async function updateCutHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateCutBody }>,
  reply: FastifyReply
) {
  const { title, description } = request.body;
  const patch: { title?: string; description?: string | null } = {};
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  const cut = await updateCut(request.params.id, patch);
  return reply.status(200).send(cut);
}

export async function deleteCutHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  await deleteCut(request.params.id);
  return reply.status(200).send({ success: true });
}
