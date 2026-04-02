import { logger } from "../lib/logger";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

/**
 * Generate an embedding vector for a single text using Ollama.
 */
export async function generateEmbedding(model: string, text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama embed error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { embeddings: number[][] };
  if (!data.embeddings || data.embeddings.length === 0) {
    throw new Error("Ollama returned no embeddings");
  }

  return data.embeddings[0];
}

/**
 * Generate embeddings for multiple texts in a single batch call.
 */
export async function generateEmbeddings(model: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  logger.info(`Generating embeddings for ${texts.length} chunks`, { model });

  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama embed error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { embeddings: number[][] };
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error(
      `Expected ${texts.length} embeddings, got ${data.embeddings?.length ?? 0}`,
    );
  }

  return data.embeddings;
}
