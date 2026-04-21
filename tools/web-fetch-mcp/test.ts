#!/usr/bin/env bun
/**
 * Quick smoke test: fetch two real URLs (one server-rendered, one SPA-ish)
 * and print size + first 400 chars of output.
 */
import { fetchAndExtract, closeBrowser } from "./lib";

const urls = [
  "https://en.wikipedia.org/wiki/Bun_(software)",       // server-rendered
  "https://react.dev/learn",                             // JS-hydrated SPA
];

for (const url of urls) {
  const t0 = Date.now();
  try {
    const text = await fetchAndExtract(url);
    const ms = Date.now() - t0;
    console.log(`\n=== ${url} ===`);
    console.log(`OK in ${ms} ms · ${text.length} chars`);
    console.log("--- first 400 chars ---");
    console.log(text.slice(0, 400));
    console.log("--- end ---");
  } catch (err) {
    console.log(`\n=== ${url} ===`);
    console.log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Blocked-host check
try {
  await fetchAndExtract("http://localhost:4000/");
  console.log("\nSSRF CHECK: FAIL — localhost was not blocked");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`\nSSRF CHECK: OK — ${msg}`);
}

await closeBrowser();
