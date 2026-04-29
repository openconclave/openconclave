import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client";
import { settings } from "../db/schema";
import { checkOllama } from "../agent/ollama";
import { listOpenAIModels } from "../agent/openai";

const providerKey = (id: string) => `provider:${id}`;

interface StoredProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiType?: "chat" | "responses";
  supportsModelList?: boolean;
}

const maskProvider = (p: StoredProvider) => ({ ...p, apiKey: p.apiKey ? "***" : "" });

function safeParseProvider(value: string): StoredProvider | null {
  try {
    return JSON.parse(value) as StoredProvider;
  } catch {
    return null;
  }
}

const putSettingsSchema = z.record(z.string());

const createProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  apiType: z.enum(["chat", "responses"]).optional(),
  supportsModelList: z.boolean().optional(),
});

export const settingsRoutes = new Hono()
  .get("/", async (c) => {
    const all = await db.select().from(settings);
    const obj: Record<string, string> = {};
    for (const s of all) obj[s.key] = s.value;
    return c.json(obj);
  })

  .put("/", zValidator("json", putSettingsSchema), async (c) => {
    const body = c.req.valid("json");
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
      .map((s) => safeParseProvider(s.value))
      .filter((p): p is StoredProvider => p !== null)
      .map(maskProvider);
    return c.json({ providers });
  })

  .post("/", zValidator("json", createProviderSchema), async (c) => {
    const { id, name, baseUrl, apiKey, apiType, supportsModelList } = c.req.valid("json");
    let finalApiKey = apiKey;
    if (!finalApiKey) {
      const existing = await db.select().from(settings).where(eq(settings.key, providerKey(id))).get();
      if (!existing) {
        return c.json({ error: { code: "VALIDATION", message: "apiKey required for new providers" } }, 400);
      }
      finalApiKey = safeParseProvider(existing.value)?.apiKey ?? "";
    }
    if (!finalApiKey) {
      return c.json({ error: { code: "VALIDATION", message: "apiKey required" } }, 400);
    }
    const now = new Date().toISOString();
    const provider: StoredProvider = {
      id,
      name,
      baseUrl: baseUrl.replace(/\/$/, ""),
      apiKey: finalApiKey,
      apiType: apiType ?? "chat",
      supportsModelList: supportsModelList ?? false,
    };
    await db
      .insert(settings)
      .values({ key: providerKey(id), value: JSON.stringify(provider), updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(provider), updatedAt: now } });
    return c.json({ provider: maskProvider(provider) });
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(settings).where(eq(settings.key, providerKey(id)));
    return c.json({ ok: true });
  })

  .get("/:id/models", async (c) => {
    const id = c.req.param("id");
    const row = await db.select().from(settings).where(eq(settings.key, providerKey(id))).get();
    if (!row) return c.json({ error: { code: "NOT_FOUND", message: "Provider not found" } }, 404);
    const provider = safeParseProvider(row.value);
    if (!provider) {
      return c.json({ error: { code: "INTERNAL", message: "Provider record corrupted" } }, 500);
    }
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
      const proc = Bun.spawn({ cmd: ["claude", "--version"], stdout: "pipe", stderr: "ignore" });
      const exitCode = await proc.exited;
      const out = await new Response(proc.stdout).text();
      const version = out.trim().split("\n")[0] ?? "";
      if (exitCode !== 0 || !version) {
        return c.json({ installed: false, version: null });
      }
      return c.json({ installed: true, version });
    } catch {
      return c.json({ installed: false, version: null });
    }
  });
