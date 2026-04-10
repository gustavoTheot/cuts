import type { FastifyPluginAsync } from "fastify";
import {
  TranscriptionRequestSchema,
  TranscriptionResponseSchema,
  ErrorResponseSchema,
} from "./transcription.schema.js";
import { transcribeHandler } from "./transcription.handler.js";

const transcriptionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/transcription", {
    schema: {
      body: TranscriptionRequestSchema,
      response: {
        200: TranscriptionResponseSchema,
        400: ErrorResponseSchema,
        502: ErrorResponseSchema,
      },
    },
    handler: transcribeHandler,
  });
};

export default transcriptionRoutes;
