import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { loggerOptions } from "./shared/logger.js";
import { errorHandler } from "./shared/errors.js";
import transcriptionRoutes from "./modules/transcription/transcription.route.js";
import intelligenceRoutes from "./modules/intelligence/intelligence.route.js";
import captureRoutes from "./modules/capture/capture.route.js";
import renderRoutes from "./modules/render/render.route.js";
import cutsRoutes from "./modules/cuts/cuts.route.js";
import pipelineRoutes from "./modules/pipeline/pipeline.route.js";
import socialRoutes from "./modules/social/social.route.js";
import narratedRoutes from "./modules/narrated/narrated.route.js";

export async function buildServer() {
  const app = Fastify({ logger: loggerOptions });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler(errorHandler);

  await app.register(cors, { origin: true });
  await app.register(sensible);

  await app.register(transcriptionRoutes, { prefix: "/api/v1" });
  await app.register(intelligenceRoutes, { prefix: "/api/v1" });
  await app.register(captureRoutes, { prefix: "/api/v1" });
  await app.register(renderRoutes, { prefix: "/api/v1" });
  await app.register(cutsRoutes, { prefix: "/api/v1" });
  await app.register(pipelineRoutes, { prefix: "/api/v1" });
  await app.register(socialRoutes, { prefix: "/api/v1" });
  await app.register(narratedRoutes, { prefix: "/api/v1" });

  return app;
}
