import { chromium, type Browser } from "playwright";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

export const DEFAULT_MAX_BYTES = 100_000;
const NAV_TIMEOUT_MS = 30_000;

const PRIVATE_IP_RE = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
];

function isBlockedUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === "localhost") return true;
  if (PRIVATE_IP_RE.some((re) => re.test(host))) return true;
  return false;
}

let browserPromise: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

export async function fetchAndExtract(rawUrl: string, maxBytes: number = DEFAULT_MAX_BYTES): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  if (isBlockedUrl(url)) {
    throw new Error(`Blocked host (private/loopback): ${url.hostname}`);
  }

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(url.toString(), { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    const html = await page.content();
    const dom = new JSDOM(html, { url: url.toString() });
    const article = new Readability(dom.window.document).parse();
    const contentHtml = article?.content ?? html;
    const markdown = turndown.turndown(contentHtml).trim();
    const title = article?.title ? `# ${article.title}\n\n` : "";
    let out = title + markdown;
    if (out.length > maxBytes) {
      out = out.slice(0, maxBytes) + "\n\n[truncated — page exceeded maxBytes]";
    }
    return out;
  } finally {
    await context.close();
  }
}
