/**
 * Simple {{variable.path}} template renderer.
 * Supports dot notation: {{input.topic}}, {{agentName}}, {{transcript}}, {{round}}
 *
 * Security: __proto__, constructor, prototype are blocked — prevents prototype chain
 * traversal and leakage of [object Object] into LLM prompts.
 */

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    let value: unknown = context;
    for (const segment of path.split(".")) {
      if (UNSAFE_KEYS.has(segment)) return "";
      if (value && typeof value === "object") {
        value = (value as Record<string, unknown>)[segment];
      } else {
        return "";
      }
    }
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return String(value ?? "");
  });
}
