import { useState, useEffect, useRef, useCallback } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { CodeConfig } from "@openconclave/shared";
import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Field, INPUT_CLASS, AutoTextarea } from "./shared";

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
  onUpdate?: (patch: Partial<CodeConfig>) => void;
}

export function CodeFields({ nodeId, config, onUpdate }: CodeFieldsProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const update = onUpdate ?? ((c: Partial<CodeConfig>) => updateNodeConfig(nodeId, c));

  const [claudeAvailable, setClaudeAvailable] = useState(false);
  const [improving, setImproving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.get<{ installed: boolean }>("/claude-code/status")
      .then((d) => setClaudeAvailable(d.installed))
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const workflowId = window.location.pathname.match(/\/workflows\/(\d+)/)?.[1];

  const handleImproveCode = useCallback(async () => {
    if (!workflowId || improving) return;
    const sentCode = config.code ?? "";
    setImproving(true);

    try {
      await api.post("/channel/improve-code", {
        workflowId,
        nodeId,
        nodeLabel: useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data.label ?? nodeId,
        runtime: config.runtime ?? "python",
        currentCode: sentCode,
      });
      toast("Sent to Claude Code — waiting for improved code...");
    } catch {
      toast("Failed to send to Claude Code", "error");
      setImproving(false);
      return;
    }

    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 3000;
      if (elapsed > 90000) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setImproving(false);
        toast("Timed out waiting for Claude to update the code", "error");
        return;
      }
      try {
        const wf = await api.get<Record<string, unknown>>(`/workflows/${workflowId}`);
        const def = (wf.definition ?? wf) as Record<string, unknown>;
        const nodes = (def.nodes ?? []) as Array<Record<string, unknown>>;
        const node = nodes.find((n) => n.id === nodeId);
        const nodeData = node?.data as Record<string, unknown> | undefined;
        const nodeConfig = nodeData?.config as Record<string, unknown> | undefined;
        const dbCode = (nodeConfig?.code as string) ?? "";
        if (dbCode && dbCode !== sentCode) {
          update({ code: dbCode });
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setImproving(false);
          toast("Code improved by Claude");
        }
      } catch { /* ignore poll errors */ }
    }, 3000);
  }, [workflowId, nodeId, config.code, config.runtime, improving]);

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
        <AutoTextarea
          value={config.code ?? ""}
          onChange={(e) => update({ code: e.target.value })}
          placeholder={CODE_PLACEHOLDERS[config.runtime ?? "python"]}
          minRows={10}
          label="Code"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono leading-relaxed"
          spellCheck={false}
        />
      </Field>
      <div className="flex items-center gap-2 px-1">
        <p className="text-[10px] text-muted-foreground flex-1">
          Input from previous node is passed via stdin and $INPUT env var. Output is stdout.
        </p>
        {claudeAvailable && workflowId && (
          <button
            onClick={handleImproveCode}
            disabled={improving}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors shrink-0",
              improving
                ? "text-muted-foreground cursor-wait"
                : "text-primary hover:bg-primary/10"
            )}
            title="Ask Claude Code to write or improve this code"
          >
            {improving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {improving ? "Improving..." : "Improve"}
          </button>
        )}
      </div>
    </>
  );
}
