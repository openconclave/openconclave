export const INPUT_MAX_CHARS = 100_000;

export type PromptBuildResult = { prompt: string } | { error: string };

export function buildPrompt(
  input: unknown,
  onOutput?: (chunk: string) => void,
): PromptBuildResult {
  if (input === undefined || input === null || input === "") {
    return { prompt: "Start" };
  }
  let raw: string;
  if (typeof input === "string") {
    raw = input;
  } else {
    try {
      raw = JSON.stringify(input, null, 2);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Failed to serialize input: ${msg}` };
    }
  }
  if (raw.length > INPUT_MAX_CHARS) {
    onOutput?.(`[input truncated from ${raw.length} to ${INPUT_MAX_CHARS} chars]\n`);
    return { prompt: raw.slice(0, INPUT_MAX_CHARS) + "\n...[truncated]" };
  }
  return { prompt: raw };
}
