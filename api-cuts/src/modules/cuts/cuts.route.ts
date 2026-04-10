import type { FastifyPluginAsync } from "fastify";
import {
  ListCutsQuerySchema,
  ListCutsResponseSchema,
  DeleteCutParamsSchema,
  DeleteCutResponseSchema,
  ErrorResponseSchema,
} from "./cuts.schema.js";
import { listCutsHandler, deleteCutHandler } from "./cuts.handler.js";

const cutsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/cuts", {
    schema: {
      querystring: ListCutsQuerySchema,
      response: {
        200: ListCutsResponseSchema,
        400: ErrorResponseSchema,
      },
    },
    handler: listCutsHandler,
  });

  fastify.delete("/cuts/:id", {
    schema: {
      params: DeleteCutParamsSchema,
      response: {
        200: DeleteCutResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: deleteCutHandler,
  });
};

export default cutsRoutes;
