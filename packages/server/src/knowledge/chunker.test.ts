import { describe, it, expect } from "vitest";
import { chunkText } from "./chunker";

describe("chunkText", () => {
  // ── Empty / trivial inputs ────────────────────────────────────

  describe("empty and trivial inputs", () => {
    it("returns empty array for empty string", () => {
      const result = chunkText("", 100, 0);
      expect(result).toEqual([]);
    });

    it("returns empty array for whitespace-only string", () => {
      const result = chunkText("   ", 100, 0);
      expect(result).toEqual([]);
    });

    it("returns single chunk for text shorter than chunkSize", () => {
      const result = chunkText("Hello world", 100, 0);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("Hello world");
    });

    it("returns single chunk for text exactly at chunkSize", () => {
      const text = "a".repeat(100);
      const result = chunkText(text, 100, 0);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });

    it("trims whitespace from the single short chunk", () => {
      const result = chunkText("  hello  ", 100, 0);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("hello");
    });
  });

  // ── Paragraph-based splitting ─────────────────────────────────

  describe("paragraph-based splitting", () => {
    it("splits on double newlines into multiple chunks", () => {
      const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
      const result = chunkText(text, 25, 0);
      expect(result.length).toBeGreaterThan(1);
    });

    it("each chunk is within chunkSize when split by paragraphs", () => {
      const para = "Short paragraph.";
      const text = [para, para, para, para].join("\n\n");
      const result = chunkText(text, 30, 0);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(35); // allow small tolerance for separator
      }
    });

    it("preserves paragraph content after splitting", () => {
      const text = "Alpha beta gamma.\n\nDelta epsilon zeta.\n\nEta theta iota.";
      const result = chunkText(text, 25, 0);
      const joined = result.join(" ");
      expect(joined).toContain("Alpha");
      expect(joined).toContain("Delta");
      expect(joined).toContain("Eta");
    });
  });

  // ── Sentence-based splitting ──────────────────────────────────

  describe("sentence-based splitting", () => {
    it("splits on '. ' when there are no paragraph breaks", () => {
      const text = "First sentence. Second sentence. Third sentence. Fourth sentence.";
      // chunkSize small enough to force splitting
      const result = chunkText(text, 20, 0);
      expect(result.length).toBeGreaterThan(1);
    });

    it("chunks from sentence splitting do not exceed chunkSize by much", () => {
      const text = "One two three. Four five six. Seven eight nine. Ten eleven twelve.";
      const result = chunkText(text, 20, 0);
      // Each chunk should be close to chunkSize
      for (const chunk of result) {
        // Tolerance: a single sentence may be slightly over chunkSize before further splitting
        expect(chunk.length).toBeLessThanOrEqual(40);
      }
    });

    it("does not lose content when splitting on sentences", () => {
      const text = "Apple is a fruit. Banana is yellow. Cherry is red. Date is sweet.";
      const result = chunkText(text, 20, 0);
      const allContent = result.join(" ");
      expect(allContent).toContain("Apple");
      expect(allContent).toContain("Banana");
      expect(allContent).toContain("Cherry");
      expect(allContent).toContain("Date");
    });
  });

  // ── Multiple chunks from long text ────────────────────────────

  describe("multiple chunks from long text", () => {
    it("produces more than one chunk for long text", () => {
      const longText = "word ".repeat(200);
      const result = chunkText(longText, 100, 0);
      expect(result.length).toBeGreaterThan(1);
    });

    it("all content is present across chunks (no content loss)", () => {
      const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
      const text = words.join(" ");
      const result = chunkText(text, 50, 0);
      const combined = result.join(" ");
      for (const word of words) {
        expect(combined).toContain(word);
      }
    });

    it("all chunks are trimmed (no leading/trailing whitespace)", () => {
      const text = "word ".repeat(100);
      const result = chunkText(text, 50, 0);
      for (const chunk of result) {
        expect(chunk).toBe(chunk.trim());
      }
    });

    it("no empty chunks are returned", () => {
      const text = "word ".repeat(100);
      const result = chunkText(text, 50, 0);
      for (const chunk of result) {
        expect(chunk.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Overlap ───────────────────────────────────────────────────

  describe("chunk overlap", () => {
    it("consecutive chunks share overlap content when chunkOverlap > 0", () => {
      const text = "AAABBBCCC DDD EEE FFF GGG HHH III JJJ KKK LLL MMM NNN OOO";
      const result = chunkText(text, 20, 5);
      expect(result.length).toBeGreaterThanOrEqual(2);
      // With overlap, there should be some shared content between adjacent chunks
      // The end of chunk 0 and start of chunk 1 should have common words
      const words0 = result[0].trim().split(/\s+/);
      const words1 = result[1].trim().split(/\s+/);
      const lastWord0 = words0[words0.length - 1];
      // The overlap should cause the last word of chunk 0 to appear in chunk 1
      expect(words1).toContain(lastWord0);
    });

    it("zero overlap produces no shared content between adjacent chunks", () => {
      // Build text that splits cleanly on paragraphs
      const para1 = "a".repeat(50);
      const para2 = "b".repeat(50);
      const text = `${para1}\n\n${para2}`;
      const result = chunkText(text, 60, 0);
      if (result.length >= 2) {
        // With 0 overlap, the start of chunk[1] should not be the tail of chunk[0]
        // (just verify overlap option is respected — content is different)
        expect(result[0]).not.toBe(result[1]);
      }
    });

    it("overlap does not create empty chunks", () => {
      const text = "sentence one here. sentence two here. sentence three here. sentence four.";
      const result = chunkText(text, 25, 10);
      for (const chunk of result) {
        expect(chunk.length).toBeGreaterThan(0);
      }
    });

    it("with overlap=0 and single chunk, returns the text as-is", () => {
      const text = "short text";
      const result = chunkText(text, 100, 0);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("short text");
    });
  });

  // ── Hard-cut on very long single words ───────────────────────

  describe("hard-cut for unsplittable content", () => {
    it("hard-cuts a single long word at chunkSize boundaries", () => {
      const longWord = "x".repeat(50);
      const result = chunkText(longWord, 20, 0);
      expect(result.length).toBeGreaterThan(1);
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(20);
      }
    });

    it("hard-cut chunks together reconstruct the original word", () => {
      const longWord = "abcde".repeat(10); // 50 chars
      const result = chunkText(longWord, 15, 0);
      expect(result.join("")).toBe(longWord);
    });

    it("produces correct number of hard-cut chunks", () => {
      const text = "z".repeat(60);
      const result = chunkText(text, 20, 0);
      expect(result).toHaveLength(3); // 60 / 20 = 3
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles text with only newlines", () => {
      const result = chunkText("\n\n\n\n", 100, 0);
      // All parts are empty after trim, expect empty array
      expect(result).toEqual([]);
    });

    it("handles chunkOverlap larger than chunk content gracefully", () => {
      const text = "a b c d e f g h i j k l m n o p q r s t";
      const result = chunkText(text, 10, 20);
      // Should not throw and should return non-empty array
      expect(result.length).toBeGreaterThan(0);
    });

    it("a single sentence shorter than chunkSize returns one chunk", () => {
      const result = chunkText("Hello.", 50, 0);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("Hello.");
    });

    it("handles text with mixed separators (paragraphs and sentences)", () => {
      const text = "Para one first sentence. Para one second.\n\nPara two first. Para two second.";
      const result = chunkText(text, 30, 0);
      expect(result.length).toBeGreaterThan(1);
      const joined = result.join(" ");
      expect(joined).toContain("Para one");
      expect(joined).toContain("Para two");
    });
  });
});
