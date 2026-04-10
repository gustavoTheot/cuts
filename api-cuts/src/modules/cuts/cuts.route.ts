import type { FastifyPluginAsync } from "fastify";
import {
  ListCutsQuerySchema,
  ListCutsResponseSchema,
  CutItemSchema,
  GetCutParamsSchema,
  UpdateCutParamsSchema,
  UpdateCutBodySchema,
  DeleteCutParamsSchema,
  DeleteCutResponseSchema,
  ErrorResponseSchema,
} from "./cuts.schema.js";
import {
  listCutsHandler,
  getCutHandler,
  updateCutHandler,
  deleteCutHandler,
} from "./cuts.handler.js";

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

  fastify.get("/cuts/:id", {
    schema: {
      params: GetCutParamsSchema,
      response: {
        200: CutItemSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: getCutHandler,
  });

  fastify.patch("/cuts/:id", {
    schema: {
      params: UpdateCutParamsSchema,
      body: UpdateCutBodySchema,
      response: {
        200: CutItemSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: updateCutHandler,
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
