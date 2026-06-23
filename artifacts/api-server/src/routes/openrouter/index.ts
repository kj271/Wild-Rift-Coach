import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import { openrouter } from "@workspace/integrations-openrouter-ai";
import {
  CreateOpenrouterConversationBody,
  GetOpenrouterConversationParams,
  DeleteOpenrouterConversationParams,
  ListOpenrouterMessagesParams,
  SendOpenrouterMessageParams,
  SendOpenrouterMessageBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const WILD_RIFT_CHAT_SYSTEM = `You are a Wild Rift macro coach assistant. Help players improve their decision-making and macro play. Answer questions about objectives, rotations, wave management, vision control, and team fighting. Be concise and direct.

MAP NOTE: Wild Rift map orientation depends on which team (blue side vs red side) the player is on. Top Lane is where Baron spawns; Bottom Lane is where Dragon spawns — but Baron pit may appear at the top OR bottom of the minimap image. Never assume Baron is at the top or Dragon is at the bottom of any image. Always rely on the lane labels (Top Lane / Bottom Lane) in game context.`;

router.get("/openrouter/conversations", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(conversations)
    .orderBy(asc(conversations.createdAt));
  res.json(rows.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt })));
});

router.post("/openrouter/conversations", async (req, res): Promise<void> => {
  const parsed = CreateOpenrouterConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [conv] = await db
    .insert(conversations)
    .values({ title: parsed.data.title })
    .returning();

  res.status(201).json({ id: conv!.id, title: conv!.title, createdAt: conv!.createdAt });
});

router.get("/openrouter/conversations/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetOpenrouterConversationParams.safeParse({ id: parseInt(rawId!, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(asc(messages.createdAt));

  res.json({
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    messages: msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  });
});

router.patch("/openrouter/conversations/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const idNum = parseInt(rawId!, 10);
  if (isNaN(idNum)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { title } = req.body as { title?: string };
  if (typeof title !== "string" || !title.trim()) { res.status(400).json({ error: "title required" }); return; }
  const [updated] = await db
    .update(conversations)
    .set({ title: title.trim() })
    .where(eq(conversations.id, idNum))
    .returning();
  if (!updated) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.json({ id: updated.id, title: updated.title, createdAt: updated.createdAt });
});

router.delete("/openrouter/conversations/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteOpenrouterConversationParams.safeParse({ id: parseInt(rawId!, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(conversations)
    .where(eq(conversations.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/openrouter/conversations/:id/messages", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ListOpenrouterMessagesParams.safeParse({ id: parseInt(rawId!, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(asc(messages.createdAt));

  res.json(
    msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    }))
  );
});

router.post("/openrouter/conversations/:id/messages", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = SendOpenrouterMessageParams.safeParse({ id: parseInt(rawId!, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = SendOpenrouterMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { content, model, context } = parsed.data;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  await db.insert(messages).values({
    conversationId: params.data.id,
    role: "user",
    content,
  });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(asc(messages.createdAt));

  let systemPrompt = WILD_RIFT_CHAT_SYSTEM;
  if (context) {
    const ctxParts: string[] = ["\n\nCurrent game context:"];
    if (context.gameTime) ctxParts.push(`- Game time: ${context.gameTime}`);
    if (context.myRole) ctxParts.push(`- Role: ${context.myRole}`);
    if (context.myLocation) ctxParts.push(`- Location: ${context.myLocation}`);
    if (context.allyChampions) ctxParts.push(`- Allies: ${context.allyChampions}`);
    if (context.enemyChampions) ctxParts.push(`- Enemies: ${context.enemyChampions}`);
    if (context.dragonStatus) ctxParts.push(`- Dragon: ${context.dragonStatus}`);
    if (context.baronStatus) ctxParts.push(`- Baron: ${context.baronStatus}`);
    if (context.riftHeraldStatus) ctxParts.push(`- Rift Herald: ${context.riftHeraldStatus}`);
    if (context.goldDiff) ctxParts.push(`- Gold diff: ${context.goldDiff}`);
    if (context.score) ctxParts.push(`- Score: ${context.score}`);
    systemPrompt += ctxParts.join("\n");
  }

  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  try {
    const stream = await openrouter.chat.completions.create({
      model,
      max_tokens: 8192,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const chunkContent = chunk.choices[0]?.delta?.content;
      if (chunkContent) {
        fullResponse += chunkContent;
        res.write(`data: ${JSON.stringify({ content: chunkContent })}\n\n`);
      }
    }

    await db.insert(messages).values({
      conversationId: params.data.id,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error streaming message");
    if (fullResponse) {
      await db.insert(messages).values({
        conversationId: params.data.id,
        role: "assistant",
        content: fullResponse,
      });
    }
    res.write(`data: ${JSON.stringify({ error: "AI response failed", done: true })}\n\n`);
    res.end();
  }
});

export default router;
