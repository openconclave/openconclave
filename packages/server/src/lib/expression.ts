import { Parser, type Value } from "expr-eval";

const parser = new Parser();
parser.functions.contains = (haystack: unknown, needle: unknown) =>
  String(haystack).includes(String(needle));
parser.functions.startsWith = (s: unknown, prefix: unknown) =>
  String(s).startsWith(String(prefix));
parser.functions.endsWith = (s: unknown, suffix: unknown) =>
  String(s).endsWith(String(suffix));

export function evaluateExpression(expression: string, input: unknown): boolean {
  try {
    const result = parser.parse(expression).evaluate({ input: input as Value });
    return Boolean(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Expression evaluation failed: ${message}`);
  }
}
