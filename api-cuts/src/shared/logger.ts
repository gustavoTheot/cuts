import { env } from "../config/env.js";

export const loggerOptions =
  env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : true;
