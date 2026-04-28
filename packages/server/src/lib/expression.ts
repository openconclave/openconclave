import { Parser, type Value } from "expr-eval";

const parser = new Parser();

export function evaluateExpression(expression: string, input: unknown): boolean {
  try {
    const result = parser.parse(expression).evaluate({ input: input as Value });
    return Boolean(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Expression evaluation failed: ${message}`);
  }
}
