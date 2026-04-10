import type { FastifyPluginAsync } from "fastify";
import {
  CaptureRequestSchema,
  CaptureResponseSchema,
  ErrorResponseSchema,
} from "./capture.schema.js";
import { captureHandler } from "./capture.handler.js";

const captureRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/capture", {
    schema: {
      body: CaptureRequestSchema,
      response: {
        201: CaptureResponseSchema,
        400: ErrorResponseSchema,
        502: ErrorResponseSchema,
        504: ErrorResponseSchema,
      },
    },
    handler: captureHandler,
  });
};

export default captureRoutes;
