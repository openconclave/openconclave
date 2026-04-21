import { readFileSync } from "node:fs";

const raw = readFileSync("C:/Users/beine/source/repos/openconclave/tools/mafia-v2.json", "utf8");
const parsed = JSON.parse(raw) as {
  name: string;
  description: string;
  definition: {
    name: string;
    description: string;
    toolName?: string;
    nodes: any[];
    edges: any[];
    enabled: boolean;
  };
};

const def = parsed.definition;

const body = {
  name: def.name,
  description: def.description,
  toolName: def.toolName,
  nodes: def.nodes,
  edges: def.edges,
  enabled: def.enabled,
};

const base = process.env.OC_API_URL ?? "http://localhost:4000";
const res = await fetch(`${base}/api/conclaves`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log("status:", res.status);
console.log(text);
