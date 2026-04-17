export const ALLOWED_MODEL_ALIASES = new Set(["sonnet", "opus", "haiku"]);

/** Accepts our three aliases OR a pinned model ID like `claude-opus-4-7`. */
export function isAllowedModel(model: string): boolean {
  return ALLOWED_MODEL_ALIASES.has(model) || /^claude-[a-z0-9-]+$/i.test(model);
}
