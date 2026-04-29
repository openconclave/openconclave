import { test, expect, describe } from "bun:test";

import { chunkText } from "../chunker";

// MINOR: last sub-chunk from a recursive split should be merged with following parts
// Before fix: hard-cut tail "AAAAA\n" is committed eagerly and the small parts
// "BBB\n\n", "CCC" can't absorb it, producing 3 chunks instead of 2.
describe("chunkText — recursive split tail merges with following parts", () => {
  test("small trailing sub-chunk merges with subsequent parts that fit", () => {
    const text = "AAAAAAAAAAAAAAAAAAAAAAAAA\n\nBBB\n\nCCC";
    const chunks = chunkText(text, 20, 0);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe("AAAAAAAAAAAAAAAAAAAA");
    expect(chunks[1]).toContain("BBB");
    expect(chunks[1]).toContain("CCC");
  });
});
