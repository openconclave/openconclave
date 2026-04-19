import { Hono } from "hono";
import { checkForUpdate, getCachedStatus } from "../update/check";

export const updateRoutes = new Hono()
  .get("/status", (c) => c.json(getCachedStatus()))
  .post("/check", async (c) => c.json(await checkForUpdate()));
