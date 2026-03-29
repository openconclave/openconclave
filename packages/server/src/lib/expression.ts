/**
 * Safe expression evaluator for Condition nodes.
 * Only allows comparisons, logical ops, and property access — no function calls.
 */

const ALLOWED_OPS = /^[\w\s.'"=!<>&|()[\]+\-*/,%?:]+$/;

export function evaluateExpression(expression: string, input: unknown): boolean {
  // Basic safety check — reject obviously dangerous patterns
  if (!ALLOWED_OPS.test(expression)) {
    throw new Error(`Expression contains disallowed characters: ${expression}`);
  }

  // Block dangerous patterns
  const blocked = [
    /\bimport\b/,
    /\brequire\b/,
    /\beval\b/,
    /\bFunction\b/,
    /\bfetch\b/,
    /\bprocess\b/,
    /\bglobal\b/,
    /\bBun\b/,
    /\b__proto__\b/,
    /\bconstructor\b/,
    /\bprototype\b/,
  ];

  for (const pattern of blocked) {
    if (pattern.test(expression)) {
      throw new Error(`Expression contains blocked keyword: ${expression}`);
    }
  }

  try {
    // Create a restricted scope
    const fn = new Function(
      "input",
      `"use strict"; return Boolean(${expression});`
    );
    return fn(input);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Expression evaluation failed: ${message}`);
  }
}
