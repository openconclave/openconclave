import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { conclaves, runs, agentTasks, runEvents, checkpoints, knowledgeBases } from "../db/schema";
import {
  createConclaveSchema,
  updateConclaveSchema,
  AppError,
  VERSION,
} from "@openconclave/shared";
import type {
  ConclaveDefinition,
  AgentConfig,
  ConclaveExportPayload,
  ConclaveExportRole,
  ConclaveExportKB,
  ConclaveImportRequest,
} from "@openconclave/shared";

export const conclaveRoutes = new Hono()
  .get("/", async (c) => {
    const result = await db.select().from(conclaves);
    return c.json({ conclaves: result });
  })

  .get("/:id", async (c) => {
    const { id } = c.req.param();
    const [result] = await db.select().from(conclaves).where(eq(conclaves.id, Number(id)));
    if (!result) throw AppError.notFound("Conclave", id);
    return c.json(result);
  })

  .post("/", zValidator("json", createConclaveSchema), async (c) => {
    const body = c.req.valid("json");
    const now = new Date().toISOString();

    const result = await db.insert(conclaves).values({
      name: body.name,
      description: body.description,
      definition: { ...body, version: VERSION, enabled: true, createdAt: now, updatedAt: now },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: conclaves.id });

    const id = result[0]!.id;
    // Update definition with the generated ID
    await db.update(conclaves)
      .set({ definition: { id, ...body, version: VERSION, enabled: true, createdAt: now, updatedAt: now } })
      .where(eq(conclaves.id, id));

    return c.json({ id, ...body, enabled: true, createdAt: now, updatedAt: now }, 201);
  })

  .put("/:id", zValidator("json", updateConclaveSchema), async (c) => {
    const id = Number(c.req.param("id"));
    const body = c.req.valid("json");
    const now = new Date().toISOString();

    const [prev] = await db.select().from(conclaves).where(eq(conclaves.id, id));
    if (!prev) throw AppError.notFound("Conclave", String(id));

    const updated = {
      name: body.name ?? prev.name,
      description: body.description ?? prev.description,
      definition: {
        ...(prev.definition as object),
        ...body,
        id,
        updatedAt: now,
      },
      enabled: body.enabled ?? prev.enabled,
      updatedAt: now,
    };

    await db.update(conclaves).set(updated).where(eq(conclaves.id, id));
    return c.json(updated.definition);
  })

  // ── Export ─────────────────────────────────────────────────
  .get("/:id/export", async (c) => {
    const id = Number(c.req.param("id"));
    const [row] = await db.select().from(conclaves).where(eq(conclaves.id, id));
    if (!row) throw AppError.notFound("Conclave", String(id));

    const def = row.definition as ConclaveDefinition;
    const nodes = [...def.nodes];

    // Collect unique provider configs → roles, and KB references
    const roleMap = new Map<string, ConclaveExportRole>();
    const kbMap = new Map<string, ConclaveExportKB>();
    let roleCounter = 0;

    for (const node of nodes) {
      if (node.data.type !== "agent") continue;
      const cfg = node.data.config as AgentConfig;

      // Build a provider signature to group identical configs
      const sig = JSON.stringify({
        engine: cfg.engine,
        model: cfg.model,
        ollamaModel: cfg.ollamaModel,
        providerId: cfg.providerId,
        openaiModel: cfg.openaiModel,
      });

      if (!roleMap.has(sig)) {
        roleCounter++;
        const label = cfg.engine === "openai"
          ? `OpenAI-compat ${cfg.openaiModel ?? cfg.providerId ?? ""}`
          : cfg.engine === "ollama"
            ? `Ollama ${cfg.ollamaModel ?? ""}`
            : cfg.engine === "debug"
              ? "Debug"
              : `Claude ${cfg.model ?? "sonnet"}`;

        roleMap.set(sig, {
          id: `role-${roleCounter}`,
          label: label.trim(),
          original: {
            engine: cfg.engine,
            model: cfg.model,
            ollamaModel: cfg.ollamaModel,
            providerId: cfg.providerId,
            openaiModel: cfg.openaiModel,
          },
          nodeIds: [],
        });
      }
      roleMap.get(sig)!.nodeIds.push(node.id);

      // Strip provider fields from exported node, add role ref
      const exportCfg = node.data.config as Record<string, unknown>;
      delete exportCfg.engine;
      delete exportCfg.model;
      delete exportCfg.ollamaModel;
      delete exportCfg.providerId;
      delete exportCfg.openaiModel;
      exportCfg._role = roleMap.get(sig)!.id;

      // Collect KB references from tools
      if (cfg.tools) {
        for (const tool of cfg.tools) {
          if (tool.toolType === "knowledge" && !kbMap.has(tool.toolId)) {
            kbMap.set(tool.toolId, { originalId: tool.toolId, name: tool.toolName, description: undefined });
          }
        }
      }
    }

    // Enrich KB stubs with actual names/descriptions from DB
    if (kbMap.size > 0) {
      const allKbs = await db.select().from(knowledgeBases);
      for (const kb of allKbs) {
        const ref = kbMap.get(String(kb.id));
        if (ref) {
          ref.name = kb.name;
          ref.description = kb.description ?? undefined;
        }
      }
    }

    const payload: ConclaveExportPayload = {
      formatVersion: 1,
      ocVersion: VERSION,
      exportedAt: new Date().toISOString(),
      conclave: {
        name: def.name ?? row.name,
        description: def.description ?? row.description ?? undefined,
        toolName: def.toolName,
        version: def.version ?? VERSION,
        nodes,
        edges: def.edges,
      },
      roles: [...roleMap.values()],
      knowledgeBases: [...kbMap.values()],
    };

    const filename = `${row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.conclave.json`;
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Content-Type", "application/json");
    return c.json(payload);
  })

  // ── Import ─────────────────────────────────────────────────
  .post("/import", async (c) => {
    let body: ConclaveImportRequest;
    try {
      body = await c.req.json() as ConclaveImportRequest;
    } catch {
      throw AppError.validation("Invalid JSON body");
    }

    const { payload, roleMappings } = body;
    if (payload?.formatVersion !== 1) {
      throw AppError.validation("Unsupported format version");
    }

    const nodes = payload.conclave.nodes.map((node) => {
      if (node.data.type !== "agent") return node;
      const cfg = node.data.config as Record<string, unknown>;
      const roleId = cfg._role as string | undefined;
      delete cfg._role;

      if (roleId && roleMappings[roleId]) {
        const mapping = roleMappings[roleId];
        if (mapping.engine) cfg.engine = mapping.engine;
        if (mapping.model) cfg.model = mapping.model;
        if (mapping.ollamaModel) cfg.ollamaModel = mapping.ollamaModel;
        if (mapping.providerId) cfg.providerId = mapping.providerId;
        if (mapping.openaiModel) cfg.openaiModel = mapping.openaiModel;
      }

      return node;
    });

    // Create empty KBs for referenced ones and remap tool IDs
    const kbIdMap = new Map<string, number>();
    for (const kbStub of payload.knowledgeBases ?? []) {
      const now = new Date().toISOString();
      const [created] = await db.insert(knowledgeBases).values({
        name: kbStub.name,
        description: kbStub.description ?? null,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: knowledgeBases.id });
      kbIdMap.set(kbStub.originalId, created!.id);
    }

    // Remap KB tool references in agent nodes
    for (const node of nodes) {
      if (node.data.type !== "agent") continue;
      const cfg = node.data.config as AgentConfig;
      if (!cfg.tools) continue;
      for (const tool of cfg.tools) {
        if (tool.toolType === "knowledge") {
          const newId = kbIdMap.get(tool.toolId);
          if (newId !== undefined) {
            tool.toolId = String(newId);
          }
        }
      }
    }

    // Create the conclave
    const now = new Date().toISOString();
    const conclaveDef = {
      name: payload.conclave.name,
      description: payload.conclave.description,
      toolName: payload.conclave.toolName,
      version: payload.conclave.version ?? VERSION,
      nodes,
      edges: payload.conclave.edges,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.insert(conclaves).values({
      name: conclaveDef.name,
      description: conclaveDef.description,
      definition: conclaveDef,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: conclaves.id });

    const id = result[0]!.id;
    await db.update(conclaves)
      .set({ definition: { ...conclaveDef, id } })
      .where(eq(conclaves.id, id));

    return c.json({
      id,
      name: conclaveDef.name,
      knowledgeBasesCreated: [...kbIdMap.entries()].map(([orig, newId]) => ({ originalId: orig, newId })),
    }, 201);
  })

  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));

    // Delete related data first (cascade)
    const conclaveRuns = await db.select().from(runs).where(eq(runs.conclaveId, id));
    for (const run of conclaveRuns) {
      await db.delete(checkpoints).where(eq(checkpoints.runId, run.id));
      await db.delete(runEvents).where(eq(runEvents.runId, run.id));
      await db.delete(agentTasks).where(eq(agentTasks.runId, run.id));
    }
    await db.delete(runs).where(eq(runs.conclaveId, id));
    await db.delete(conclaves).where(eq(conclaves.id, id));

    return c.json({ deleted: true });
  });
