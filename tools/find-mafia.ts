import { Database } from "bun:sqlite";

const db = new Database("C:/Users/beine/source/repos/openconclave/.openconclave/openconclave.db.bak", { readonly: true });

const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log("TABLES:", tables);

const wfCols = db.query("PRAGMA table_info(workflows)").all() as any[];
console.log("\nworkflows cols:", wfCols.map((c) => c.name));

const rows = db.query("SELECT * FROM workflows").all() as any[];
console.log(`\nALL ${rows.length} WORKFLOWS:`);
for (const r of rows) console.log(`  #${r.id} name=${r.name} tool=${r.tool_name ?? r.toolName ?? "-"}`);

const hay = JSON.stringify(rows).toLowerCase();
console.log("\ncontains 'mafia'?", hay.includes("mafia"));

if (hay.includes("mafia")) {
  for (const r of rows) {
    if (JSON.stringify(r).toLowerCase().includes("mafia")) {
      console.log("\n=== MATCH id=", r.id, "name=", r.name, "===");
      for (const [k, v] of Object.entries(r)) {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        if (s && s.toLowerCase().includes("mafia")) console.log(`  [${k}] contains mafia, len=${s.length}`);
      }
    }
  }
}
