import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { settings } from "../db/schema";
import { checkOllama } from "../agent/ollama";

export const settingsRoutes = new Hono()
  .get("/", async (c) => {
    const all = await db.select().from(settings);
    const obj: Record<string, string> = {};
    for (const s of all) obj[s.key] = s.value;
    return c.json(obj);
  })

  .put("/", async (c) => {
    const body = (await c.req.json()) as Record<string, string>;
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(body)) {
      await db
        .insert(settings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
    }
    return c.json({ ok: true });
  });

export const providerRoutes = new Hono()
  .get("/", async (c) => {
    const all = await db.select().from(settings);
    const providers = all
      .filter((s) => s.key.startsWith("provider:"))
      .map((s) => {
        const p = JSON.parse(s.value);
        return { ...p, apiKey: p.apiKey ? "***" : "" };
      });
    return c.json({ providers });
  })

  .post("/", async (c) => {
    const body = await c.req.json();
    const { id, name, baseUrl, apiKey, apiType, supportsModelList } = body;
    if (!id || !name || !baseUrl) {
      return c.json({ error: { code: "VALIDATION", message: "id, name, baseUrl required" } }, 400);
    }
    let finalApiKey = apiKey;
    if (!finalApiKey) {
      const existing = await db.select().from(settings).where(eq(settings.key, `provider:${id}`)).get();
      if (existing) {
        finalApiKey = JSON.parse(existing.value).apiKey;
      } else {
        return c.json({ error: { code: "VALIDATION", message: "apiKey required for new providers" } }, 400);
      }
    }
    const now = new Date().toISOString();
    const provider = { id, name, baseUrl: baseUrl.replace(/\/$/, ""), apiKey: finalApiKey, apiType: apiType ?? "chat", supportsModelList: supportsModelList ?? false };
    await db
      .insert(settings)
      .values({ key: `provider:${id}`, value: JSON.stringify(provider), updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(provider), updatedAt: now } });
    return c.json({ provider: { ...provider, apiKey: "***" } });
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(settings).where(eq(settings.key, `provider:${id}`));
    return c.json({ ok: true });
  })

  .get("/:id/models", async (c) => {
    const id = c.req.param("id");
    const row = await db.select().from(settings).where(eq(settings.key, `provider:${id}`)).get();
    if (!row) return c.json({ error: { code: "NOT_FOUND", message: "Provider not found" } }, 404);
    const provider = JSON.parse(row.value);
    const { listOpenAIModels } = await import("../agent/openai");
    const models = await listOpenAIModels(provider);
    return c.json({ models });
  });

export const ollamaRoutes = new Hono()
  .get("/status", async (c) => {
    const status = await checkOllama();
    return c.json(status);
  });

export const claudeCodeRoutes = new Hono()
  .get("/status", async (c) => {
    try {
      const proc = Bun.spawn({ cmd: ["claude", "--version"], stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      const out = await new Response(proc.stdout).text();
      const version = out.trim().split("\n")[0] ?? "";
      return c.json({ installed: true, version });
    } catch {
      return c.json({ installed: false, version: null });
    }
  });
