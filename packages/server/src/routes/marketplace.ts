import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { conclaves } from "../db/schema";
import { VERSION, createConclaveSchema } from "@openconclave/shared";
import {
  getMarketplaceIndex,
  getEntryById,
  fetchDefinition,
} from "../marketplace";

export const marketplaceRoutes = new Hono()
  .get("/", async (c) => {
    const force = c.req.query("force") === "1";
    const index = await getMarketplaceIndex(force);
    return c.json(index);
  })

  .post("/:id/import", async (c) => {
    const id = c.req.param("id");
    const entry = await getEntryById(id);
    if (!entry) return c.json({ ok: false, error: `Unknown starter: ${id}` }, 404);

    let raw: unknown;
    try {
      raw = await fetchDefinition(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: `Failed to download: ${message}` }, 502);
    }

    // Accept both shapes: { conclave: {...} } (exported format) or a bare conclave object.
    const wrapped = raw as { conclave?: unknown };
    const candidate = wrapped && typeof wrapped === "object" && wrapped.conclave ? wrapped.conclave : raw;

    const parsed = createConclaveSchema.safeParse(candidate);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: `Invalid conclave definition: ${parsed.error.issues[0]?.message ?? "validation failed"}` },
        400,
      );
    }
    const body = parsed.data;

    const now = new Date().toISOString();
    const result = await db.insert(conclaves).values({
      name: body.name,
      description: body.description,
      definition: { ...body, version: VERSION, enabled: true, createdAt: now, updatedAt: now },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: conclaves.id });

    const newId = result[0]!.id;
    await db.update(conclaves)
      .set({ definition: { id: newId, ...body, version: VERSION, enabled: true, createdAt: now, updatedAt: now } })
      .where(eq(conclaves.id, newId));

    return c.json({ ok: true, id: newId, name: body.name });
  });
