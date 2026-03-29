import { describe, it, expect } from "vitest";
import { AppError, ErrorCode } from "./errors";

describe("AppError", () => {
  it("creates error with code and message", () => {
    const err = new AppError(ErrorCode.NOT_FOUND, "Not found", 404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Not found");
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe("AppError");
  });

  it("serializes to JSON", () => {
    const err = new AppError(ErrorCode.VALIDATION, "Bad input", 400, { field: "name" });
    const json = err.toJSON();

    expect(json.error.code).toBe("VALIDATION");
    expect(json.error.message).toBe("Bad input");
    expect(json.error.details).toEqual({ field: "name" });
  });

  it("omits details when undefined", () => {
    const err = new AppError(ErrorCode.INTERNAL, "Server error");
    const json = err.toJSON();

    expect(json.error.details).toBeUndefined();
  });

  it("creates not found error via static method", () => {
    const err = AppError.notFound("Workflow", "abc123");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("abc123");
  });

  it("creates validation error via static method", () => {
    const err = AppError.validation("Invalid name");
    expect(err.code).toBe("VALIDATION");
    expect(err.statusCode).toBe(400);
  });

  it("is instanceof Error", () => {
    const err = new AppError(ErrorCode.INTERNAL, "test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });
});
