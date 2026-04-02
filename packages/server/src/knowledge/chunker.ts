/**
 * Recursive character text splitter.
 *
 * Splits on paragraphs first (\n\n), then sentences (. ! ? followed by space),
 * then words, to keep chunks within the target size with configurable overlap.
 */

const SEPARATORS = ["\n\n", "\n", ". ", "! ", "? ", " "];

function splitOn(text: string, separator: string): string[] {
  const parts = text.split(separator);
  // Re-attach separator to the end of each part (except last) so context isn't lost
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i < parts.length - 1) {
      result.push(parts[i] + separator);
    } else {
      result.push(parts[i]);
    }
  }
  return result.filter((p) => p.length > 0);
}

function recursiveSplit(text: string, chunkSize: number, separatorIndex: number): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  if (separatorIndex >= SEPARATORS.length) {
    // No more separators — hard-cut at chunkSize
    const result: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      result.push(text.slice(i, i + chunkSize));
    }
    return result;
  }

  const separator = SEPARATORS[separatorIndex];
  const parts = splitOn(text, separator);

  if (parts.length <= 1) {
    // This separator didn't help — try the next one
    return recursiveSplit(text, chunkSize, separatorIndex + 1);
  }

  // Merge parts into chunks that fit within chunkSize
  const merged: string[] = [];
  let current = "";

  for (const part of parts) {
    if (current.length + part.length <= chunkSize) {
      current += part;
    } else {
      if (current.length > 0) {
        merged.push(current);
      }
      // If a single part exceeds chunkSize, recursively split it
      if (part.length > chunkSize) {
        const subChunks = recursiveSplit(part, chunkSize, separatorIndex + 1);
        merged.push(...subChunks);
        current = "";
      } else {
        current = part;
      }
    }
  }

  if (current.length > 0) {
    merged.push(current);
  }

  return merged;
}

/**
 * Split text into chunks of approximately `chunkSize` characters
 * with `chunkOverlap` characters of overlap between consecutive chunks.
 */
export function chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
  if (text.length === 0) return [];
  if (text.length <= chunkSize) return [text.trim()].filter((t) => t.length > 0);

  const rawChunks = recursiveSplit(text, chunkSize, 0);

  if (chunkOverlap <= 0 || rawChunks.length <= 1) {
    return rawChunks.map((c) => c.trim()).filter((c) => c.length > 0);
  }

  // Apply overlap: prepend the tail of the previous chunk
  const result: string[] = [rawChunks[0]];

  for (let i = 1; i < rawChunks.length; i++) {
    const prevChunk = rawChunks[i - 1];
    const overlapText = prevChunk.slice(Math.max(0, prevChunk.length - chunkOverlap));
    const combined = overlapText + rawChunks[i];
    result.push(combined);
  }

  return result.map((c) => c.trim()).filter((c) => c.length > 0);
}
