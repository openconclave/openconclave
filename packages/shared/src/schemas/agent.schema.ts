import { z } from "zod";

export const taskStatusSchema = z.enum(["queued", "running", "success", "failure", "cancelled"]);
export const runStatusSchema = z.enum(["queued", "running", "success", "failure", "cancelled"]);

export const runFilterSchema = z.object({
  workflowId: z.string().optional(),
  status: runStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
