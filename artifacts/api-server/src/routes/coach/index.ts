import { Router, type IRouter } from "express";
import { openrouter } from "@workspace/integrations-openrouter-ai";
import { AnalyzeScreenshotBody } from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const WILD_RIFT_MACRO_SYSTEM_PROMPT = `You are an expert Wild Rift macro coach. You analyze game states and provide concise, actionable macro advice.

When given a screenshot or game context, provide:
1. The single most important macro action to take RIGHT NOW (1-2 sentences max)
2. Why (brief reasoning)
3. Secondary objectives to keep in mind (if any)

Be direct and decisive. Players need fast, clear guidance. Avoid vague advice like "farm more" — give specific, situational recommendations like "Rotate mid for Dragon, your jungler should be clearing bot side buff right now."

Format your response in clear sections:
**What to do:** [immediate action]
**Why:** [brief reasoning]
**Watch for:** [secondary considerations, optional]`;

function buildUserMessage(body: {
  imageBase64?: string | null;
  context?: {
    gameTime?: string | null;
    myLocation?: string | null;
    myRole?: string | null;
    allyChampions?: string | null;
    enemyChampions?: string | null;
    dragonStatus?: string | null;
    baronStatus?: string | null;
    riftHeraldStatus?: string | null;
    goldDiff?: string | null;
    score?: string | null;
    additionalNotes?: string | null;
  } | null;
}): string {
  const ctx = body.context;
  const parts: string[] = [];

  if (ctx) {
    parts.push("**Current Game State:**");
    if (ctx.gameTime) parts.push(`- Game time: ${ctx.gameTime}`);
    if (ctx.myRole) parts.push(`- My role: ${ctx.myRole}`);
    if (ctx.myLocation) parts.push(`- My location: ${ctx.myLocation}`);
    if (ctx.allyChampions) parts.push(`- Ally champions: ${ctx.allyChampions}`);
    if (ctx.enemyChampions) parts.push(`- Enemy champions: ${ctx.enemyChampions}`);
    if (ctx.dragonStatus) parts.push(`- Dragon: ${ctx.dragonStatus}`);
    if (ctx.baronStatus) parts.push(`- Baron: ${ctx.baronStatus}`);
    if (ctx.riftHeraldStatus) parts.push(`- Rift Herald: ${ctx.riftHeraldStatus}`);
    if (ctx.goldDiff) parts.push(`- Gold difference: ${ctx.goldDiff}`);
    if (ctx.score) parts.push(`- Score: ${ctx.score}`);
    if (ctx.additionalNotes) parts.push(`- Additional notes: ${ctx.additionalNotes}`);
  }

  if (body.imageBase64) {
    parts.push("\nAnalyze the attached screenshot and provide macro advice based on the minimap, game state, and the context above.");
  } else if (parts.length > 0) {
    parts.push("\nBased on the game state above, what should I do right now?");
  } else {
    parts.push("What should I focus on macro-wise right now? Please ask me for more context if needed.");
  }

  return parts.join("\n");
}

router.post("/coach/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeScreenshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { model, imageBase64, context } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const userText = buildUserMessage({ imageBase64, context });

  type MessageParam =
    | { role: "system" | "user" | "assistant"; content: string }
    | { role: "user"; content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> };

  const messages: MessageParam[] = [
    { role: "system", content: WILD_RIFT_MACRO_SYSTEM_PROMPT },
  ];

  if (imageBase64) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: userText },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${imageBase64}` },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: userText });
  }

  try {
    const stream = await openrouter.chat.completions.create({
      model,
      max_tokens: 8192,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error streaming macro advice");
    res.write(`data: ${JSON.stringify({ error: "Failed to get AI response", done: true })}\n\n`);
    res.end();
  }
});

router.get("/coach/models", async (req, res): Promise<void> => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY}`,
      },
    });

    if (!response.ok) {
      req.log.error({ status: response.status }, "Failed to fetch OpenRouter models");
      res.status(502).json({ error: "Failed to fetch models from OpenRouter" });
      return;
    }

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        name: string;
        description?: string;
        context_length?: number;
        pricing?: { prompt: string; completion: string };
      }>;
    };

    const models = (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      description: m.description ?? null,
      context_length: m.context_length ?? null,
      pricing: m.pricing ?? { prompt: "0", completion: "0" },
    }));

    res.json(models);
  } catch (err) {
    req.log.error({ err }, "Error fetching models");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
