import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { settings } from "../db/schema";
import { testWebSearch, type WebSearchProviderId } from "../web-search/test";
import {
  getManagerStatus,
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
} from "../web-search/searxng-manager";

async function loadSaved(key: string): Promise<string | null> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

const KEY_BY_PROVIDER: Record<Exclude<WebSearchProviderId, "none">, string> = {
  searxng: "web_search_searxng_url",
  tavily: "web_search_tavily_key",
  serper: "web_search_serper_key",
  linkup: "web_search_linkup_key",
};

export const webSearchRoutes = new Hono()
  .post("/test", async (c) => {
    const body = (await c.req.json()) as {
      provider: WebSearchProviderId;
      url?: string;
      apiKey?: string;
    };

    if (body.provider === "none") {
      return c.json({ ok: false, error: "Provider is set to 'none'" });
    }

    const keyName = KEY_BY_PROVIDER[body.provider];
    if (!keyName) {
      return c.json({ ok: false, error: `Unknown provider: ${body.provider}` }, 400);
    }

    const credential = body.provider === "searxng"
      ? (body.url ?? (await loadSaved(keyName)) ?? "")
      : (body.apiKey ?? (await loadSaved(keyName)) ?? "");

    if (!credential) {
      return c.json({ ok: false, error: "No URL or API key provided or saved" });
    }

    const result = await testWebSearch(body.provider, credential);
    return c.json(result);
  })

  // ── SearXNG-managed container lifecycle ─────────────────────
  .get("/searxng/status", async (c) => c.json(await getManagerStatus()))
  .post("/searxng/start", async (c) => c.json(await startContainer()))
  .post("/searxng/stop", async (c) => c.json(await stopContainer()))
  .post("/searxng/restart", async (c) => c.json(await restartContainer()))
  .post("/searxng/remove", async (c) => c.json(await removeContainer()));
