import type { FastifyPluginAsync } from "fastify";
import {
  IntelligenceRequestSchema,
  IntelligenceResponseSchema,
  ErrorResponseSchema,
} from "./intelligence.schema.js";
import { intelligenceHandler } from "./intelligence.handler.js";

const intelligenceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/intelligence", {
    schema: {
      body: IntelligenceRequestSchema,
      response: {
        200: IntelligenceResponseSchema,
        400: ErrorResponseSchema,
        502: ErrorResponseSchema,
      },
    },
    handler: intelligenceHandler,
  });
};

export default intelligenceRoutes;
