import { buildServer } from "./server.js";
import { env } from "./config/env.js";
import { ensureBucket } from "./storage/minio.js";

const app = await buildServer();

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Connect to MinIO after server starts (non-fatal in dev if unavailable)
ensureBucket().catch((err: unknown) => {
  app.log.warn({ err }, "MinIO bucket init failed — storage unavailable");
});
