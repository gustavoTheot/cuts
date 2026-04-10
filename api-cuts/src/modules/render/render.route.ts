import type { FastifyPluginAsync } from "fastify";
import {
  RenderRequestSchema,
  RenderResponseSchema,
  ErrorResponseSchema,
} from "./render.schema.js";
import { renderHandler } from "./render.handler.js";

const renderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/render", {
    schema: {
      body: RenderRequestSchema,
      response: {
        201: RenderResponseSchema,
        400: ErrorResponseSchema,
        502: ErrorResponseSchema,
      },
    },
    handler: renderHandler,
  });
};

export default renderRoutes;
