import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { conclaves } from "../db/schema";
import { VERSION, createConclaveSchema, AppError } from "@openconclave/shared";
import { getMarketplaceIndex, fetchDefinition } from "../marketplace";

export const marketplaceRoutes = new Hono()
  .get("/", async (c) => {
    const force = c.req.query("force") === "1";
    const index = await getMarketplaceIndex(force);
    return c.json(index);
  })

  .post("/:id/import", async (c) => {
    const id = c.req.param("id");
    const index = await getMarketplaceIndex();
    if (index.error && index.entries.length === 0) {
      throw new Error(`Marketplace index unavailable: ${index.error}`);
    }
    const entry = index.entries.find((e) => e.id === id) ?? null;
    if (!entry) throw AppError.notFound("MarketplaceEntry", id);

    let raw: unknown;
    try {
      raw = await fetchDefinition(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to download: ${message}`);
    }

    // /:id/export wraps in { conclave: … }; raw fixtures don't
    const wrapped = raw as { conclave?: unknown };
    const candidate = wrapped && typeof wrapped === "object" && wrapped.conclave ? wrapped.conclave : raw;

    const parsed = createConclaveSchema.safeParse(candidate);
    if (!parsed.success) {
      throw AppError.validation(
        `Invalid conclave definition: ${parsed.error.issues[0]?.message ?? "validation failed"}`,
      );
    }
    const body = parsed.data;

    for (const node of body.nodes) {
      if (node.data.type !== "agent") continue;
      const cfg = node.data.config as { tools?: Array<{ toolType: string }> };
      if (cfg.tools?.some((t) => t.toolType === "knowledge")) {
        throw AppError.validation(
          "Marketplace starters with knowledge tools are not supported for direct import",
        );
      }
    }

    const now = new Date().toISOString();
    const newId = db.transaction((tx) => {
      const rows = tx
        .insert(conclaves)
        .values({
          name: body.name,
          description: body.description,
          definition: { ...body, version: VERSION, enabled: true, createdAt: now, updatedAt: now },
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: conclaves.id })
        .all();
      const insertedId = rows[0]!.id;
      tx.update(conclaves)
        .set({ definition: { id: insertedId, ...body, version: VERSION, enabled: true, createdAt: now, updatedAt: now } })
        .where(eq(conclaves.id, insertedId))
        .run();
      return insertedId;
    });

    return c.json({ ok: true, id: newId, name: body.name });
  });
