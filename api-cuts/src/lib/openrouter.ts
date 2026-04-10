import OpenAI from "openai";
import { env } from "../config/env.js";

/**
 * OpenAI-SDK client pointed at OpenRouter.
 * Swap models at request time by passing a different `model` parameter.
 */
export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/api-cuts",
    "X-Title": "api-cuts",
  },
});
