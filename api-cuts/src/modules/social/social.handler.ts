import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import {
  getAuthUrl, handleCallback, listAccounts, disconnectAccount, publishCut, getPostsForCut,
} from "./social.service.js";
import type { PublishBody, Platform } from "./social.schema.js";

export async function authHandler(
  request: FastifyRequest<{ Params: { platform: string } }>,
  reply: FastifyReply
) {
  const platform = request.params.platform as Platform;
  const url = getAuthUrl(platform);
  return reply.redirect(url);
}

export async function callbackHandler(
  request: FastifyRequest<{ Params: { platform: string }; Querystring: { code?: string; error?: string } }>,
  reply: FastifyReply
) {
  const platform = request.params.platform as Platform;
  const { code, error } = request.query;

  if (error || !code) {
    return reply.redirect(`${env.FRONTEND_URL}?social_error=${platform}`);
  }

  try {
    await handleCallback(platform, code);
    return reply.redirect(`${env.FRONTEND_URL}?social_connected=${platform}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    request.log.error({ err }, `Social callback error for ${platform}`);
    return reply.redirect(`${env.FRONTEND_URL}?social_error=${platform}&msg=${encodeURIComponent(msg)}`);
  }
}

export async function listAccountsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const accounts = listAccounts();
  return reply.send({ accounts });
}

export async function disconnectHandler(
  request: FastifyRequest<{ Params: { platform: string } }>,
  reply: FastifyReply
) {
  disconnectAccount(request.params.platform as Platform);
  return reply.send({ success: true });
}

export async function publishHandler(
  request: FastifyRequest<{ Body: PublishBody }>,
  reply: FastifyReply
) {
  const { cutId, platform, title, description } = request.body;
  const opts: { cutId: string; platform: typeof platform; title?: string; description?: string } = { cutId, platform };
  if (title !== undefined) opts.title = title;
  if (description !== undefined) opts.description = description;
  const result = await publishCut(opts);
  return reply.status(202).send(result);
}

export async function postHistoryHandler(
  request: FastifyRequest<{ Params: { cutId: string } }>,
  reply: FastifyReply
) {
  const posts = getPostsForCut(request.params.cutId);
  return reply.send({ posts });
}
