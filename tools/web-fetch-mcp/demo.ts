#!/usr/bin/env node
import { writeFileSync } from "fs";
import { fetchAndExtract, closeBrowser } from "./lib";

const url = process.argv[2] ?? "https://openconclave.com/";
const outFile = process.argv[3] ?? "demo-output.md";

const t0 = Date.now();
try {
  const text = await fetchAndExtract(url);
  const ms = Date.now() - t0;
  writeFileSync(outFile, text);
  console.log(`Fetched ${url} in ${ms} ms`);
  console.log(`${text.length} chars · saved to ${outFile}`);
  console.log("\n=========== OUTPUT ===========\n");
  console.log(text);
  console.log("\n=========== END ===========");
} finally {
  await closeBrowser();
}
