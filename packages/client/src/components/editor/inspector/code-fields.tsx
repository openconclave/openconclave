import { useWorkflowStore } from "@/stores/workflow-store";
import type { CodeConfig } from "@openconclave/shared";
import { Field, INPUT_CLASS } from "./shared";

const CODE_PLACEHOLDERS: Record<string, string> = {
  python:
    'import sys, json\ndata = json.load(sys.stdin)\n# process data\nprint(json.dumps(data))',
  node:
    'const chunks = [];\nprocess.stdin.on("data", c => chunks.push(c));\nprocess.stdin.on("end", () => {\n  const input = JSON.parse(chunks.join(""));\n  console.log(JSON.stringify(input));\n});',
  bash: '# Input available via stdin and $INPUT env var\necho "$INPUT" | jq .field',
};

interface CodeFieldsProps {
  nodeId: string;
  config: CodeConfig;
}

export function CodeFields({ nodeId, config }: CodeFieldsProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const update = (c: Partial<CodeConfig>) => updateNodeConfig(nodeId, c);

  return (
    <>
      <Field label="Runtime">
        <select
          value={config.runtime ?? "python"}
          onChange={(e) => update({ runtime: e.target.value as CodeConfig["runtime"] })}
          className={INPUT_CLASS}
        >
          <option value="python">Python</option>
          <option value="node">Node.js</option>
          <option value="bash">Bash</option>
        </select>
      </Field>
      <Field label="Code">
        <textarea
          value={config.code ?? ""}
          onChange={(e) => update({ code: e.target.value })}
          placeholder={CODE_PLACEHOLDERS[config.runtime ?? "python"]}
          rows={10}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono resize-y leading-relaxed"
          spellCheck={false}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1">
        Input from previous node is passed via stdin and $INPUT env var. Output is stdout.
      </p>
    </>
  );
}
