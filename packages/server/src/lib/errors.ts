import type { Context } from "hono";
import { AppError } from "@openconclave/shared";
import { logger } from "./logger";

// Registered via `app.onError(errorHandler)`. Hono 4's compose catches thrown
// errors per-middleware and invokes `this.errorHandler`; registering as
// `app.use` middleware wouldn't override the default (which does
// `console.error(err)` and prints a noisy stack for every expected 4xx).
export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    logger.warn(`AppError: ${err.code}`, { message: err.message, statusCode: err.statusCode });
    return c.json(err.toJSON(), err.statusCode as 400 | 404 | 500);
  }

  logger.error(`Unhandled error: ${err.message}`);
  return c.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    500
  );
}
