import OpenAI from "openai";

const apiKey = process.env.OPENROUTER_API_KEY || process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
const baseURL = process.env.OPENROUTER_API_KEY
  ? "https://openrouter.ai/api/v1"
  : process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;

if (!apiKey) {
  throw new Error(
    "No OpenRouter API key found. Set OPENROUTER_API_KEY to use your own key.",
  );
}

if (!baseURL) {
  throw new Error(
    "No OpenRouter base URL found. Set OPENROUTER_API_KEY or provision the Replit OpenRouter AI integration.",
  );
}

export const openrouter = new OpenAI({
  baseURL,
  apiKey,
  defaultHeaders: {
    "HTTP-Referer": "https://wild-rift-coach.replit.app",
    "X-Title": "Wild Rift Macro Coach",
  },
});
