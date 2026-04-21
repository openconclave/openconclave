import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";

const db = new Database("C:/Users/beine/source/repos/openconclave/.openconclave/openconclave.db.bak", { readonly: true });

const row = db.query("SELECT * FROM workflows WHERE id = 16").get() as any;
console.log("name:", row.name);
console.log("description:", row.description);
console.log("enabled:", row.enabled);
console.log("created:", row.created_at, "updated:", row.updated_at);

const def = JSON.parse(row.definition);
console.log("\ndefinition top-level keys:", Object.keys(def));
if (def.nodes) console.log("nodes:", def.nodes.length);
if (def.edges) console.log("edges:", def.edges.length);
if (def.nodes) {
  console.log("\nnode summary:");
  for (const n of def.nodes) console.log(`  ${n.id} [${n.type}] ${n.data?.label ?? n.data?.name ?? ""}`);
}

const outPath = "C:/Users/beine/source/repos/openconclave/tools/mafia-v2.json";
writeFileSync(outPath, JSON.stringify({ name: row.name, description: row.description, definition: def }, null, 2));
console.log("\nwrote:", outPath);
