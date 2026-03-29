import type { Context, Next } from "hono";
import { AppError } from "@openconclave/shared";
import { logger } from "./logger";

/**
 * Hono error handling middleware.
 * Catches AppError for structured responses, unknown errors get 500.
 */
export async function errorHandler(c: Context, next: Next): Promise<Response | void> {
  try {
    await next();
  } catch (err: unknown) {
    if (err instanceof AppError) {
      logger.warn(`AppError: ${err.code}`, { message: err.message, statusCode: err.statusCode });
      return c.json(err.toJSON(), err.statusCode as 400 | 404 | 500);
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error(`Unhandled error: ${message}`);
    return c.json(
      { error: { code: "INTERNAL", message: "Internal server error" } },
      500
    );
  }
}
