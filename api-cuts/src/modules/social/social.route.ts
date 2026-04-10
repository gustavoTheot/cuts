import type { FastifyPluginAsync } from "fastify";
import { PublishBodySchema } from "./social.schema.js";
import {
  authHandler, callbackHandler, listAccountsHandler,
  disconnectHandler, publishHandler, postHistoryHandler,
} from "./social.handler.js";

const socialRoutes: FastifyPluginAsync = async (fastify) => {
  // Initiate OAuth
  fastify.get("/social/auth/:platform", { handler: authHandler });

  // OAuth callback (redirects to frontend)
  fastify.get("/social/callback/:platform", { handler: callbackHandler });

  // List connected accounts
  fastify.get("/social/accounts", { handler: listAccountsHandler });

  // Disconnect a platform
  fastify.delete("/social/accounts/:platform", { handler: disconnectHandler });

  // Publish a cut to a platform
  fastify.post("/social/publish", {
    schema: { body: PublishBodySchema },
    handler: publishHandler,
  });

  // Post history for a cut
  fastify.get("/social/posts/:cutId", { handler: postHistoryHandler });
};

export default socialRoutes;
